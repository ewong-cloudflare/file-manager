import { useCallback, useEffect, useState } from "react";
import { AlertCircle, X, CheckCircle2 } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { FileList } from "./components/FileList";
import { Header } from "./components/Header";
import { Breadcrumb } from "./components/Breadcrumb";
import { ShareModal } from "./components/ShareModal";
import { SharedWithMe } from "./components/SharedWithMe";
import { SharedItemView } from "./components/SharedItemView";
import { MoveModal } from "./components/MoveModal";
import { getDownloadToken, deleteFile, listFiles, getMe, createFolder, moveItems, PAGE_SIZE_OPTIONS } from "./lib/api";
import type { FileItem, UserInfo, PageSize } from "./lib/api";
import type { UploadItem } from "./components/UploadZone";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

type Tab = "myfiles" | "shared";

interface ShareTarget {
  key: string;
  isFolder: boolean;
}

function FileManagerApp() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesLoadingMore, setFilesLoadingMore] = useState(false);
  const [filesCursor, setFilesCursor] = useState<string | null>(null);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZE_OPTIONS[0]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    return (p === "shared" ? "shared" : "myfiles") as Tab;
  });

  const switchTab = (tab: Tab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    history.replaceState(null, "", url.toString());
    setActiveTab(tab);
  };
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    getMe().then(setUser).catch(() => {});
  }, []);

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const { entries, truncated, cursor } = await listFiles(currentPrefix, undefined, pageSize);
      setFiles(entries);
      setFilesTruncated(truncated);
      setFilesCursor(cursor);
    } catch {
      addToast("Failed to load file list", "error");
    } finally {
      setFilesLoading(false);
    }
  }, [addToast, currentPrefix, pageSize]);

  const handleLoadMore = useCallback(async () => {
    if (!filesCursor) return;
    setFilesLoadingMore(true);
    try {
      const { entries, truncated, cursor } = await listFiles(currentPrefix, filesCursor, pageSize);
      setFiles((prev) => [...prev, ...entries]);
      setFilesTruncated(truncated);
      setFilesCursor(cursor);
    } catch {
      addToast("Failed to load more items", "error");
    } finally {
      setFilesLoadingMore(false);
    }
  }, [addToast, currentPrefix, filesCursor, pageSize]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const handleNavigate = useCallback((prefix: string) => {
    setCurrentPrefix(prefix);
  }, []);

  const handlePageSizeChange = useCallback((size: PageSize) => {
    setPageSize(size);
  }, []);

  const handleUploadStart = useCallback((id: string, name: string, size: number) => {
    setUploads((prev) => [...prev, { id, name, size, progress: 0, status: "uploading" }]);
  }, []);

  const handleUploadProgress = useCallback((id: string, progress: number) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress } : u)));
  }, []);

  const handleUploadComplete = useCallback(
    (id: string) => {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: "complete", progress: 100 } : u))
      );
      setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 2000);
      void fetchFiles();
      addToast("File uploaded successfully", "success");
    },
    [fetchFiles, addToast]
  );

  const handleUploadError = useCallback(
    (id: string, error: string) => {
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: "error", error } : u)));
      addToast(`Upload failed: ${error}`, "error");
    },
    [addToast]
  );

  const handleDownload = useCallback(
    async (key: string) => {
      setDownloadingKey(key);
      try {
        const { tokenUrl } = await getDownloadToken(key);
        window.open(tokenUrl, "_blank", "noopener,noreferrer");
      } catch {
        addToast("Failed to generate download link", "error");
      } finally {
        setDownloadingKey(null);
      }
    },
    [addToast]
  );

  const handleDelete = useCallback(
    async (key: string) => {
      if (!window.confirm(`Delete "${key}"? This cannot be undone.`)) return;
      setDeletingKey(key);
      try {
        await deleteFile(key);
        addToast(`Deleted successfully`, "success");
        void fetchFiles();
      } catch {
        addToast("Failed to delete", "error");
      } finally {
        setDeletingKey(null);
      }
    },
    [fetchFiles, addToast]
  );

  const handleShare = useCallback((key: string, isFolder: boolean) => {
    setShareTarget({ key, isFolder });
  }, []);

  const handleMove = useCallback((keys: string[]) => {
    setMoveKeys(keys);
  }, []);

  const handleMoveConfirm = useCallback(
    async (destinationPrefix: string) => {
      if (!moveKeys) return;
      setMoving(true);
      try {
        await moveItems(moveKeys, destinationPrefix);
        addToast(`Moved ${moveKeys.length} item${moveKeys.length !== 1 ? "s" : ""} successfully`, "success");
        setMoveKeys(null);
        void fetchFiles();
      } catch {
        addToast("Failed to move items", "error");
      } finally {
        setMoving(false);
      }
    },
    [moveKeys, fetchFiles, addToast]
  );

  const handleBulkDelete = useCallback(
    async (keys: string[]) => {
      if (!window.confirm(`Delete ${keys.length} item${keys.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
      try {
        await Promise.all(keys.map((k) => deleteFile(k)));
        addToast(`Deleted ${keys.length} item${keys.length !== 1 ? "s" : ""}`, "success");
        void fetchFiles();
      } catch {
        addToast("Failed to delete some items", "error");
      }
    },
    [fetchFiles, addToast]
  );

  const handleCreateFolder = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = newFolderName.trim();
      if (!name) return;
      setCreatingFolder(true);
      try {
        await createFolder(currentPrefix, name);
        setNewFolderMode(false);
        setNewFolderName("");
        const newFolderKey = `${currentPrefix}${name}/`;
        setFiles((prev) =>
          prev.some((f) => f.key === newFolderKey)
            ? prev
            : [{ key: newFolderKey, type: "folder" }, ...prev]
        );
        addToast(`Folder "${name}" created`, "success");
        setTimeout(() => void fetchFiles(), 1500);
      } catch {
        addToast("Failed to create folder", "error");
      } finally {
        setCreatingFolder(false);
      }
    },
    [currentPrefix, newFolderName, fetchFiles, addToast]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Header user={user} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex items-center gap-4 border-b border-slate-200 pb-0">
          <button
            onClick={() => switchTab("myfiles")}
            className={`text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeTab === "myfiles"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            My Files
          </button>
          <button
            onClick={() => switchTab("shared")}
            className={`text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeTab === "shared"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Shared with me
          </button>
        </div>

        {activeTab === "myfiles" ? (
          <>
            <div className="flex items-center justify-between">
              <Breadcrumb prefix={currentPrefix} onNavigate={handleNavigate} />
              {!newFolderMode ? (
                <button
                  onClick={() => setNewFolderMode(true)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  <span className="text-base leading-none">+</span> New Folder
                </button>
              ) : (
                <form onSubmit={(e) => void handleCreateFolder(e)} className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                  />
                  <button
                    type="submit"
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 hover:bg-blue-700 transition-colors"
                  >
                    {creatingFolder ? "…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewFolderMode(false); setNewFolderName(""); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
            <UploadZone
              uploads={uploads}
              currentPrefix={currentPrefix}
              onUploadStart={handleUploadStart}
              onUploadProgress={handleUploadProgress}
              onUploadComplete={handleUploadComplete}
              onUploadError={handleUploadError}
            />
            <FileList
              files={files}
              loading={filesLoading}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onRefresh={fetchFiles}
              onNavigate={handleNavigate}
              onShare={handleShare}
              onMove={handleMove}
              onBulkDelete={handleBulkDelete}
              downloadingKey={downloadingKey}
              deletingKey={deletingKey}
              truncated={filesTruncated}
              loadingMore={filesLoadingMore}
              onLoadMore={handleLoadMore}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        ) : (
          <SharedWithMe onToast={addToast} />
        )}
      </main>

      {moveKeys && (
        <MoveModal
          keys={moveKeys}
          currentPrefix={currentPrefix}
          onConfirm={handleMoveConfirm}
          onClose={() => setMoveKeys(null)}
          moving={moving}
        />
      )}

      {shareTarget && (
        <ShareModal
          itemKey={shareTarget.key}
          isFolder={shareTarget.isFolder}
          onClose={() => setShareTarget(null)}
        />
      )}

      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm pointer-events-auto max-w-sm transition-all ${
              toast.type === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const m = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  if (m) return <SharedItemView token={m[1]} />;
  return <FileManagerApp />;
}
