import { useCallback, useEffect, useState } from "react";
import { AlertCircle, X, CheckCircle2 } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { FileList } from "./components/FileList";
import { Header } from "./components/Header";
import { Breadcrumb } from "./components/Breadcrumb";
import { ShareModal } from "./components/ShareModal";
import { SharedWithMe } from "./components/SharedWithMe";
import { getDownloadToken, deleteFile, listFiles, getMe } from "./lib/api";
import type { FileItem, UserInfo } from "./lib/api";
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

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("myfiles");
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

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
      const { entries } = await listFiles(currentPrefix);
      setFiles(entries);
    } catch {
      addToast("Failed to load file list", "error");
    } finally {
      setFilesLoading(false);
    }
  }, [addToast, currentPrefix]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const handleNavigate = useCallback((prefix: string) => {
    setCurrentPrefix(prefix);
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

  return (
    <div className="min-h-screen bg-slate-50">
      <Header user={user} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex items-center gap-4 border-b border-slate-200 pb-0">
          <button
            onClick={() => setActiveTab("myfiles")}
            className={`text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeTab === "myfiles"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            My Files
          </button>
          <button
            onClick={() => setActiveTab("shared")}
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
            <Breadcrumb prefix={currentPrefix} onNavigate={handleNavigate} />
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
              downloadingKey={downloadingKey}
              deletingKey={deletingKey}
            />
          </>
        ) : (
          <SharedWithMe onToast={addToast} />
        )}
      </main>

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
