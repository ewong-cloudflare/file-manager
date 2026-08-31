import { useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import {
  getUploadUrl,
  initMultipart,
  getPartUrl,
  completeMultipart,
  abortMultipart,
} from "../lib/api";
import { ProgressBar } from "./ProgressBar";

const SINGLE_UPLOAD_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const PART_SIZE = 100 * 1024 * 1024; // 100 MB per part
const MAX_CONCURRENT_PARTS = 3;

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "complete" | "error";
  error?: string;
}

interface UploadZoneProps {
  uploads: UploadItem[];
  currentPrefix: string;
  onUploadStart: (id: string, name: string, size: number) => void;
  onUploadProgress: (id: string, progress: number) => void;
  onUploadComplete: (id: string) => void;
  onUploadError: (id: string, error: string) => void;
}

function xhrPut(
  url: string,
  data: Blob,
  onProgress: (pct: number) => void
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag"));
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.open("PUT", url);
    xhr.send(data);
  });
}

function xhrPutPart(
  url: string,
  chunk: Blob,
  onBytesLoaded: (bytes: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytesLoaded(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) reject(new Error("R2 did not return ETag for part"));
        else resolve(etag);
      } else {
        reject(new Error(`Part upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during part upload"));
    xhr.open("PUT", url);
    xhr.send(chunk);
  });
}

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (nextIdx < tasks.length) {
      const i = nextIdx++;
      results[i] = await tasks[i]();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker)
  );
  return results;
}

async function uploadSingle(
  file: File,
  key: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const contentType = file.type || "application/octet-stream";
  const { url } = await getUploadUrl(key, contentType, file.size);
  await xhrPut(url, file, onProgress);
}

async function uploadMultipart(
  file: File,
  key: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const contentType = file.type || "application/octet-stream";
  const numParts = Math.ceil(file.size / PART_SIZE);

  const { uploadId } = await initMultipart(key, contentType);

  const partProgress = new Array<number>(numParts).fill(0);

  const updateTotalProgress = () => {
    const totalLoaded = partProgress.reduce((a, b) => a + b, 0);
    onProgress(Math.min(99, Math.round((totalLoaded / file.size) * 100)));
  };

  const uploadPart = async (partNumber: number): Promise<{ PartNumber: number; ETag: string }> => {
    const start = (partNumber - 1) * PART_SIZE;
    const chunk = file.slice(start, Math.min(start + PART_SIZE, file.size));

    // Just-in-time: fetch URL immediately before this part's upload begins
    const { url } = await getPartUrl(key, uploadId, partNumber, chunk.size);

    const etag = await xhrPutPart(url, chunk, (bytes) => {
      partProgress[partNumber - 1] = bytes;
      updateTotalProgress();
    });

    return { PartNumber: partNumber, ETag: etag };
  };

  const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1);

  let parts: Array<{ PartNumber: number; ETag: string }>;
  try {
    parts = await withConcurrency(
      partNumbers.map((n) => () => uploadPart(n)),
      MAX_CONCURRENT_PARTS
    );
  } catch (err) {
    await abortMultipart(key, uploadId);
    throw err;
  }

  await completeMultipart(key, uploadId, parts);
  onProgress(100);
}

// ── Folder traversal helpers ──

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

async function traverseEntry(
  entry: FileSystemEntry,
  pathPrefix: string,
  collected: Array<{ file: File; relativePath: string }>
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    collected.push({ file, relativePath: pathPrefix + file.name });
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const subPath = pathPrefix + dirEntry.name + "/";
    const children = await readAllEntries(dirEntry.createReader());
    for (const child of children) await traverseEntry(child, subPath, collected);
  }
}

async function collectDropItems(dt: DataTransfer): Promise<Array<{ file: File; relativePath: string }>> {
  const collected: Array<{ file: File; relativePath: string }> = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry) {
      await traverseEntry(entry, "", collected);
    } else {
      const f = item.getAsFile();
      if (f) collected.push({ file: f, relativePath: f.name });
    }
  }
  return collected;
}

export function UploadZone({
  uploads,
  currentPrefix,
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadError,
}: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  function startUploads(items: Array<{ file: File; relativePath: string }>) {
    for (const { file, relativePath } of items) {
      const id = crypto.randomUUID();
      const key = `${currentPrefix}${relativePath}`;
      onUploadStart(id, relativePath, file.size);

      const run = file.size <= SINGLE_UPLOAD_THRESHOLD
        ? uploadSingle(file, key, (pct) => onUploadProgress(id, pct))
        : uploadMultipart(file, key, (pct) => onUploadProgress(id, pct));

      run
        .then(() => onUploadComplete(id))
        .catch((err: unknown) => onUploadError(id, err instanceof Error ? err.message : "Upload failed"));
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragActive(false);
    const collected = await collectDropItems(e.dataTransfer);
    startUploads(collected);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const items = Array.from(files).map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name,
    }));
    startUploads(items);
    e.target.value = "";
  }

  const activeUploads = uploads.filter((u) => u.status === "uploading" || u.status === "error");

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleInputChange} />
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleInputChange} />
      <div
        className={`relative flex flex-col items-center justify-center gap-3 p-12 rounded-xl border-2 border-dashed transition-all duration-200 ${
          isDragActive
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50"
        }`}
        onDrop={(e) => void handleDrop(e)}
        onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
        onDragLeave={() => setIsDragActive(false)}
      >
        <div
          className={`flex items-center justify-center w-12 h-12 rounded-full transition-colors ${
            isDragActive ? "bg-blue-100" : "bg-slate-100"
          }`}
        >
          <UploadCloud
            className={`w-6 h-6 ${isDragActive ? "text-blue-500" : "text-slate-400"}`}
          />
        </div>
        <div className="text-center">
          <p className={`text-sm font-medium ${isDragActive ? "text-blue-600" : "text-slate-600"}`}>
            {isDragActive ? "Drop files or folders here" : "Drag & drop files or folders here"}
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              Browse files
            </button>
            <span className="text-xs text-slate-300">·</span>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              Browse folder
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Files ≤ 100 MB use direct upload · Larger files use multipart (100 MB parts, 3 parallel)
          </p>
        </div>
      </div>

      {activeUploads.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Uploading
            </p>
          </div>
          <div className="divide-y divide-slate-50">
            {activeUploads.map((u) => (
              <div key={u.id} className="px-5 py-3.5 space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-700 truncate font-medium">{u.name}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap tabular-nums shrink-0">
                    {u.status === "error" ? (
                      <span className="text-red-500">Failed</span>
                    ) : (
                      `${u.progress}%`
                    )}
                  </span>
                </div>
                {u.status === "error" ? (
                  <p className="text-xs text-red-500">{u.error}</p>
                ) : (
                  <ProgressBar progress={u.progress} status={u.status} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
