const API_BASE = "/api";

export interface FileEntry {
  key: string;
  type: "file" | "folder";
  size?: number;
  lastModified?: string;
  etag?: string;
}

export type FileItem = FileEntry;

export interface UserInfo {
  email: string;
  name: string;
}

export interface UploadUrlResponse {
  url: string;
  key: string;
  expiresAt: string;
}

export interface DownloadTokenResponse {
  token: string;
  tokenUrl: string;
}

export interface MultipartInitResponse {
  uploadId: string;
  key: string;
}

export interface MultipartPartUrlResponse {
  url: string;
  partNumber: number;
}

export type PartUrlResponse = MultipartPartUrlResponse;

export interface MultipartCompleteResponse {
  key: string;
  location: string | null;
}

export interface ShareRecord {
  id: string;
  owner_email: string;
  path: string;
  is_folder: number;
  permission: string;
  grantee_email: string;
  link_token: string;
  created_at: number;
}

export interface CreateShareResponse {
  linkToken: string;
  linkUrl: string;
  granteeEmails: string[];
}

export interface SharedItemResponse {
  share: {
    id: string;
    ownerEmail: string;
    path: string;
    isFolder: boolean;
    permission: string;
  };
  entries?: FileEntry[];
  downloadUrl?: string;
  filePerms?: Record<string, string>;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getMe(): Promise<UserInfo> {
  return apiFetch("/me");
}

export async function listFiles(prefix = "", cursor?: string): Promise<{ entries: FileEntry[]; truncated: boolean; cursor: string | null }> {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  if (cursor) params.set("cursor", cursor);
  const qs = params.size ? `?${params.toString()}` : "";
  return apiFetch(`/files${qs}`);
}

export async function getUploadUrl(
  key: string,
  contentType: string,
  size: number
): Promise<UploadUrlResponse> {
  return apiFetch("/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType, size }),
  });
}

export async function getDownloadToken(key: string): Promise<DownloadTokenResponse> {
  return apiFetch("/download-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

export async function deleteFile(key: string): Promise<void> {
  await apiFetch(`/files?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function initMultipart(
  key: string,
  contentType: string
): Promise<MultipartInitResponse> {
  return apiFetch("/multipart/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType }),
  });
}

export async function getPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  partSize?: number
): Promise<PartUrlResponse> {
  return apiFetch("/multipart/part-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, partNumber, partSize }),
  });
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>
): Promise<void> {
  await apiFetch("/multipart/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
  });
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  await fetch(`${API_BASE}/multipart/abort`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId }),
  }).catch(() => {});
}

export async function createShare(
  key: string,
  isFolder: boolean,
  granteeEmails: string[],
  permission: string
): Promise<CreateShareResponse> {
  return apiFetch("/shares", {
    method: "POST",
    body: JSON.stringify({ key, isFolder, granteeEmails, permission }),
  });
}

export async function moveItems(keys: string[], destinationPrefix: string): Promise<void> {
  await apiFetch("/files/move", {
    method: "POST",
    body: JSON.stringify({ keys, destinationPrefix }),
  });
}

export async function createFolder(prefix: string, name: string): Promise<{ created: string }> {
  return apiFetch("/mkdir", {
    method: "POST",
    body: JSON.stringify({ prefix, name }),
  });
}

export async function listMyShares(): Promise<{ shares: ShareRecord[] }> {
  return apiFetch("/shares");
}

export async function listSharesForPath(key: string): Promise<{ shares: ShareRecord[] }> {
  return apiFetch(`/shares?key=${encodeURIComponent(key)}`);
}

export async function updateSharePermission(id: string, permission: string): Promise<void> {
  await apiFetch(`/shares/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ permission }),
  });
}

export async function listSharedWithMe(): Promise<{ shares: ShareRecord[] }> {
  return apiFetch("/shares/inbox");
}

export async function revokeShare(id: string): Promise<void> {
  await apiFetch(`/shares/${id}`, { method: "DELETE" });
}

export async function getSharedItem(token: string, subPrefix?: string): Promise<SharedItemResponse> {
  const qs = subPrefix ? `?subPrefix=${encodeURIComponent(subPrefix)}` : "";
  return apiFetch(`/shared/${token}${qs}`);
}

export const PREVIEW_IMAGE_EXTS = [
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico",
  "avif", "apng", "tiff", "tif", "heic", "heif",
];
export const PREVIEW_VIDEO_EXTS = [
  "mp4", "webm", "ogv", "ogg", "mov", "m4v", "3gp", "mkv", "avi",
];
export const PREVIEW_AUDIO_EXTS = [
  "mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "weba", "aiff", "aif",
];
export const PREVIEW_PDF_EXTS = ["pdf"];
export const PREVIEW_OFFICE_EXTS = [
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf",
];
export const PREVIEW_TEXT_EXTS = [
  "txt", "md", "markdown", "rst", "tex", "adoc",
  "json", "jsonl", "ndjson", "json5", "csv", "tsv",
  "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "sass", "less", "styl",
  "html", "htm", "xhtml", "vue", "svelte", "astro",
  "py", "pyi", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "go", "rs", "c", "cpp", "h", "hpp", "java", "kt", "scala", "groovy",
  "rb", "php", "lua", "pl", "r", "swift", "dart",
  "ex", "exs", "erl", "zig", "nim", "elm", "ml", "fs", "clj", "hs",
  "sql", "graphql", "gql", "proto", "tf", "hcl", "nix",
  "log", "diff", "patch", "srt", "vtt",
  "gitignore", "gitattributes", "editorconfig", "prettierrc", "eslintrc",
  "makefile", "cmake", "lock",
];
export const PREVIEWABLE_EXTENSIONS = [
  ...PREVIEW_IMAGE_EXTS, ...PREVIEW_VIDEO_EXTS, ...PREVIEW_AUDIO_EXTS,
  ...PREVIEW_PDF_EXTS, ...PREVIEW_OFFICE_EXTS, ...PREVIEW_TEXT_EXTS,
];
export function isPreviewable(fileName: string): boolean {
  return PREVIEWABLE_EXTENSIONS.includes(fileName.split(".").pop()?.toLowerCase() ?? "");
}
export type PreviewType = "image" | "video" | "audio" | "pdf" | "text";
export function getPreviewType(fileName: string): PreviewType | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (PREVIEW_IMAGE_EXTS.includes(ext)) return "image";
  if (PREVIEW_VIDEO_EXTS.includes(ext)) return "video";
  if (PREVIEW_AUDIO_EXTS.includes(ext)) return "audio";
  if (PREVIEW_PDF_EXTS.includes(ext)) return "pdf";
  if (PREVIEW_TEXT_EXTS.includes(ext)) return "text";
  return null;
}

export async function getPreviewUrl(key: string): Promise<{ url: string }> {
  return apiFetch("/preview-url", { method: "POST", body: JSON.stringify({ key }) });
}

export async function sharedPreviewUrl(token: string, key: string): Promise<{ url: string }> {
  return apiFetch(`/shared/${token}/preview-url`, { method: "POST", body: JSON.stringify({ key }) });
}

export async function sharedDownloadUrl(token: string, key: string): Promise<{ url: string }> {
  return apiFetch(`/shared/${token}/download-url`, { method: "POST", body: JSON.stringify({ key }) });
}

export async function sharedUploadUrl(token: string, key: string, contentType: string, size: number): Promise<{ url: string; key: string }> {
  return apiFetch(`/shared/${token}/upload-url`, { method: "POST", body: JSON.stringify({ key, contentType, size }) });
}

export async function sharedInitMultipart(token: string, key: string, contentType: string): Promise<MultipartInitResponse> {
  return apiFetch(`/shared/${token}/multipart/init`, { method: "POST", body: JSON.stringify({ key, contentType }) });
}

export async function sharedPartUrl(token: string, key: string, uploadId: string, partNumber: number, partSize?: number): Promise<PartUrlResponse> {
  return apiFetch(`/shared/${token}/multipart/part-url`, { method: "POST", body: JSON.stringify({ key, uploadId, partNumber, partSize }) });
}

export async function sharedCompleteMultipart(token: string, key: string, uploadId: string, parts: Array<{ PartNumber: number; ETag: string }>): Promise<void> {
  await apiFetch(`/shared/${token}/multipart/complete`, { method: "POST", body: JSON.stringify({ key, uploadId, parts }) });
}

export async function sharedAbortMultipart(token: string, key: string, uploadId: string): Promise<void> {
  await fetch(`/api/shared/${token}/multipart/abort`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId }),
  }).catch(() => {});
}

export async function sharedDeleteFile(token: string, key: string): Promise<void> {
  await apiFetch(`/shared/${token}/file?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function sharedMkdir(token: string, prefix: string, name: string): Promise<{ created: string }> {
  return apiFetch(`/shared/${token}/mkdir`, { method: "POST", body: JSON.stringify({ prefix, name }) });
}

export async function sharedListGrantees(token: string): Promise<{ grantees: ShareRecord[] }> {
  return apiFetch(`/shared/${token}/grantees`);
}

export async function sharedCreateShare(token: string, granteeEmails: string[], permission: string): Promise<{ linkToken: string; granteeEmails: string[] }> {
  return apiFetch(`/shared/${token}/share`, { method: "POST", body: JSON.stringify({ granteeEmails, permission }) });
}

export async function sharedRevokeGrantee(token: string, granteeId: string): Promise<void> {
  await apiFetch(`/shared/${token}/grantee/${encodeURIComponent(granteeId)}`, { method: "DELETE" });
}
