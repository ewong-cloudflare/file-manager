import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { AwsClient } from "aws4fetch";
import { createS3Client } from "../lib/s3";
import type { Env, UserContext } from "../types";

function r2Endpoint(env: Env) {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function makeAwsClient(env: Env) {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

function extractXmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return m ? m[1] : null;
}

type Variables = { user: UserContext };

const PART_PRESIGN_EXPIRY_SECONDS = 1800; // 30 minutes — just-in-time fetched per part
const MAX_PART_NUMBER = 10_000;
const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024; // ~4.995 GiB

export const multipartRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

multipartRouter.post("/multipart/init", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ key?: string; contentType?: string }>();
  const { key, contentType } = body;

  if (!key || !contentType) {
    return c.json({ error: "key and contentType are required" }, 400);
  }

  const r2Key = `${user.email}/${key}`;
  try {
    const aws = makeAwsClient(c.env);
    const url = `${r2Endpoint(c.env)}/${c.env.R2_BUCKET_NAME}/${encodeURIComponent(r2Key)}?uploads`;
    const res = await aws.fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
    });
    const xml = await res.text();
    if (!res.ok) {
      return c.json({ error: `R2 error ${res.status}: ${xml}` }, 500);
    }
    const uploadId = extractXmlTag(xml, "UploadId");
    if (!uploadId) {
      return c.json({ error: `Could not parse UploadId from R2 response: ${xml}` }, 500);
    }
    return c.json({ uploadId, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to init multipart upload: ${msg}` }, 500);
  }
});

multipartRouter.post("/multipart/part-url", async (c) => {
  const user = c.get("user");
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

  const r2Key = `${user.email}/${key}`;
  const s3 = createS3Client(c.env);
  try {
    const url = await getSignedUrl(
      s3,
      new UploadPartCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: r2Key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PART_PRESIGN_EXPIRY_SECONDS }
    );
    return c.json({ url, partNumber });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to get part URL: ${msg}` }, 500);
  }
});

multipartRouter.post("/multipart/complete", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    key?: string;
    uploadId?: string;
    parts?: Array<{ PartNumber: number; ETag: string }>;
  }>();
  const { key, uploadId, parts } = body;

  if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "key, uploadId, and parts are required" }, 400);
  }

  const r2Key = `${user.email}/${key}`;
  try {
    const aws = makeAwsClient(c.env);
    const url = `${r2Endpoint(c.env)}/${c.env.R2_BUCKET_NAME}/${encodeURIComponent(r2Key)}?uploadId=${encodeURIComponent(uploadId!)}`;
    const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    const res = await aws.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body,
    });
    const xml = await res.text();
    if (!res.ok) {
      return c.json({ error: `R2 error ${res.status}: ${xml}` }, 500);
    }
    const location = extractXmlTag(xml, "Location");
    return c.json({ key, location });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to complete multipart upload: ${msg}` }, 500);
  }
});

multipartRouter.delete("/multipart/abort", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ key?: string; uploadId?: string }>();
  const { key, uploadId } = body;

  if (!key || !uploadId) {
    return c.json({ error: "key and uploadId are required" }, 400);
  }

  const r2Key = `${user.email}/${key}`;
  const s3 = createS3Client(c.env);
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: r2Key,
      UploadId: uploadId,
    })
  );

  return c.json({ aborted: true, key, uploadId });
});
