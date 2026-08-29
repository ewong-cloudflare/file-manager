import { useState } from "react";
import { X, Link, Check, Loader2, AlertCircle } from "lucide-react";
import { createShare } from "../lib/api";
import type { ShareResult } from "../lib/api";

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

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function ShareModal({ itemKey, isFolder, onClose }: ShareModalProps) {
  const [emailsRaw, setEmailsRaw] = useState("");
  const [permission, setPermission] = useState<string>("read");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ShareResult[] | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayName = itemKey.split("/").filter(Boolean).pop() ?? itemKey;
  const parsedEmails = parseEmails(emailsRaw);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedEmails.length === 0) {
      setError("Enter at least one valid email address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await createShare(itemKey, isFolder, parsedEmails, permission);
      setResults(res.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(token: string, link: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${link}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <h2 className="font-semibold text-slate-800">Share "{displayName}"</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          {!results ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Recipients
                  <span className="ml-1 text-xs font-normal text-slate-400">(comma or newline separated)</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={emailsRaw}
                  onChange={(e) => setEmailsRaw(e.target.value)}
                  placeholder={"alice@company.com, bob@company.com\ncarol@company.com"}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                {parsedEmails.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {parsedEmails.length} recipient{parsedEmails.length !== 1 ? "s" : ""} detected
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Permission</label>
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
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || parsedEmails.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading
                  ? "Creating shares…"
                  : `Share with ${parsedEmails.length || "…"} recipient${parsedEmails.length !== 1 ? "s" : ""}`}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {results.length} share{results.length !== 1 ? "s" : ""} created. Each recipient also sees the item in their "Shared with me" inbox.
              </p>
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{r.granteeEmail}</span>
                    <button
                      onClick={() => void handleCopy(r.linkToken, r.linkUrl)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 transition-colors shrink-0"
                    >
                      {copiedToken === r.linkToken
                        ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                        : <Link className="w-3.5 h-3.5" />}
                      {copiedToken === r.linkToken ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                ))}
              </div>
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
