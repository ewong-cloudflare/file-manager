import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
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
  prefix: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const key = `${prefix}${file.name}`;
  const contentType = file.type || "application/octet-stream";
  const { url } = await getUploadUrl(key, contentType, file.size);
  await xhrPut(url, file, onProgress);
}

async function uploadMultipart(
  file: File,
  prefix: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const key = `${prefix}${file.name}`;
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

export function UploadZone({
  uploads,
  currentPrefix,
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadError,
}: UploadZoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        const id = crypto.randomUUID();
        onUploadStart(id, file.name, file.size);

        const run = file.size <= SINGLE_UPLOAD_THRESHOLD
          ? uploadSingle(file, currentPrefix, (pct) => onUploadProgress(id, pct))
          : uploadMultipart(file, currentPrefix, (pct) => onUploadProgress(id, pct));

        run
          .then(() => onUploadComplete(id))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : "Upload failed";
            onUploadError(id, msg);
          });
      }
    },
    [currentPrefix, onUploadStart, onUploadProgress, onUploadComplete, onUploadError]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const activeUploads = uploads.filter((u) => u.status === "uploading" || u.status === "error");

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center gap-3 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
          isDragActive
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50"
        }`}
      >
        <input {...getInputProps()} />
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
            {isDragActive ? "Drop files here" : "Drag & drop files, or click to browse"}
          </p>
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
