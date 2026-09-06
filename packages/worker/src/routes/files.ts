import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env, UserContext } from "../types";

type Variables = { user: UserContext };

const SINGLE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const PRESIGN_EXPIRY_SECONDS = 1800; // 30 minutes

export const filesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

filesRouter.get("/files", async (c) => {
  const user = c.get("user");
  const cursor = c.req.query("cursor") ?? undefined;
  const subPrefix = c.req.query("prefix") ?? "";
  const userPrefix = `${user.email}/${subPrefix}`;

  const list = await c.env.my_files.list({
    prefix: userPrefix,
    delimiter: "/",
    cursor,
  });

  const folders = (list.delimitedPrefixes ?? []).map((p) => ({
    key: p.slice(user.email.length + 1),
    type: "folder" as const,
  }));

  const files = list.objects
    .filter((obj) => !obj.key.endsWith("/.keep"))
    .map((obj) => ({
    key: obj.key.slice(user.email.length + 1),
    size: obj.size,
    lastModified: obj.uploaded.toISOString(),
    etag: obj.etag,
    type: "file" as const,
  }));

  return c.json({
    entries: [...folders, ...files],
    truncated: list.truncated,
    cursor: list.truncated ? list.cursor : null,
  });
});

filesRouter.post("/upload-url", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ key?: string; contentType?: string; size?: number }>();
  const { key, contentType, size } = body;

  if (!key || !contentType || typeof size !== "number") {
    return c.json({ error: "key, contentType, and size are required" }, 400);
  }

  if (size > SINGLE_UPLOAD_MAX_BYTES) {
    return c.json(
      { error: "File exceeds the 100 MB single-upload limit. Use the multipart upload API for larger files." },
      400
    );
  }

  const r2Key = `${user.email}/${key}`;
  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();
  return c.json({ url, key, expiresAt });
});

filesRouter.post("/mkdir", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ prefix?: string; name?: string }>();
  const { prefix = "", name } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }
  if (name.includes("/")) {
    return c.json({ error: "Folder name must not contain /" }, 400);
  }

  const r2Key = `${user.email}/${prefix}${name}/.keep`;
  await c.env.my_files.put(r2Key, new Uint8Array(0));

  return c.json({ created: `${prefix}${name}/` });
});

filesRouter.post("/preview-url", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ key?: string }>();
  const { key } = body;

  if (!key) return c.json({ error: "key is required" }, 400);

  const r2Key = `${user.email}/${key}`;
  const fileName = key.split("/").pop() ?? key;
  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: r2Key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  return c.json({ url });
});

filesRouter.post("/files/move", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ keys?: string[]; destinationPrefix?: string }>();
  const { keys, destinationPrefix } = body;

  if (!Array.isArray(keys) || keys.length === 0) {
    return c.json({ error: "keys must be a non-empty array" }, 400);
  }
  if (typeof destinationPrefix !== "string") {
    return c.json({ error: "destinationPrefix is required" }, 400);
  }

  const userBase = `${user.email}/`;
  const destR2Prefix = `${userBase}${destinationPrefix}`;

  for (const key of keys) {
    const srcR2Key = `${userBase}${key}`;

    if (key.endsWith("/")) {
      const folderName = key.replace(/\/$/, "").split("/").pop()!;
      const dstR2Prefix = `${destR2Prefix}${folderName}/`;
      let cursor: string | undefined;
      do {
        const list = await c.env.my_files.list({ prefix: srcR2Key, cursor });
        for (const obj of list.objects) {
          const rel = obj.key.slice(srcR2Key.length);
          const newKey = `${dstR2Prefix}${rel}`;
          const object = await c.env.my_files.get(obj.key);
          if (object) {
            await c.env.my_files.put(newKey, object.body, { httpMetadata: object.httpMetadata });
            await c.env.my_files.delete(obj.key);
          }
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    } else {
      const filename = key.split("/").pop()!;
      const dstR2Key = `${destR2Prefix}${filename}`;
      if (srcR2Key !== dstR2Key) {
        const object = await c.env.my_files.get(srcR2Key);
        if (object) {
          await c.env.my_files.put(dstR2Key, object.body, { httpMetadata: object.httpMetadata });
          await c.env.my_files.delete(srcR2Key);
        }
      }
    }
  }

  return c.json({ moved: keys.length });
});

filesRouter.delete("/files", async (c) => {
  const user = c.get("user");
  const key = c.req.query("key");
  if (!key) {
    return c.json({ error: "key query parameter is required" }, 400);
  }

  const r2Key = `${user.email}/${key}`;

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
