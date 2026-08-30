import { useEffect, useState } from "react";
import { Download, Folder, FileText, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { getSharedItem } from "../lib/api";
import type { SharedItemResponse } from "../lib/api";

interface SharedItemViewProps {
  token: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read-only",
  read_write: "Read + Write",
  read_write_delete: "Full Access",
};

export function SharedItemView({ token }: SharedItemViewProps) {
  const [data, setData] = useState<SharedItemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getSharedItem(token)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load shared item")
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleDownload() {
    if (!data?.downloadUrl) return;
    setDownloading(true);
    window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => setDownloading(false), 1500);
  }

  const displayName = data
    ? data.share.path.split("/").filter(Boolean).slice(1).join("/") || data.share.path
    : "";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm w-full max-w-md p-8 space-y-6">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to My Files
        </a>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-slate-700">Access denied</p>
            <p className="text-xs text-slate-500">{error}</p>
          </div>
        ) : data ? (
          <>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                {data.share.isFolder
                  ? <Folder className="w-7 h-7 text-amber-400" />
                  : <FileText className="w-7 h-7 text-blue-400" />}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{displayName}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Shared by {data.share.ownerEmail}
                </p>
                <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                  {PERMISSION_LABELS[data.share.permission] ?? data.share.permission}
                </span>
              </div>
            </div>

            {data.share.isFolder && data.entries && data.entries.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                  Contents
                </p>
                <div className="divide-y divide-slate-50 border border-slate-100 rounded-lg overflow-hidden">
                  {data.entries.map((e) => (
                    <div key={e.key} className="flex items-center gap-2.5 px-3 py-2.5">
                      {e.type === "folder"
                        ? <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                        : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="text-sm text-slate-700 truncate">
                        {e.key.split("/").filter(Boolean).pop() ?? e.key}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : data.share.isFolder ? (
              <p className="text-sm text-slate-400 text-center py-4">This folder is empty</p>
            ) : null}

            {!data.share.isFolder && data.downloadUrl && (
              <button
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
              >
                {downloading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />}
                {downloading ? "Opening…" : "Download file"}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
