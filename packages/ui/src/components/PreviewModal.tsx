import { useEffect, useState } from "react";
import { X, Download, ExternalLink, Loader2, AlertCircle } from "lucide-react";

export interface PreviewTarget {
  key: string;
  fetchUrl: () => Promise<{ previewUrl: string }>;
}

interface PreviewModalProps {
  target: PreviewTarget;
  onClose: () => void;
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "ogv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "aac"]);
const TEXT_EXTS = new Set([
  "txt", "md", "json", "csv", "xml", "yaml", "yml",
  "js", "ts", "tsx", "jsx", "css", "html", "py", "sh",
  "go", "rs", "java", "c", "cpp", "h", "rb", "php",
]);

type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "unsupported";

export function previewKind(key: string): PreviewKind {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unsupported";
}

export function canPreview(key: string): boolean {
  return previewKind(key) !== "unsupported";
}

export function PreviewModal({ target, onClose }: PreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = target.key.split("/").filter(Boolean).pop() ?? target.key;
  const kind = previewKind(target.key);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    setTextContent(null);

    target.fetchUrl()
      .then(async ({ previewUrl }) => {
        if (cancelled) return;
        if (kind === "text") {
          const res = await fetch(previewUrl);
          const text = await res.text();
          if (!cancelled) {
            setUrl(previewUrl);
            setTextContent(text);
          }
        } else {
          if (!cancelled) setUrl(previewUrl);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [target, kind]);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0 gap-3">
          <span className="text-sm font-medium text-slate-800 truncate">{fileName}</span>
          <div className="flex items-center gap-2 shrink-0">
            {url && (
              <>
                <a
                  href={url}
                  download={fileName}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in new tab
                </a>
              </>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto flex items-center justify-center bg-slate-50 min-h-0">
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 text-center p-8">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-slate-600">{error}</p>
            </div>
          ) : url ? (
            <>
              {kind === "image" && (
                <img
                  src={url}
                  alt={fileName}
                  className="max-w-full max-h-full object-contain p-4"
                />
              )}
              {kind === "video" && (
                <video
                  src={url}
                  controls
                  className="max-w-full max-h-full"
                  style={{ maxHeight: "calc(92vh - 60px)" }}
                />
              )}
              {kind === "audio" && (
                <div className="p-8 w-full max-w-md">
                  <audio src={url} controls className="w-full" />
                </div>
              )}
              {kind === "pdf" && (
                <iframe
                  src={url}
                  title={fileName}
                  className="w-full h-full border-0"
                  style={{ minHeight: "600px" }}
                />
              )}
              {kind === "text" && (
                <pre className="w-full h-full p-6 text-xs text-slate-700 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {textContent}
                </pre>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
