declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
    TEST_SEED: string;
  }
}
