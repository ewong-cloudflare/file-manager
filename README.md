# cf-file-manager

A full-stack file manager hosted entirely on Cloudflare — React/Vite frontend served via Workers Assets, Hono.js API, Cloudflare R2 for storage, D1 for sharing metadata, and a Durable Object for strict single-use download tokens.

## Features

- **My Files** — upload (drag-and-drop, single ≤ 100 MB or multipart up to ~5 TiB), browse folders, preview, download, delete, share
- **File sharing** — share any file or folder with another user by email; three permission levels: Read, Read + Write, Full Access
- **Shared with me** — view and open items others have shared; files open in an inline preview modal, folders open in a full browsing view
- **Shared folder view** — browse sub-folders, upload/delete (based on permission), create folders; "People" panel to view/add/revoke grantees
- **File-level permission overrides** — individual files inside a shared folder can carry a more-permissive override, shown as a badge in the file list
- **Preview modal** — carousel with keyboard navigation; supports images, video (mp4, webm, mov, ogv), audio, plaintext, PDF; shows "unsupported" message for other types
- **One-time download tokens** — enforced by a Durable Object; each token is single-use with a 1-hour TTL

## Architecture

```
Browser → Cloudflare Worker (Hono API + Workers Assets)
              ├── /api/files/*              — list, upload-url, preview-url, delete (R2)
              ├── /api/multipart/*          — init, part-url, complete, abort (R2 S3 API)
              ├── /api/download-token       — issue one-time token (Durable Object)
              ├── /api/download/:token      — consume token → presigned GET redirect
              ├── /api/shares/*             — create/list/update/delete shares (D1)
              └── /shared/:token/*          — grantee API: list, preview, download,
                                             upload, mkdir, delete, grantees CRUD
Browser → R2 (direct PUT via presigned URL — Worker never proxies file data)
```

## Cloudflare Resources Required

| Resource | Purpose |
|---|---|
| R2 bucket | File storage, namespaced per user email |
| R2 API token | Presigned URL generation (S3-compatible API) |
| D1 database | Share records (owner, grantee, permission, token) |
| Durable Object | Single-use download token enforcement |
| CF Access application | Authentication (JWT validation) |

## Permission Model

| Level | Value | Can read | Can upload/mkdir | Can delete | Can manage shares |
|---|---|---|---|---|---|
| Read | `read` | ✓ | | | |
| Read + Write | `read_write` | ✓ | ✓ | | |
| Full Access | `read_write_delete` | ✓ | ✓ | ✓ | ✓ |

Owners always have Full Access regardless of what is stored in the shares table. Individual files inside a shared folder can be explicitly shared with a higher permission than the folder's base level.

---

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with R2 and D1 enabled

---

## 1. Create an R2 Bucket

```bash
wrangler r2 bucket create my-files
```

Update `bucket_name` and `binding` in `packages/worker/wrangler.toml` to match:

```toml
[[r2_buckets]]
binding = "my_files"
bucket_name = "my-files"
```

---

## 2. Create a D1 Database

```bash
wrangler d1 create file-manager-shares
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding     = "DB"
database_name = "file-manager-shares"
database_id   = "<your-database-id>"
```

Then apply the schema:

```bash
wrangler d1 execute file-manager-shares --file packages/worker/schema.sql
```

---

## 3. Create an R2 API Token

1. Go to **Cloudflare Dashboard → R2 → Manage R2 API Tokens**
2. Create a token with **Object Read & Write** permissions scoped to your bucket
3. Save the **Access Key ID** and **Secret Access Key**

---

## 4. Deploy

Build the UI and deploy the Worker. **This must happen before setting secrets** — wrangler can only attach secrets to an existing Worker.

```bash
# From monorepo root
npm run deploy
```

On first deploy, wrangler automatically runs the Durable Object migration defined in `[[migrations]]`, provisioning the `DownloadTokenDO` class.

---

## 5. Set Worker Secrets

```bash
# Run these from packages/worker/
cd packages/worker

wrangler secret put R2_ACCOUNT_ID        # your Cloudflare Account ID
wrangler secret put R2_ACCESS_KEY_ID     # R2 token access key
wrangler secret put R2_SECRET_ACCESS_KEY # R2 token secret key
wrangler secret put R2_BUCKET_NAME       # same as bucket_name in wrangler.toml
wrangler secret put CF_ACCESS_AUD        # CF Access application AUD tag
wrangler secret put CF_TEAM_DOMAIN       # e.g. acmecorp.cloudflareaccess.com
```

Verify with:
```bash
wrangler secret list
```

For **local development**, copy `.dev.vars.example` to `.dev.vars` and fill in the values:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your actual values
```

---

## 6. Apply CORS Policy to R2

Edit `cors-policy.json` to set `AllowedOrigins` to your actual domain. The file uses R2's native format:

```json
{
  "rules": [{
    "allowed": {
      "origins": ["https://your-domain.com"],
      "methods": ["PUT", "GET"],
      "headers": ["Content-Type", "Content-Length", "x-amz-*"]
    },
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }]
}
```

```bash
# Run from monorepo root
wrangler r2 bucket cors set my-files --file cors-policy.json
```

> **Important:** `exposeHeaders: ["ETag"]` is required so the browser can read part ETags during multipart uploads.

---

## 7. Local Development

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

> **Note:** On first local run, wrangler creates a local simulation of the R2 bucket, D1 database, and Durable Object. Presigned URLs (which use R2's S3 API) still require real credentials in `.dev.vars`.

---

## 8. Custom Domain

1. Go to **Cloudflare Dashboard → Workers & Pages → cf-file-manager → Settings → Domains & Routes**
2. Add your custom domain
3. Update `cors-policy.json` `AllowedOrigins` to include your domain and re-apply CORS

---

## 9. Enable Cloudflare Access (Authentication)

When your CF Access application is ready:

1. Note the **AUD tag** from your Access application settings
2. Set secrets: `wrangler secret put CF_ACCESS_AUD` and `wrangler secret put CF_TEAM_DOMAIN`
3. Set `ENVIRONMENT = "production"` in `wrangler.toml` `[vars]`
4. Update `packages/worker/src/middleware/auth.ts` — replace the dev mock with real JWT validation using the JWKS endpoint at `https://<CF_TEAM_DOMAIN>/cdn-cgi/access/certs`

---

## Upload Limits

| Scenario | Limit | Detail |
|---|---|---|
| Single PUT | ≤ 100 MB | Presigned URL, 30-min TTL |
| Multipart parts | 100 MB each | Just-in-time presigned URL, 3 concurrent |
| Object max (multipart) | ~4.995 TiB | R2 platform limit |
| Download token | Single use | Enforced by Durable Object (serialized queue) |
| Download token TTL | 1 hour | DO alarm self-cleanup |
| Download redirect TTL | 30 seconds | Presigned GET URL after token is consumed |

---

## Project Structure

```
cf-file-manager/
├── packages/
│   ├── worker/                        # Hono API + Workers Assets
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point, route mounting + asset fallback
│   │   │   ├── types.ts               # Env bindings interface
│   │   │   ├── middleware/auth.ts     # CF Access JWT validation
│   │   │   ├── lib/s3.ts             # S3Client factory for R2 S3-compatible API
│   │   │   ├── durable-objects/
│   │   │   │   └── DownloadTokenDO.ts # Single-use download token enforcement
│   │   │   └── routes/
│   │   │       ├── files.ts           # List, upload-url, preview-url, delete
│   │   │       ├── download.ts        # Token issue + consume + redirect
│   │   │       ├── multipart.ts       # Init, part-url, complete, abort
│   │   │       └── shares.ts          # Share CRUD + grantee API (/shared/:token/*)
│   │   ├── schema.sql                 # D1 schema for the shares table
│   │   └── wrangler.toml
│   └── ui/                            # React + Vite SPA
│       └── src/
│           ├── App.tsx                # Tab routing (My Files / Shared with me)
│           ├── lib/api.ts             # Typed API client (all endpoints)
│           └── components/
│               ├── UploadZone.tsx     # Drag-and-drop, single + multipart upload
│               ├── FileList.tsx       # My Files table with preview/download/share
│               ├── SharedWithMe.tsx   # Shared with me list
│               ├── SharedItemView.tsx # Shared folder/file browser (grantee view)
│               ├── PreviewModal.tsx   # Carousel preview modal (images/video/audio/PDF/text)
│               └── ProgressBar.tsx   # Upload progress indicator
├── cors-policy.json
└── README.md
```
