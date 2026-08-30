import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download, Folder, FileText, Loader2, AlertCircle, ArrowLeft,
  Eye, Trash2, UploadCloud, FolderPlus, ChevronRight, Home,
  Users, UserX, Plus, X,
} from "lucide-react";
import {
  getSharedItem, sharedPreviewUrl, sharedDownloadUrl, sharedUploadUrl, sharedInitMultipart,
  sharedPartUrl, sharedCompleteMultipart, sharedAbortMultipart,
  sharedDeleteFile, sharedMkdir, sharedListGrantees, sharedCreateShare, sharedRevokeGrantee,
} from "../lib/api";
import type { SharedItemResponse, FileEntry, ShareRecord } from "../lib/api";
import { PreviewModal, canPreview } from "./PreviewModal";
import type { PreviewEntry } from "./PreviewModal";
import { ProgressBar } from "./ProgressBar";

interface SharedItemViewProps {
  token: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read-only",
  read_write: "Read + Write",
  read_write_delete: "Full Access",
};

const PERMISSION_COLORS: Record<string, string> = {
  read: "bg-slate-100 text-slate-600",
  read_write: "bg-blue-50 text-blue-700",
  read_write_delete: "bg-amber-50 text-amber-700",
};

const SINGLE_UPLOAD_THRESHOLD = 100 * 1024 * 1024;
const PART_SIZE = 100 * 1024 * 1024;
const MAX_CONCURRENT_PARTS = 3;

interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "complete" | "error";
  error?: string;
}

function xhrPut(url: string, data: Blob, onProgress: (pct: number) => void): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader("ETag")) : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("PUT", url);
    xhr.send(data);
  });
}

function xhrPutPart(url: string, chunk: Blob, onBytes: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      xhr.status >= 200 && xhr.status < 300 && etag ? resolve(etag) : reject(new Error(`Part HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("PUT", url);
    xhr.send(chunk);
  });
}

async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;
  const worker = async () => { while (nextIdx < tasks.length) { const i = nextIdx++; results[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const PERMISSION_RANK_MAP: Record<string, number> = { read: 0, read_write: 1, read_write_delete: 2 };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function SharedItemView({ token }: SharedItemViewProps) {
  const [shareInfo, setShareInfo] = useState<SharedItemResponse["share"] | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [subPrefix, setSubPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entries: PreviewEntry[]; initialIndex: number } | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── People with access ──
  const [showGrantees, setShowGrantees] = useState(false);
  const [grantees, setGrantees] = useState<ShareRecord[] | null>(null);
  const [granteesLoading, setGranteesLoading] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addPerm, setAddPerm] = useState("read");
  const [addingGrantee, setAddingGrantee] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [filePerms, setFilePerms] = useState<Record<string, string>>({});

  const fetchContents = useCallback(async (sp: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSharedItem(token, sp);
      setShareInfo(data.share);
      setEntries(data.entries ?? []);
      setDownloadUrl(data.downloadUrl ?? null);
      setFilePerms(data.filePerms ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shared item");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchContents(subPrefix); }, [fetchContents, subPrefix]);

  const perm = shareInfo?.permission ?? "read";
  const canWrite = perm === "read_write" || perm === "read_write_delete";
  const canDelete = perm === "read_write_delete";
  const canShare = canDelete;
  const isFolder = shareInfo?.isFolder ?? false;

  // ── Breadcrumb ──
  const breadcrumbParts = subPrefix ? subPrefix.split("/").filter(Boolean) : [];

  function navigateTo(idx: number) {
    const newPrefix = idx < 0 ? "" : breadcrumbParts.slice(0, idx + 1).join("/") + "/";
    setSubPrefix(newPrefix);
  }

  // ── Upload ──
  function handleFilePick(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const key = `${subPrefix}${file.name}`;
      const contentType = file.type || "application/octet-stream";

      setUploads((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);

      const run = file.size <= SINGLE_UPLOAD_THRESHOLD
        ? (async () => {
          const { url } = await sharedUploadUrl(token, key, contentType, file.size);
          await xhrPut(url, file, (pct) => setUploads((p) => p.map((u) => u.id === id ? { ...u, progress: pct } : u)));
        })()
        : (async () => {
          const numParts = Math.ceil(file.size / PART_SIZE);
          const { uploadId } = await sharedInitMultipart(token, key, contentType);
          const partProgress = new Array<number>(numParts).fill(0);
          const updateProg = () => {
            const loaded = partProgress.reduce((a, b) => a + b, 0);
            setUploads((p) => p.map((u) => u.id === id ? { ...u, progress: Math.min(99, Math.round((loaded / file.size) * 100)) } : u));
          };
          const uploadPart = async (partNumber: number) => {
            const start = (partNumber - 1) * PART_SIZE;
            const chunk = file.slice(start, Math.min(start + PART_SIZE, file.size));
            const { url } = await sharedPartUrl(token, key, uploadId, partNumber, chunk.size);
            const etag = await xhrPutPart(url, chunk, (bytes) => { partProgress[partNumber - 1] = bytes; updateProg(); });
            return { PartNumber: partNumber, ETag: etag };
          };
          let parts;
          try {
            parts = await withConcurrency(Array.from({ length: numParts }, (_, i) => () => uploadPart(i + 1)), MAX_CONCURRENT_PARTS);
          } catch (err) {
            await sharedAbortMultipart(token, key, uploadId);
            throw err;
          }
          await sharedCompleteMultipart(token, key, uploadId, parts);
        })();

      run
        .then(() => {
          setUploads((p) => p.map((u) => u.id === id ? { ...u, status: "complete", progress: 100 } : u));
          setTimeout(() => setUploads((p) => p.filter((u) => u.id !== id)), 2000);
          void fetchContents(subPrefix);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Upload failed";
          setUploads((p) => p.map((u) => u.id === id ? { ...u, status: "error", error: msg } : u));
        });
    }
  }

  // ── Delete ──
  async function handleDelete(key: string) {
    const label = key.endsWith("/") ? `folder "${key.replace(/\/$/, "")}"` : `"${key}"`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeletingKey(key);
    try {
      await sharedDeleteFile(token, key);
      void fetchContents(subPrefix);
    } catch {
      alert("Failed to delete");
    } finally {
      setDeletingKey(null);
    }
  }

  // ── Grantees ──
  const loadGrantees = useCallback(async () => {
    setGranteesLoading(true);
    try {
      const { grantees: g } = await sharedListGrantees(token);
      setGrantees(g);
    } catch { /* ignore */ } finally {
      setGranteesLoading(false);
    }
  }, [token]);

  async function handleAddGrantee() {
    const email = addEmail.trim();
    if (!email) return;
    setAddingGrantee(true);
    try {
      await sharedCreateShare(token, [email], addPerm);
      setAddEmail("");
      await loadGrantees();
    } catch { /* ignore */ } finally {
      setAddingGrantee(false);
    }
  }

  async function handleRevokeGrantee(id: string) {
    setRevokingId(id);
    try {
      await sharedRevokeGrantee(token, id);
      setGrantees((g) => g?.filter((r) => r.id !== id) ?? null);
    } catch { /* ignore */ } finally {
      setRevokingId(null);
    }
  }

  // ── Create folder ──
  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      await sharedMkdir(token, subPrefix, name);
      setNewFolderMode(false);
      setNewFolderName("");
      void fetchContents(subPrefix);
    } catch {
      alert("Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  // ── Display name for header ──
  const displayName = shareInfo
    ? shareInfo.path.split("/").filter(Boolean).slice(1).join("/") || shareInfo.path
    : "";

  const activeUploads = uploads.filter((u) => u.status === "uploading" || u.status === "error");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Preview modal */}
      {preview && <PreviewModal entries={preview.entries} initialIndex={preview.initialIndex} onClose={() => setPreview(null)} />}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        {/* Back link + header */}
        <div className="flex items-start justify-between gap-4">
          <a href="/?tab=shared" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors shrink-0 mt-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Shared with me
          </a>
          {shareInfo && (
            <div className="text-right min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
              <p className="text-xs text-slate-500">Shared by {shareInfo.ownerEmail}</p>
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                {PERMISSION_LABELS[perm] ?? perm}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-slate-700">Access denied</p>
            <p className="text-xs text-slate-500">{error}</p>
          </div>
        ) : isFolder ? (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm flex-wrap">
              <button onClick={() => navigateTo(-1)} className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors">
                <Home className="w-3.5 h-3.5" />
                <span>{displayName}</span>
              </button>
              {breadcrumbParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  {i === breadcrumbParts.length - 1 ? (
                    <span className="text-slate-700 font-medium">{part}</span>
                  ) : (
                    <button onClick={() => navigateTo(i)} className="text-blue-600 hover:text-blue-700 transition-colors">{part}</button>
                  )}
                </span>
              ))}
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-end gap-2">
              {canWrite && !newFolderMode && (
                <button
                  onClick={() => {
                    const next = !showGrantees;
                    setShowGrantees(next);
                    if (next && grantees === null) void loadGrantees();
                  }}
                  className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 transition-colors ${showGrantees ? "bg-blue-50 border-blue-200 text-blue-700" : "text-slate-500 hover:text-slate-700 border-slate-200 hover:border-slate-300"}`}
                >
                  <Users className="w-3.5 h-3.5" />
                  People
                  {grantees !== null && <span className="bg-slate-200 text-slate-600 text-xs px-1 py-0.5 rounded-full leading-none">{grantees.length}</span>}
                </button>
              )}
              {canWrite && !newFolderMode && (
                <button
                  onClick={() => setNewFolderMode(true)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> New Folder
                </button>
              )}
              {newFolderMode && (
                <form onSubmit={(e) => void handleCreateFolder(e)} className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
                  />
                  <button type="submit" disabled={creatingFolder || !newFolderName.trim()}
                    className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 hover:bg-blue-700 transition-colors">
                    {creatingFolder ? "…" : "Create"}
                  </button>
                  <button type="button" onClick={() => { setNewFolderMode(false); setNewFolderName(""); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">
                    Cancel
                  </button>
                </form>
              )}
            </div>

            {/* People with access panel */}
            {canWrite && showGrantees && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">People with access</span>
                    {grantees !== null && <span className="bg-slate-100 text-slate-500 text-xs px-1.5 py-0.5 rounded-full">{grantees.length}</span>}
                  </div>
                  <button onClick={() => setShowGrantees(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {granteesLoading ? (
                  <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : (
                  <div>
                    {grantees && grantees.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs text-slate-500 font-medium">
                            <th className="text-left px-5 py-3">Person</th>
                            <th className="text-left px-3 py-3">Access</th>
                            {canShare && <th className="px-5 py-3" />}
                          </tr>
                        </thead>
                        <tbody>
                          {grantees.map((g) => (
                            <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                              <td className="px-5 py-3 text-slate-700 text-sm truncate max-w-[200px]">{g.grantee_email}</td>
                              <td className="px-3 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERMISSION_COLORS[g.permission] ?? "bg-slate-100 text-slate-600"}`}>
                                  {PERMISSION_LABELS[g.permission] ?? g.permission}
                                </span>
                              </td>
                              {canShare && (
                                <td className="px-5 py-3 text-right">
                                  <button
                                    onClick={() => void handleRevokeGrantee(g.id)}
                                    disabled={revokingId === g.id}
                                    title="Remove access"
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                                  >
                                    {revokingId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="px-5 py-6 text-sm text-slate-400 text-center">No other people have access</p>
                    )}
                    {canShare && (
                      <div className="border-t border-slate-100 p-4 space-y-2">
                        <p className="text-xs font-medium text-slate-600">Add person</p>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={addEmail}
                            onChange={(e) => setAddEmail(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void handleAddGrantee(); }}
                            placeholder="email@example.com"
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                          />
                          <select
                            value={addPerm}
                            onChange={(e) => setAddPerm(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white shrink-0"
                          >
                            <option value="read">Read</option>
                            <option value="read_write">Read + Write</option>
                            <option value="read_write_delete">Full Access</option>
                          </select>
                          <button
                            onClick={() => void handleAddGrantee()}
                            disabled={addingGrantee || !addEmail.trim()}
                            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors shrink-0"
                          >
                            {addingGrantee ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            Add
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Upload zone */}
            {canWrite && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFilePick(e.target.files)} />
                <div
                  className="flex flex-col items-center gap-2 p-8 rounded-xl border-2 border-dashed border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50 cursor-pointer transition-all"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFilePick(e.dataTransfer.files); }}
                >
                  <UploadCloud className="w-6 h-6 text-slate-400" />
                  <p className="text-sm text-slate-600 font-medium">Drop files or click to upload</p>
                </div>
              </>
            )}

            {/* Upload progress */}
            {activeUploads.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Uploading</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {activeUploads.map((u) => (
                    <div key={u.id} className="px-5 py-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-slate-700 truncate font-medium">{u.name}</span>
                        <span className="text-xs text-slate-400 tabular-nums shrink-0">
                          {u.status === "error" ? <span className="text-red-500">Failed</span> : `${u.progress}%`}
                        </span>
                      </div>
                      {u.status === "error"
                        ? <p className="text-xs text-red-500">{u.error}</p>
                        : <ProgressBar progress={u.progress} status={u.status} />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File list */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {entries.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">This folder is empty</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 font-medium">
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-3 py-3 hidden sm:table-cell">Size</th>
                      <th className="text-left px-3 py-3 hidden md:table-cell">Modified</th>
                      <th className="text-left px-3 py-3">Access</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const name = entry.key.split("/").filter(Boolean).pop() ?? entry.key;
                      const isDir = entry.type === "folder";
                      const previewable = !isDir && canPreview(entry.key);
                      const isDel = deletingKey === entry.key;
                      const fp = !isDir ? filePerms[entry.key] : undefined;
                      const hasOverride = fp !== undefined && (PERMISSION_RANK_MAP[fp] ?? 0) > (PERMISSION_RANK_MAP[perm] ?? 0);
                      return (
                        <tr key={entry.key} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              {isDir
                                ? <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                                : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                              {isDir ? (
                                <button
                                  onClick={() => setSubPrefix(entry.key)}
                                  className="text-slate-700 hover:text-blue-600 font-medium truncate max-w-[200px] text-left transition-colors"
                                >
                                  {name}
                                </button>
                              ) : (
                                <span className="text-slate-700 font-medium truncate max-w-[200px]">{name}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 hidden sm:table-cell text-slate-500 text-xs">
                            {!isDir && entry.size ? formatSize(entry.size) : "—"}
                          </td>
                          <td className="px-3 py-3 hidden md:table-cell text-slate-500 text-xs">
                            {entry.lastModified ? formatDate(entry.lastModified) : "—"}
                          </td>
                          <td className="px-3 py-3">
                            {hasOverride && fp && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERMISSION_COLORS[fp] ?? "bg-slate-100 text-slate-600"}`}>
                                {PERMISSION_LABELS[fp] ?? fp}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {previewable && (
                                <button
                                  onClick={() => {
                                    const fileEntries = entries.filter((e) => e.type === "file");
                                    const idx = fileEntries.findIndex((e) => e.key === entry.key);
                                    setPreview({
                                      entries: fileEntries.map((e) => ({
                                        key: e.key,
                                        fetchUrl: () => sharedPreviewUrl(token, e.key),
                                        fetchDownloadUrl: () => sharedDownloadUrl(token, e.key),
                                      })),
                                      initialIndex: Math.max(0, idx),
                                    });
                                  }}
                                  title="Preview"
                                  className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors rounded-md hover:bg-blue-50"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                              {!isDir && (
                                <button
                                  onClick={async () => {
                                    const { url } = await sharedDownloadUrl(token, entry.key);
                                    window.open(url, "_blank", "noopener,noreferrer");
                                  }}
                                  title="Download"
                                  className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors rounded-md hover:bg-slate-100"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => void handleDelete(entry.key)}
                                  disabled={isDel}
                                  title="Delete"
                                  className="p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors rounded-md hover:bg-red-50"
                                >
                                  {isDel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          /* Single-file share */
          shareInfo && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                    <FileText className="w-7 h-7 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{displayName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Shared by {shareInfo.ownerEmail}</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  {canPreview(shareInfo.path) && (
                    <button
                      onClick={() => setPreview({
                        entries: [{
                          key: shareInfo.path,
                          fetchUrl: () => sharedPreviewUrl(token, ""),
                          fetchDownloadUrl: () => sharedDownloadUrl(token, ""),
                        }],
                        initialIndex: 0,
                      })}
                      className="flex-1 flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium py-2.5 rounded-xl transition-colors"
                    >
                      <Eye className="w-4 h-4" /> Preview
                    </button>
                  )}
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                    >
                      <Download className="w-4 h-4" /> Download
                    </a>
                  )}
                  {canWrite && (
                    <button
                      onClick={() => {
                        const next = !showGrantees;
                        setShowGrantees(next);
                        if (next && grantees === null) void loadGrantees();
                      }}
                      className={`flex items-center justify-center gap-2 border text-sm font-medium py-2.5 px-4 rounded-xl transition-colors ${showGrantees ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 hover:bg-slate-50 text-slate-700"}`}
                    >
                      <Users className="w-4 h-4" /> People
                    </button>
                  )}
                </div>
              </div>
              {canWrite && showGrantees && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-medium text-slate-700">People with access</span>
                      {grantees !== null && <span className="bg-slate-100 text-slate-500 text-xs px-1.5 py-0.5 rounded-full">{grantees.length}</span>}
                    </div>
                    <button onClick={() => setShowGrantees(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {granteesLoading ? (
                    <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                  ) : (
                    <div>
                      {grantees && grantees.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-xs text-slate-500 font-medium">
                              <th className="text-left px-5 py-3">Person</th>
                              <th className="text-left px-3 py-3">Access</th>
                              {canShare && <th className="px-5 py-3" />}
                            </tr>
                          </thead>
                          <tbody>
                            {grantees.map((g) => (
                              <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-3 text-slate-700 text-sm truncate max-w-[200px]">{g.grantee_email}</td>
                                <td className="px-3 py-3">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERMISSION_COLORS[g.permission] ?? "bg-slate-100 text-slate-600"}`}>
                                    {PERMISSION_LABELS[g.permission] ?? g.permission}
                                  </span>
                                </td>
                                {canShare && (
                                  <td className="px-5 py-3 text-right">
                                    <button
                                      onClick={() => void handleRevokeGrantee(g.id)}
                                      disabled={revokingId === g.id}
                                      title="Remove access"
                                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                                    >
                                      {revokingId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="px-5 py-6 text-sm text-slate-400 text-center">No other people have access</p>
                      )}
                      {canShare && (
                        <div className="border-t border-slate-100 p-4 space-y-2">
                          <p className="text-xs font-medium text-slate-600">Add person</p>
                          <div className="flex gap-2">
                            <input
                              type="email"
                              value={addEmail}
                              onChange={(e) => setAddEmail(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void handleAddGrantee(); }}
                              placeholder="email@example.com"
                              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                            />
                            <select
                              value={addPerm}
                              onChange={(e) => setAddPerm(e.target.value)}
                              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white shrink-0"
                            >
                              <option value="read">Read</option>
                              <option value="read_write">Read + Write</option>
                              <option value="read_write_delete">Full Access</option>
                            </select>
                            <button
                              onClick={() => void handleAddGrantee()}
                              disabled={addingGrantee || !addEmail.trim()}
                              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors shrink-0"
                            >
                              {addingGrantee ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
