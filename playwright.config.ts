import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npx vite --mode test --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://127.0.0.1:8788/health',
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command:
        'npx wrangler dev --local --port 8789 --persist-to /tmp/snack-production-probe --env-file tests/fixtures/worker.env',
      url: 'http://127.0.0.1:8789/health',
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
