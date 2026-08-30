import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env, UserContext } from "../types";

type Variables = { user: UserContext };

const SHARED_REDIRECT_EXPIRY_SECONDS = 30;
const PRESIGN_EXPIRY_SECONDS = 1800;
const SINGLE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PART_NUMBER = 10_000;
const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024;

const PERM_ORDER: Record<string, number> = { read: 0, read_write: 1, read_write_delete: 2 };
function hasPermission(actual: string, required: string): boolean {
  return (PERM_ORDER[actual] ?? -1) >= (PERM_ORDER[required] ?? 99);
}

interface ShareRow {
  id: string;
  owner_email: string;
  path: string;
  is_folder: number;
  permission: string;
  grantee_email: string;
  link_token: string;
  created_at: number;
}

export const sharesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

sharesRouter.post("/shares", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    key?: string;
    isFolder?: boolean;
    granteeEmails?: string[];
    permission?: string;
  }>();
  const { key, isFolder = false, granteeEmails, permission } = body;

  if (!key || !Array.isArray(granteeEmails) || granteeEmails.length === 0 || !permission) {
    return c.json({ error: "key, granteeEmails (array), and permission are required" }, 400);
  }

  const validPermissions = ["read", "read_write", "read_write_delete"];
  if (!validPermissions.includes(permission)) {
    return c.json({ error: "permission must be one of: read, read_write, read_write_delete" }, 400);
  }

  const r2Path = `${user.email}/${key}`;
  const now = Date.now();
  const linkToken = crypto.randomUUID();
  const linkUrl = `/shared/${linkToken}`;
  const stmt = c.env.DB.prepare(
    "INSERT INTO shares (id, owner_email, path, is_folder, permission, grantee_email, link_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const rows = granteeEmails.map((email) => ({
    id: crypto.randomUUID(),
    granteeEmail: email,
    stmt: stmt.bind(crypto.randomUUID(), user.email, r2Path, isFolder ? 1 : 0, permission, email, linkToken, now),
  }));

  await c.env.DB.batch(rows.map((r) => r.stmt));

  return c.json({
    linkToken,
    linkUrl,
    granteeEmails,
  });
});

sharesRouter.get("/shares", async (c) => {
  const user = c.get("user");
  const key = c.req.query("key");

  let rows;
  if (key) {
    const r2Path = `${user.email}/${key}`;
    rows = await c.env.DB.prepare(
      "SELECT * FROM shares WHERE owner_email = ? AND path = ? ORDER BY created_at DESC"
    )
      .bind(user.email, r2Path)
      .all<ShareRow>();
  } else {
    rows = await c.env.DB.prepare(
      "SELECT * FROM shares WHERE owner_email = ? ORDER BY created_at DESC"
    )
      .bind(user.email)
      .all<ShareRow>();
  }

  return c.json({ shares: rows.results });
});

sharesRouter.get("/shares/inbox", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE grantee_email = ? ORDER BY created_at DESC"
  )
    .bind(user.email)
    .all<ShareRow>();

  return c.json({ shares: rows.results });
});

sharesRouter.patch("/shares/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ permission?: string }>();
  const { permission } = body;

  const validPermissions = ["read", "read_write", "read_write_delete"];
  if (!permission || !validPermissions.includes(permission)) {
    return c.json({ error: "permission must be one of: read, read_write, read_write_delete" }, 400);
  }

  const share = await c.env.DB.prepare(
    "SELECT owner_email FROM shares WHERE id = ?"
  )
    .bind(id)
    .first<{ owner_email: string }>();

  if (!share) return c.json({ error: "Share not found" }, 404);
  if (share.owner_email !== user.email) {
    return c.json({ error: "Forbidden — only the owner can update a share" }, 403);
  }

  await c.env.DB.prepare("UPDATE shares SET permission = ? WHERE id = ?")
    .bind(permission, id)
    .run();

  return c.json({ updated: id, permission });
});

sharesRouter.delete("/shares/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const share = await c.env.DB.prepare(
    "SELECT owner_email FROM shares WHERE id = ?"
  )
    .bind(id)
    .first<{ owner_email: string }>();

  if (!share) {
    return c.json({ error: "Share not found" }, 404);
  }

  if (share.owner_email !== user.email) {
    return c.json({ error: "Forbidden — only the owner can revoke a share" }, 403);
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
  return c.json({ revoked: id });
});

async function resolveShare(
  token: string,
  userEmail: string,
  minPermission: string,
  db: Env["DB"]
): Promise<ShareRow | null> {
  const share = await db
    .prepare("SELECT * FROM shares WHERE link_token = ? AND (grantee_email = ? OR owner_email = ?) LIMIT 1")
    .bind(token, userEmail, userEmail)
    .first<ShareRow>();
  if (!share) return null;
  if (!hasPermission(share.permission, minPermission)) return null;
  return share;
}

sharesRouter.get("/shared/:token", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const subPrefix = c.req.query("subPrefix") ?? "";

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE link_token = ? AND (grantee_email = ? OR owner_email = ?) LIMIT 1"
  )
    .bind(token, user.email, user.email)
    .first<ShareRow>();

  if (!share) {
    return c.json({ error: "Share link not found, revoked, or not shared with your account" }, 404);
  }

  if (share.is_folder) {
    const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
    const listPrefix = `${basePrefix}${subPrefix}`;
    const list = await c.env.my_files.list({ prefix: listPrefix, delimiter: "/" });

    const folders = (list.delimitedPrefixes ?? []).map((p) => ({
      key: p.slice(basePrefix.length),
      type: "folder" as const,
    }));

    const files = list.objects
      .filter((obj) => !obj.key.endsWith("/.keep"))
      .map((obj) => ({
        key: obj.key.slice(basePrefix.length),
        size: obj.size,
        lastModified: obj.uploaded.toISOString(),
        etag: obj.etag,
        type: "file" as const,
      }));

    return c.json({
      share: {
        id: share.id,
        ownerEmail: share.owner_email,
        path: share.path,
        isFolder: true,
        permission: share.permission,
      },
      entries: [...folders, ...files],
    });
  }

  const s3 = createS3Client(c.env);
  const fileName = share.path.split("/").pop() ?? share.path;
  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: share.path,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: SHARED_REDIRECT_EXPIRY_SECONDS }
  );

  return c.json({
    share: {
      id: share.id,
      ownerEmail: share.owner_email,
      path: share.path,
      isFolder: false,
      permission: share.permission,
    },
    downloadUrl,
  });
});

// ── Preview URL (inline, no attachment) ──────────────────────────────────────
sharesRouter.post("/shared/:token/preview-url", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string }>();

  const share = await resolveShare(token, user.email, "read", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.is_folder
    ? (share.path.endsWith("/") ? share.path : `${share.path}/`)
    : share.path.substring(0, share.path.lastIndexOf("/") + 1);

  const r2Key = share.is_folder && body.key ? `${basePrefix}${body.key}` : share.path;
  const fileName = r2Key.split("/").pop() ?? r2Key;

  const s3 = createS3Client(c.env);
  const previewUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: r2Key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  return c.json({ previewUrl });
});

// ── Upload URL (write permission required) ───────────────────────────────────
sharesRouter.post("/shared/:token/upload-url", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string; contentType?: string; size?: number }>();
  const { key, contentType, size } = body;

  if (!key || !contentType || typeof size !== "number") {
    return c.json({ error: "key, contentType, and size are required" }, 400);
  }
  if (size > SINGLE_UPLOAD_MAX_BYTES) {
    return c.json({ error: "File exceeds 100 MB. Use multipart upload." }, 400);
  }

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: c.env.R2_BUCKET_NAME, Key: r2Key, ContentType: contentType }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  return c.json({ url, key });
});

// ── Multipart upload (write permission required) ─────────────────────────────
sharesRouter.post("/shared/:token/multipart/init", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string; contentType?: string }>();
  const { key, contentType } = body;

  if (!key || !contentType) return c.json({ error: "key and contentType are required" }, 400);

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  const s3 = createS3Client(c.env);
  const result = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: c.env.R2_BUCKET_NAME, Key: r2Key, ContentType: contentType })
  );

  return c.json({ uploadId: result.UploadId, key });
});

sharesRouter.post("/shared/:token/multipart/part-url", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string; uploadId?: string; partNumber?: number; partSize?: number }>();
  const { key, uploadId, partNumber, partSize } = body;

  if (!key || !uploadId || typeof partNumber !== "number") {
    return c.json({ error: "key, uploadId, and partNumber are required" }, 400);
  }
  if (partNumber < 1 || partNumber > MAX_PART_NUMBER) {
    return c.json({ error: `partNumber must be between 1 and ${MAX_PART_NUMBER}` }, 400);
  }
  if (partSize !== undefined && partSize > MAX_PART_BYTES) {
    return c.json({ error: "Part size exceeds limit" }, 400);
  }

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: c.env.R2_BUCKET_NAME, Key: r2Key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  return c.json({ url, partNumber });
});

sharesRouter.post("/shared/:token/multipart/complete", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string; uploadId?: string; parts?: Array<{ PartNumber: number; ETag: string }> }>();
  const { key, uploadId, parts } = body;

  if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "key, uploadId, and parts are required" }, 400);
  }

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  const s3 = createS3Client(c.env);
  const result = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: r2Key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
    })
  );

  return c.json({ key, location: result.Location ?? null });
});

sharesRouter.delete("/shared/:token/multipart/abort", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ key?: string; uploadId?: string }>();
  const { key, uploadId } = body;

  if (!key || !uploadId) return c.json({ error: "key and uploadId are required" }, 400);

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  const s3 = createS3Client(c.env);
  await s3.send(
    new AbortMultipartUploadCommand({ Bucket: c.env.R2_BUCKET_NAME, Key: r2Key, UploadId: uploadId })
  );

  return c.json({ aborted: true });
});

// ── Create subfolder (write permission required) ──────────────────────────────
sharesRouter.post("/shared/:token/mkdir", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const body = await c.req.json<{ prefix?: string; name?: string }>();
  const { prefix = "", name } = body;

  if (!name || name.includes("/")) {
    return c.json({ error: "name is required and must not contain /" }, 400);
  }

  const share = await resolveShare(token, user.email, "read_write", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${prefix}${name}/.keep`;
  await c.env.my_files.put(r2Key, new Uint8Array(0));

  return c.json({ created: `${prefix}${name}/` });
});

// ── Delete file inside shared folder (full-access only) ───────────────────────
sharesRouter.delete("/shared/:token/file", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const key = c.req.query("key");

  if (!key) return c.json({ error: "key query parameter is required" }, 400);

  const share = await resolveShare(token, user.email, "read_write_delete", c.env.DB);
  if (!share) return c.json({ error: "Not found or insufficient permission" }, 403);

  const basePrefix = share.path.endsWith("/") ? share.path : `${share.path}/`;
  const r2Key = `${basePrefix}${key}`;

  if (key.endsWith("/")) {
    let cursor: string | undefined;
    const deleted: string[] = [];
    do {
      const list = await c.env.my_files.list({ prefix: r2Key, cursor });
      const keys = list.objects.map((o) => o.key);
      if (keys.length > 0) {
        await c.env.my_files.delete(keys);
        deleted.push(...keys);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    return c.json({ deleted: key, count: deleted.length });
  }

  await c.env.my_files.delete(r2Key);
  return c.json({ deleted: key });
});
