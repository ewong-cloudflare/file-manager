import { useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  File,
  Folder,
  Trash2,
  RefreshCw,
  Share2,
  FolderInput,
  X,
} from "lucide-react";
import { getPreviewUrl, getDownloadToken, PAGE_SIZE_OPTIONS } from "../lib/api";
import type { FileItem, PageSize } from "../lib/api";
import { PreviewModal, canPreview } from "./PreviewModal";
import type { PreviewEntry } from "./PreviewModal";

interface FileListProps {
  files: FileItem[];
  loading: boolean;
  onDownload: (key: string) => void;
  onDelete: (key: string) => void;
  onRefresh: () => void;
  onNavigate: (prefix: string) => void;
  onShare: (key: string, isFolder: boolean) => void;
  onMove: (keys: string[]) => void;
  onBulkDelete: (keys: string[]) => void;
  downloadingKey: string | null;
  deletingKey: string | null;
  truncated: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
}

function fileIcon(entry: FileItem) {
  if (entry.type === "folder") return <Folder className="w-4 h-4 text-amber-400" />;
  const ext = entry.key.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext))
    return <Image className="w-4 h-4 text-violet-500" />;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return <Film className="w-4 h-4 text-pink-500" />;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return <Music className="w-4 h-4 text-amber-500" />;
  if (["pdf", "doc", "docx", "txt", "md", "csv", "xls", "xlsx"].includes(ext))
    return <FileText className="w-4 h-4 text-blue-500" />;
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext))
    return <Archive className="w-4 h-4 text-orange-500" />;
  return <File className="w-4 h-4 text-slate-400" />;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayName(key: string): string {
  const parts = key.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? key;
}

export function FileList({
  files,
  loading,
  onDownload,
  onDelete,
  onRefresh,
  onNavigate,
  onShare,
  onMove,
  onBulkDelete,
  downloadingKey,
  deletingKey,
  truncated,
  loadingMore,
  onLoadMore,
  pageSize,
  onPageSizeChange,
}: FileListProps) {
  const [previewState, setPreviewState] = useState<{ entries: PreviewEntry[]; initialIndex: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allKeys = files.map((f) => f.key);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function openPreview(entry: FileItem) {
    const allFiles = files.filter((f) => f.type === "file");
    const idx = allFiles.findIndex((f) => f.key === entry.key);
    setPreviewState({
      entries: allFiles.map((f) => ({
        key: f.key,
        fetchUrl: () => getPreviewUrl(f.key),
        fetchDownloadUrl: async () => {
          const { tokenUrl } = await getDownloadToken(f.key);
          return { url: tokenUrl };
        },
      })),
      initialIndex: Math.max(0, idx),
    });
  }

  return (
    <>
      {previewState && (
        <PreviewModal entries={previewState.entries} initialIndex={previewState.initialIndex} onClose={() => setPreviewState(null)} />
      )}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">
            Files &amp; Folders
            {!loading && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                {files.length} item{files.length !== 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Show
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
                disabled={loading}
                className="border border-slate-200 rounded-md text-xs py-1 pl-2 pr-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              per page
            </label>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {someSelected && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-blue-50 border-b border-blue-100">
            <span className="text-xs font-medium text-blue-700">
              {selected.size} selected
            </span>
            <button
              onClick={() => { onMove(Array.from(selected)); }}
              className="flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-100 px-2.5 py-1.5 rounded-md transition-colors"
            >
              <FolderInput className="w-3.5 h-3.5" />
              Move to…
            </button>
            <button
              onClick={() => { onBulkDelete(Array.from(selected)); clearSelection(); }}
              className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-3 animate-pulse">
                <div className="w-4 h-4 bg-slate-200 rounded" />
                <div className="flex-1 h-3 bg-slate-200 rounded" />
                <div className="w-16 h-3 bg-slate-100 rounded" />
                <div className="w-28 h-3 bg-slate-100 rounded" />
                <div className="w-16 h-3 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Folder className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">This folder is empty</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-400 uppercase tracking-wide bg-slate-50">
                  <th className="pl-4 pr-2 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-5 py-3 text-right">Size</th>
                  <th className="px-5 py-3">Modified</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {files.map((entry) => (
                  <tr
                    key={entry.key}
                    className={`hover:bg-slate-50 transition-colors group ${selected.has(entry.key) ? "bg-blue-50/60" : ""}`}
                  >
                    <td className="pl-4 pr-2 py-3.5 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.key)}
                        onChange={() => toggleOne(entry.key)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {fileIcon(entry)}
                        {entry.type === "folder" ? (
                          <button
                            onClick={() => onNavigate(entry.key)}
                            className="truncate text-slate-700 font-medium hover:text-blue-600 transition-colors text-left"
                            title={entry.key}
                          >
                            {displayName(entry.key)}
                          </button>
                        ) : (
                          <button
                            onClick={() => openPreview(entry)}
                            className="truncate text-slate-700 font-medium hover:text-blue-600 transition-colors text-left"
                            title={entry.key}
                          >
                            {displayName(entry.key)}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-500 whitespace-nowrap tabular-nums">
                      {entry.type === "folder" ? "—" : formatSize(entry.size ?? 0)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap text-xs">
                      {entry.lastModified ? formatDate(entry.lastModified) : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onShare(entry.key, entry.type === "folder")}
                          title="Share"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Share</span>
                        </button>
                        {entry.type === "file" && canPreview(entry.key) && (
                          <button
                            onClick={() => openPreview(entry)}
                            title="Preview"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Preview</span>
                          </button>
                        )}
                        {entry.type === "file" && (
                          <button
                            onClick={() => onDownload(entry.key)}
                            disabled={downloadingKey === entry.key}
                            title="Generate one-time download link"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingKey === entry.key ? "…" : "Download"}
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(entry.key)}
                          disabled={deletingKey === entry.key}
                          title={entry.type === "folder" ? "Delete folder" : "Delete file"}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {deletingKey === entry.key ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && truncated && (
          <div className="flex items-center justify-center py-3 border-t border-slate-100">
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
