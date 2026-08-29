# cf-file-manager

A full-stack file manager hosted entirely on Cloudflare — React/Vite frontend served via Workers Assets, Hono.js API, Cloudflare R2 storage, and a Durable Object for strict single-use download tokens.

## Architecture

```
Browser → Cloudflare Worker (Hono API + Workers Assets)
              ├── GET  /api/files               — list objects (R2 binding)
              ├── POST /api/upload-url          — presign PUT URL (≤ 100 MB)
              ├── DELETE /api/files?key=…       — delete object (R2 binding)
              ├── POST /api/download-token      — issue one-time token (DO)
              ├── GET  /api/download/:token     — consume token → redirect to presigned GET
              ├── POST /api/multipart/init      — CreateMultipartUpload
              ├── POST /api/multipart/part-url  — presign UploadPart (30 min, just-in-time)
              ├── POST /api/multipart/complete  — CompleteMultipartUpload
              └── DELETE /api/multipart/abort   — AbortMultipartUpload
Browser → R2 (direct PUT via presigned URL — Worker never proxies file data)
```

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with R2 enabled

---

## 1. Create an R2 Bucket

```bash
wrangler r2 bucket create my-files
```

> Update `bucket_name` in `packages/worker/wrangler.toml` to match.

---

## 2. Create an R2 API Token

1. Go to **Cloudflare Dashboard → R2 → Manage R2 API Tokens**
2. Create a token with **Object Read & Write** permissions scoped to your bucket
3. Save the **Access Key ID** and **Secret Access Key**

---

## 3. Apply CORS Policy to R2

Edit `cors-policy.json` to replace `your-custom-domain.com` with your actual domain (or `*.workers.dev` for testing).

```bash
# Apply CORS rules to R2 bucket (wrangler 3.x+)
wrangler r2 bucket cors put my-files --file cors-policy.json
```

> **Important:** The `ExposeHeaders: ["ETag"]` entry is required so the browser can read part ETags during multipart uploads.

---

## 4. Set Worker Secrets

```bash
# Run these from packages/worker/
cd packages/worker

wrangler secret put R2_ACCOUNT_ID        # your Cloudflare Account ID
wrangler secret put R2_ACCESS_KEY_ID     # R2 token access key
wrangler secret put R2_SECRET_ACCESS_KEY # R2 token secret key
wrangler secret put R2_BUCKET_NAME       # same as bucket_name in wrangler.toml
wrangler secret put CF_ACCESS_AUD        # CF Access AUD tag (when ready)
```

For **local development**, copy `.dev.vars.example` to `.dev.vars` and fill in the values:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your actual values
```

---

## 5. Local Development

Run the Worker API and the Vite dev server in two terminals:

**Terminal 1 — Worker:**
```bash
cd packages/worker
npm install
wrangler dev
# Worker available at http://localhost:8787
```

**Terminal 2 — UI:**
```bash
cd packages/ui
npm install
npm run dev
# UI available at http://localhost:5173
# /api requests are proxied to http://localhost:8787
```

> **Note:** On first local run, wrangler will create a local simulation of the R2 bucket and Durable Object. Presigned URLs (which use R2's S3 API) still require real credentials in `.dev.vars`.

---

## 6. Deploy

```bash
# From monorepo root — builds UI then deploys Worker (which includes UI assets)
npm run deploy
```

On first deploy, wrangler automatically runs the Durable Object migration defined in `[[migrations]]`.

---

## 7. Custom Domain

1. Go to **Cloudflare Dashboard → Workers & Pages → cf-file-manager → Settings → Domains & Routes**
2. Add your custom domain
3. Update `cors-policy.json` `AllowedOrigins` to include your domain and re-apply CORS

---

## 8. Enable Cloudflare Access (Authentication)

When your CF Access application is ready:

1. Note the **AUD tag** from your Access application settings
2. `wrangler secret put CF_ACCESS_AUD` (with the AUD tag value)
3. Set `ENVIRONMENT = "production"` in `wrangler.toml` `[vars]`
4. Update `packages/worker/src/middleware/auth.ts` — replace the mock section with real JWT validation using the JWKS endpoint at `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/certs`

---

## Upload Limits

| Scenario | Limit | Detail |
|---|---|---|
| Single PUT | ≤ 100 MB | Presigned URL, 30-min TTL |
| Multipart parts | 100 MB each | Just-in-time URL fetch, 3 concurrent |
| Object max (multipart) | ~4.995 TiB | R2 platform limit |
| Download token | Single use | Enforced by Durable Object (serialized) |
| Download token TTL | 1 hour | DO alarm self-cleanup |
| Download redirect TTL | 30 seconds | Presigned GET URL after token consumed |

---

## Project Structure

```
cf-file-manager/
├── packages/
│   ├── worker/                        # Hono API + Workers Assets
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point, routes + asset fallback
│   │   │   ├── types.ts               # Env interface
│   │   │   ├── middleware/auth.ts     # CF Access JWT validation (mocked)
│   │   │   ├── lib/s3.ts             # S3Client factory for R2
│   │   │   ├── durable-objects/
│   │   │   │   └── DownloadTokenDO.ts # Strict single-use token (DO)
│   │   │   └── routes/
│   │   │       ├── files.ts           # List, upload-url, delete
│   │   │       ├── download.ts        # Token issue + consume + redirect
│   │   │       └── multipart.ts       # Init, part-url, complete, abort
│   │   └── wrangler.toml
│   └── ui/                            # React + Vite SPA
│       └── src/
│           ├── App.tsx
│           ├── lib/api.ts             # Typed API client
│           └── components/
│               ├── UploadZone.tsx     # Drag-and-drop, single + multipart logic
│               ├── FileList.tsx       # File table with download/delete
│               └── ProgressBar.tsx
├── cors-policy.json
└── README.md
```
