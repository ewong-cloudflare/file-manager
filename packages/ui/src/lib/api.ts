const API_BASE = "/api";

export interface FileItem {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface UploadUrlResponse {
  url: string;
  key: string;
  expiresAt: string;
}

export interface MultipartInitResponse {
  uploadId: string;
  key: string;
}

export interface PartUrlResponse {
  url: string;
  partNumber: number;
}

export interface DownloadTokenResponse {
  token: string;
  tokenUrl: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function listFiles(cursor?: string): Promise<{
  files: FileItem[];
  truncated: boolean;
  cursor: string | null;
}> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
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
