import { useState } from "react";
import { X, Link, Check, Loader2 } from "lucide-react";
import { createShare } from "../lib/api";

interface ShareModalProps {
  itemKey: string;
  isFolder: boolean;
  onClose: () => void;
}

const PERMISSIONS = [
  { value: "read", label: "Read", description: "Can download files" },
  { value: "read_write", label: "Read + Write", description: "Can download and upload" },
  { value: "read_write_delete", label: "Full Access", description: "Can download, upload, and delete" },
] as const;

export function ShareModal({ itemKey, isFolder, onClose }: ShareModalProps) {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<string>("read");
  const [loading, setLoading] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = itemKey.split("/").filter(Boolean).pop() ?? itemKey;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await createShare(itemKey, isFolder, email, permission);
      setShareLink(`${window.location.origin}${res.linkUrl}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">
            Share "{displayName}"
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {!shareLink ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Recipient email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Permission
                </label>
                <div className="space-y-2">
                  {PERMISSIONS.map((p) => (
                    <label
                      key={p.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        permission === p.value
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="permission"
                        value={p.value}
                        checked={permission === p.value}
                        onChange={() => setPermission(p.value)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{p.label}</div>
                        <div className="text-xs text-slate-500">{p.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Creating share…" : "Create share link"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Share link created. The recipient must be logged in via Cloudflare Access to access it.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareLink}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 bg-slate-50 truncate"
                />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700 transition-colors shrink-0"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Link className="w-4 h-4" />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                The item also appears in {email}'s "Shared with me" inbox.
              </p>
              <button
                onClick={onClose}
                className="w-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium py-2 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
