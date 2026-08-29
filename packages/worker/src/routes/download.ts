import { Hono } from "hono";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "../lib/s3";
import type { Env } from "../types";

const REDIRECT_EXPIRY_SECONDS = 30; // short-lived redirect after token consumption

export const downloadRouter = new Hono<{ Bindings: Env }>();

downloadRouter.post("/download-token", async (c) => {
  const body = await c.req.json<{ key?: string }>();
  const { key } = body;

  if (!key) {
    return c.json({ error: "key is required" }, 400);
  }

  const token = crypto.randomUUID();
  const id = c.env.DOWNLOAD_TOKENS.idFromName(token);
  const stub = c.env.DOWNLOAD_TOKENS.get(id);

  const initRes = await stub.fetch(
    new Request("https://do/init", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    })
  );

  if (!initRes.ok) {
    return c.json({ error: "Failed to create download token" }, 500);
  }

  return c.json({
    token,
    tokenUrl: `/api/download/${token}`,
  });
});

downloadRouter.get("/download/:token", async (c) => {
  const token = c.req.param("token");

  const id = c.env.DOWNLOAD_TOKENS.idFromName(token);
  const stub = c.env.DOWNLOAD_TOKENS.get(id);

  const consumeRes = await stub.fetch(
    new Request("https://do/consume", { method: "POST" })
  );

  if (consumeRes.status === 410) {
    return c.json({ error: "Download link has already been used or has expired" }, 410);
  }

  if (!consumeRes.ok) {
    return c.json({ error: "Invalid download token" }, 404);
  }

  const { key } = await consumeRes.json<{ key: string }>();

  const s3 = createS3Client(c.env);
  const fileName = key.split("/").pop() ?? key;
  const redirectUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: REDIRECT_EXPIRY_SECONDS }
  );

  return c.redirect(redirectUrl, 302);
});
