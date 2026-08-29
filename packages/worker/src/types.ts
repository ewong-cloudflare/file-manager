export interface Env {
  my_files: R2Bucket;
  DOWNLOAD_TOKENS: DurableObjectNamespace;
  ASSETS: Fetcher;
  DB: D1Database;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  CF_ACCESS_AUD: string;
  CF_TEAM_DOMAIN: string;
  ENVIRONMENT?: string;
}

export interface UserContext {
  email: string;
  name: string;
  sub: string;
}
