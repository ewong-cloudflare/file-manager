export interface Env {
  FILES: R2Bucket;
  DOWNLOAD_TOKENS: DurableObjectNamespace;
  ASSETS: Fetcher;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  CF_ACCESS_AUD: string;
  ENVIRONMENT?: string;
}
