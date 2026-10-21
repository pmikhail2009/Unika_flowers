declare namespace Cloudflare {
  interface Env {
    TELEGRAM_BRIDGE_SECRET?: string;
    TELEGRAM_BOT_TOKEN?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
