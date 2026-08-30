import { useCallback, useEffect, useState } from "react";
import { X, Link, Check, Loader2, AlertCircle, Trash2, ChevronDown } from "lucide-react";
import { createShare, listSharesForPath, updateSharePermission, revokeShare } from "../lib/api";
import type { CreateShareResponse, ShareRecord } from "../lib/api";

interface ShareModalProps {
  itemKey: string;
  isFolder: boolean;
  onClose: () => void;
}

const PERMISSIONS = [
  { value: "read", label: "Read" },
  { value: "read_write", label: "Read + Write" },
  { value: "read_write_delete", label: "Full Access" },
] as const;

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read",
  read_write: "Read + Write",
  read_write_delete: "Full Access",
};

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function ShareModal({ itemKey, isFolder, onClose }: ShareModalProps) {
  const [existingShares, setExistingShares] = useState<ShareRecord[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [emailsRaw, setEmailsRaw] = useState("");
  const [newPermission, setNewPermission] = useState<string>("read");
  const [submitting, setSubmitting] = useState(false);
  const [newResult, setNewResult] = useState<CreateShareResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const displayName = itemKey.split("/").filter(Boolean).pop() ?? itemKey;
  const parsedEmails = parseEmails(emailsRaw);

  const fetchShares = useCallback(async () => {
    setSharesLoading(true);
    try {
      const { shares } = await listSharesForPath(itemKey);
      setExistingShares(shares);
    } catch {
      // non-critical
    } finally {
      setSharesLoading(false);
    }
  }, [itemKey]);

  useEffect(() => { void fetchShares(); }, [fetchShares]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedEmails.length === 0) {
      setAddError("Enter at least one valid email address.");
      return;
    }
    setAddError(null);
    setSubmitting(true);
    try {
      const res = await createShare(itemKey, isFolder, parsedEmails, newPermission);
      setNewResult(res);
      setEmailsRaw("");
      void fetchShares();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!newResult) return;
    await navigator.clipboard.writeText(`${window.location.origin}${newResult.linkUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handlePermissionChange(id: string, permission: string) {
    setUpdatingId(id);
    try {
      await updateSharePermission(id, permission);
      setExistingShares((prev) =>
        prev.map((s) => (s.id === id ? { ...s, permission } : s))
      );
    } catch {
      // silently revert UI on error
      void fetchShares();
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeShare(id);
      setExistingShares((prev) => prev.filter((s) => s.id !== id));
    } catch {
      void fetchShares();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <h2 className="font-semibold text-slate-800 truncate">Share "{displayName}"</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {/* ── Existing shares ── */}
          <div className="px-6 py-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Shared with
            </h3>

            {sharesLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : existingShares.length === 0 ? (
              <p className="text-sm text-slate-400 py-1">Not shared with anyone yet.</p>
            ) : (
              <div className="space-y-2">
                {existingShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100"
                  >
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-slate-600">
                        {share.grantee_email[0].toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm text-slate-700 truncate flex-1 min-w-0">
                      {share.grantee_email}
                    </span>

                    <div className="relative shrink-0">
                      <select
                        value={share.permission}
                        disabled={updatingId === share.id}
                        onChange={(e) => void handlePermissionChange(share.id, e.target.value)}
                        className="appearance-none text-xs text-slate-600 bg-white border border-slate-200 rounded-md pl-2 pr-6 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                      >
                        {PERMISSIONS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      {updatingId === share.id
                        ? <Loader2 className="w-3 h-3 animate-spin absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        : <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
                    </div>

                    <button
                      onClick={() => void handleRevoke(share.id)}
                      disabled={revokingId === share.id}
                      title="Revoke access"
                      className="text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors shrink-0"
                    >
                      {revokingId === share.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Add people ── */}
          <div className="px-6 py-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Add people
            </h3>

            {newResult ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Link created for <span className="font-medium">{newResult.granteeEmails.join(", ")}</span>.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}${newResult.linkUrl}`}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 bg-slate-50 truncate"
                  />
                  <button
                    onClick={() => void handleCopy()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700 transition-colors shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Link className="w-4 h-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => setNewResult(null)}
                  className="text-xs text-blue-600 hover:text-blue-700 transition-colors"
                >
                  + Share with more people
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
                <div>
                  <textarea
                    rows={2}
                    value={emailsRaw}
                    onChange={(e) => setEmailsRaw(e.target.value)}
                    placeholder={"alice@company.com, bob@company.com"}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  {parsedEmails.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {parsedEmails.length} recipient{parsedEmails.length !== 1 ? "s" : ""} detected
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={newPermission}
                    onChange={(e) => setNewPermission(e.target.value)}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                  >
                    {PERMISSIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={submitting || parsedEmails.length === 0}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {submitting ? "Sharing…" : "Share"}
                  </button>
                </div>

                {addError && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {addError}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="w-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export for convenience
export { PERMISSION_LABELS };
