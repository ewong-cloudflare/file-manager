import { useCallback, useEffect, useState } from "react";
import { FolderOpen, FileText, Eye, RefreshCw, Loader2, Inbox, ExternalLink } from "lucide-react";
import { listSharedWithMe, sharedPreviewUrl, sharedDownloadUrl } from "../lib/api";
import type { ShareRecord } from "../lib/api";
import { PreviewModal, canPreview } from "./PreviewModal";
import type { PreviewEntry } from "./PreviewModal";

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read",
  read_write: "Read + Write",
  read_write_delete: "Full Access",
};

const PERMISSION_COLORS: Record<string, string> = {
  read: "bg-slate-100 text-slate-600",
  read_write: "bg-blue-50 text-blue-700",
  read_write_delete: "bg-amber-50 text-amber-700",
};

interface SharedWithMeProps {
  onToast: (message: string, type: "success" | "error") => void;
}

export function SharedWithMe({ onToast }: SharedWithMeProps) {
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewState, setPreviewState] = useState<{ entries: PreviewEntry[]; initialIndex: number } | null>(null);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const { shares: fetched } = await listSharedWithMe();
      setShares(fetched);
    } catch {
      onToast("Failed to load shared items", "error");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  function openShare(share: ShareRecord) {
    window.location.href = `/shared/${share.link_token}`;
  }

  function openPreview(share: ShareRecord) {
    setPreviewState({
      entries: [{
        key: share.path,
        fetchUrl: () => sharedPreviewUrl(share.link_token, ""),
        fetchDownloadUrl: () => sharedDownloadUrl(share.link_token, ""),
      }],
      initialIndex: 0,
    });
  }

  function fileDisplayName(share: ShareRecord) {
    return share.path.split("/").filter(Boolean).pop() ?? share.path;
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function displayPath(share: ShareRecord) {
    const parts = share.path.split("/").filter(Boolean);
    return parts.slice(1).join("/") || parts[parts.length - 1];
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <>
      {previewState && (
        <PreviewModal entries={previewState.entries} initialIndex={previewState.initialIndex} onClose={() => setPreviewState(null)} />
      )}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Shared with me</span>
            {shares.length > 0 && (
              <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                {shares.length}
              </span>
            )}
          </div>
          <button
            onClick={() => void fetchShares()}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {shares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <Inbox className="w-8 h-8" />
            <p className="text-sm">Nothing shared with you yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500 font-medium">
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-3 py-3 hidden sm:table-cell">Shared by</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Permission</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Shared on</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {share.is_folder ? (
                        <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className="text-slate-700 truncate max-w-[160px]">{displayPath(share)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 hidden sm:table-cell text-slate-500 text-xs truncate max-w-[140px]">
                    {share.owner_email}
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERMISSION_COLORS[share.permission] ?? "bg-slate-100 text-slate-600"}`}>
                      {PERMISSION_LABELS[share.permission] ?? share.permission}
                    </span>
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell text-slate-500 text-xs">
                    {formatDate(share.created_at)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {!share.is_folder && canPreview(fileDisplayName(share)) && (
                        <button
                          onClick={() => openPreview(share)}
                          title="Preview"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1.5 rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Preview</span>
                        </button>
                      )}
                      <button
                        onClick={() => openShare(share)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1.5 rounded-md font-medium transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{share.is_folder ? "Open" : "Open"}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
