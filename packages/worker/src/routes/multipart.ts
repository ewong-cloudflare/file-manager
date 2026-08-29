import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env } from "../types";

const PART_PRESIGN_EXPIRY_SECONDS = 1800; // 30 minutes — just-in-time fetched per part
const MAX_PART_NUMBER = 10_000;
const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024; // ~4.995 GiB

export const multipartRouter = new Hono<{ Bindings: Env }>();

multipartRouter.post("/multipart/init", async (c) => {
  const body = await c.req.json<{ key?: string; contentType?: string }>();
  const { key, contentType } = body;

  if (!key || !contentType) {
    return c.json({ error: "key and contentType are required" }, 400);
  }

  const s3 = createS3Client(c.env);
  const result = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    })
  );

  return c.json({ uploadId: result.UploadId, key });
});

multipartRouter.post("/multipart/part-url", async (c) => {
  const body = await c.req.json<{
    key?: string;
    uploadId?: string;
    partNumber?: number;
    partSize?: number;
  }>();
  const { key, uploadId, partNumber, partSize } = body;

  if (!key || !uploadId || typeof partNumber !== "number") {
    return c.json({ error: "key, uploadId, and partNumber are required" }, 400);
  }

  if (partNumber < 1 || partNumber > MAX_PART_NUMBER) {
    return c.json({ error: `partNumber must be between 1 and ${MAX_PART_NUMBER}` }, 400);
  }

  if (partSize !== undefined && partSize > MAX_PART_BYTES) {
    return c.json({ error: "Part size exceeds the ~4.995 GiB R2 limit" }, 400);
  }

  const s3 = createS3Client(c.env);
  const url = await getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: PART_PRESIGN_EXPIRY_SECONDS }
  );

  return c.json({ url, partNumber });
});

multipartRouter.post("/multipart/complete", async (c) => {
  const body = await c.req.json<{
    key?: string;
    uploadId?: string;
    parts?: Array<{ PartNumber: number; ETag: string }>;
  }>();
  const { key, uploadId, parts } = body;

  if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "key, uploadId, and parts are required" }, 400);
  }

  const s3 = createS3Client(c.env);
  const result = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      },
    })
  );

  return c.json({ key, location: result.Location ?? null });
});

multipartRouter.delete("/multipart/abort", async (c) => {
  const body = await c.req.json<{ key?: string; uploadId?: string }>();
  const { key, uploadId } = body;

  if (!key || !uploadId) {
    return c.json({ error: "key and uploadId are required" }, 400);
  }

  const s3 = createS3Client(c.env);
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    })
  );

  return c.json({ aborted: true, key, uploadId });
});
