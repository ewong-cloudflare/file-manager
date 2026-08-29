import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env } from "../types";

const SINGLE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const PRESIGN_EXPIRY_SECONDS = 1800; // 30 minutes

export const filesRouter = new Hono<{ Bindings: Env }>();

filesRouter.get("/files", async (c) => {
  const cursor = c.req.query("cursor");
  const list = await c.env.FILES.list({ cursor: cursor ?? undefined });
  const files = list.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    lastModified: obj.uploaded.toISOString(),
    etag: obj.etag,
  }));
  return c.json({ files, truncated: list.truncated, cursor: list.truncated ? list.cursor : null });
});

filesRouter.post("/upload-url", async (c) => {
  const body = await c.req.json<{ key?: string; contentType?: string; size?: number }>();
  const { key, contentType, size } = body;

  if (!key || !contentType || typeof size !== "number") {
    return c.json({ error: "key, contentType, and size are required" }, 400);
  }

  if (size > SINGLE_UPLOAD_MAX_BYTES) {
    return c.json(
      { error: `File exceeds the 100 MB single-upload limit. Use the multipart upload API for larger files.` },
      400
    );
  }

  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );

  const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();
  return c.json({ url, key, expiresAt });
});

filesRouter.delete("/files", async (c) => {
  const key = c.req.query("key");
  if (!key) {
    return c.json({ error: "key query parameter is required" }, 400);
  }
  await c.env.FILES.delete(key);
  return c.json({ deleted: key });
});
