declare namespace Cloudflare {
  interface Env {
    UPGRADE_DB: D1Database;
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
    TEST_SEED: string;
  }
}
