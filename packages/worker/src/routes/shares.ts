import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env, UserContext } from "../types";

type Variables = { user: UserContext };

const SHARED_REDIRECT_EXPIRY_SECONDS = 30;

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
  const rows = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE owner_email = ? ORDER BY created_at DESC"
  )
    .bind(user.email)
    .all<ShareRow>();

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

sharesRouter.get("/shared/:token", async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE link_token = ? AND (grantee_email = ? OR owner_email = ?) LIMIT 1"
  )
    .bind(token, user.email, user.email)
    .first<ShareRow>();

  if (!share) {
    return c.json({ error: "Share link not found, revoked, or not shared with your account" }, 404);
  }

  if (share.is_folder) {
    const list = await c.env.my_files.list({
      prefix: share.path.endsWith("/") ? share.path : `${share.path}/`,
      delimiter: "/",
    });

    const folders = (list.delimitedPrefixes ?? []).map((p) => ({
      key: p,
      type: "folder" as const,
    }));

    const files = list.objects.map((obj) => ({
      key: obj.key,
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
