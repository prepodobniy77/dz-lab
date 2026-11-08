declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ASSETS?: Fetcher;
    PRICE_JOB_TOKEN?: string;
    FEED_MAX_AGE_HOURS?: string;
    PRICE_WORKER_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
