import { useEffect, useState } from "react";
import { X, Download, ExternalLink, Loader2, AlertCircle, ChevronLeft, ChevronRight, FileText } from "lucide-react";

export interface PreviewEntry {
  key: string;
  fetchUrl: () => Promise<{ url: string }>;
  fetchDownloadUrl?: () => Promise<{ url: string }>;
}

interface PreviewModalProps {
  entries: PreviewEntry[];
  initialIndex: number;
  onClose: () => void;
}

// All formats browsers can natively render (Chrome/Firefox/Safari modern)
const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico",
  "avif", "apng", "tiff", "tif", "heic", "heif",
]);

const VIDEO_EXTS = new Set([
  "mp4", "webm", "ogv", "ogg", "mov", "m4v", "3gp", "mkv", "avi",
]);

const AUDIO_EXTS = new Set([
  "mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "weba", "aiff", "aif",
]);

// Office formats — previewed via Microsoft Office Online viewer (no auth required, URL must be public/pre-signed)
const OFFICE_EXTS = new Set([
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf",
]);

const TEXT_EXTS = new Set([
  // Prose & docs
  "txt", "md", "markdown", "rst", "tex", "adoc",
  // Data / config
  "json", "jsonl", "ndjson", "json5",
  "csv", "tsv",
  "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  // Web
  "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "css", "scss", "sass", "less", "styl",
  "html", "htm", "xhtml", "vue", "svelte", "astro",
  // Systems & backend
  "py", "pyi", "pyw",
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  "go", "mod",
  "rs",
  "c", "cpp", "cc", "cxx", "h", "hpp", "hxx",
  "java", "kt", "kts", "scala", "groovy", "gradle",
  "rb", "erb",
  "php",
  "lua",
  "pl", "pm",
  "r",
  "swift",
  "m", "mm",
  "dart",
  "ex", "exs", "erl", "hrl",
  "zig", "nim", "cr",
  "elm", "ml", "mli", "fs", "fsx", "fsi",
  "clj", "cljs", "cljc",
  "hs", "lhs",
  "vim", "vimrc",
  // DB / query
  "sql", "ddl", "dml",
  // API / schema
  "graphql", "gql", "proto",
  // Infra / IaC
  "tf", "tfvars", "hcl",
  "nix", "dhall",
  "dockerfile", "containerfile",
  // CI / config files (no extension — matched below)
  // Logs & diffs
  "log", "diff", "patch",
  // Misc
  "gitignore", "gitattributes", "gitmodules",
  "editorconfig", "prettierrc", "eslintrc", "babelrc",
  "makefile", "cmake",
  "lock",
  "srt", "vtt",
]);

type PreviewKind = "image" | "video" | "audio" | "pdf" | "office" | "text" | "unsupported";

export function previewKind(key: string): PreviewKind {
  const filename = key.split("/").pop() ?? key;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  // Extensionless files known to be text (Dockerfile, Makefile, etc.)
  const noExt = ["dockerfile", "makefile", "gemfile", "rakefile", "procfile", "vagrantfile", "jenkinsfile"];
  if (noExt.includes(filename.toLowerCase())) return "text";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unsupported";
}

export function canPreview(key: string): boolean {
  return previewKind(key) !== "unsupported";
}

export function PreviewModal({ entries, initialIndex, onClose }: PreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const entry = entries[currentIndex];
  const fileName = entry?.key.split("/").filter(Boolean).pop() ?? entry?.key ?? "";
  const kind = entry ? previewKind(entry.key) : "unsupported";
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < entries.length - 1;

  useEffect(() => {
    setImgError(false);
    if (!entry || kind === "unsupported") {
      setLoading(false);
      setUrl(null);
      setTextContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    setTextContent(null);

    entry.fetchUrl()
      .then(async (res: { url: string }) => {
        if (cancelled) return;
        if (kind === "text") {
          const r = await fetch(res.url);
          const text = await r.text();
          if (!cancelled) { setUrl(res.url); setTextContent(text); }
        } else {
          if (!cancelled) setUrl(res.url);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [entry, kind]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && hasPrev) setCurrentIndex((i) => i - 1);
      if (e.key === "ArrowRight" && hasNext) setCurrentIndex((i) => i + 1);
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onClose]);

  async function handleDownload() {
    if (!entry) return;
    setDownloading(true);
    try {
      const fn = entry.fetchDownloadUrl ?? entry.fetchUrl;
      const { url: dlUrl } = await fn();
      window.open(dlUrl, "_blank", "noopener,noreferrer");
    } finally {
      setTimeout(() => setDownloading(false), 1000);
    }
  }

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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0">
          {/* Prev / Next */}
          {entries.length > 1 && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                disabled={!hasPrev}
                onClick={() => setCurrentIndex((i) => i - 1)}
                title="Previous (←)"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-400 tabular-nums w-12 text-center select-none">
                {currentIndex + 1} / {entries.length}
              </span>
              <button
                disabled={!hasNext}
                onClick={() => setCurrentIndex((i) => i + 1)}
                title="Next (→)"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <span className="text-sm font-medium text-slate-800 truncate flex-1 min-w-0">{fileName}</span>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? "…" : "Download"}
            </button>
            {url && kind !== "unsupported" && kind !== "office" && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                New tab
              </a>
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
          {kind === "unsupported" ? (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
              <FileText className="w-14 h-14 text-slate-200" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-600">File preview is not available</p>
                <p className="text-xs text-slate-400">Download the file to view its contents</p>
              </div>
              <button
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {downloading ? "Opening…" : "Download file"}
              </button>
            </div>
          ) : loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 text-center p-8">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-slate-600">{error}</p>
            </div>
          ) : url ? (
            <>
              {kind === "image" && (
                imgError ? (
                  <div className="flex flex-col items-center gap-4 p-8 text-center">
                    <FileText className="w-14 h-14 text-slate-200" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-600">Image cannot be displayed in this browser</p>
                      <p className="text-xs text-slate-400">This format may require a different viewer</p>
                    </div>
                    <button onClick={() => void handleDownload()} disabled={downloading}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
                      <Download className="w-4 h-4" />{downloading ? "Opening…" : "Download file"}
                    </button>
                  </div>
                ) : (
                  <img src={url} alt={fileName} onError={() => setImgError(true)}
                    className="max-w-full max-h-full object-contain p-4" />
                )
              )}
              {kind === "video" && (
                <video src={url} controls className="max-w-full max-h-full" style={{ maxHeight: "calc(92vh - 60px)" }} />
              )}
              {kind === "audio" && (
                <div className="p-8 w-full max-w-md">
                  <audio src={url} controls className="w-full" />
                </div>
              )}
              {kind === "pdf" && (
                <iframe src={url} title={fileName} className="w-full h-full border-0" style={{ minHeight: "600px" }} />
              )}
              {kind === "office" && (
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
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
