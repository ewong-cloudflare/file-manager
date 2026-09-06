import { useEffect, useState } from "react";
import { ChevronRight, Folder, Home, X } from "lucide-react";
import { listFiles } from "../lib/api";
import type { FileItem } from "../lib/api";

interface MoveModalProps {
  keys: string[];
  currentPrefix: string;
  onConfirm: (destinationPrefix: string) => void;
  onClose: () => void;
  moving: boolean;
}

function displayName(key: string): string {
  return key.replace(/\/$/, "").split("/").pop() ?? key;
}

export function MoveModal({ keys, currentPrefix, onConfirm, onClose, moving }: MoveModalProps) {
  const [browsePrefix, setBrowsePrefix] = useState("");
  const [folders, setFolders] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    listFiles(browsePrefix)
      .then(({ entries }) => setFolders(entries.filter((e) => e.type === "folder")))
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, [browsePrefix]);

  const breadcrumbs = browsePrefix
    ? browsePrefix.replace(/\/$/, "").split("/")
    : [];

  function navigateTo(prefix: string) {
    setBrowsePrefix(prefix);
  }

  const isDestinationSameAsSource = browsePrefix === currentPrefix;
  const movingIntoSelf = keys.some(
    (k) => k.endsWith("/") && browsePrefix.startsWith(k)
  );
  const canMove = !isDestinationSameAsSource && !movingIntoSelf && !moving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Move {keys.length} item{keys.length !== 1 ? "s" : ""}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Select a destination folder</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex-wrap">
          <button
            onClick={() => navigateTo("")}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            My Files
          </button>
          {breadcrumbs.map((crumb, i) => {
            const prefix = breadcrumbs.slice(0, i + 1).join("/") + "/";
            return (
              <span key={prefix} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 text-slate-300" />
                <button
                  onClick={() => navigateTo(prefix)}
                  className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {crumb}
                </button>
              </span>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-72 divide-y divide-slate-50">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-xs">Loading…</div>
          ) : folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <Folder className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">No subfolders here</p>
            </div>
          ) : (
            folders.map((f) => (
              <button
                key={f.key}
                onClick={() => navigateTo(f.key)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-left transition-colors"
              >
                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-sm text-slate-700 truncate">{displayName(f.key)}</span>
                <ChevronRight className="w-4 h-4 text-slate-300 ml-auto shrink-0" />
              </button>
            ))
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 truncate">
            Moving to: <span className="font-medium text-slate-700">{browsePrefix || "My Files (root)"}</span>
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(browsePrefix)}
              disabled={!canMove}
              title={movingIntoSelf ? "Cannot move a folder into itself" : isDestinationSameAsSource ? "Already in this location" : ""}
              className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {moving ? "Moving…" : "Move Here"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
