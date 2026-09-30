import { readFile } from 'node:fs/promises';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SLACK_SIGNING_SECRET: '',
          CALENDAR_SIGNING_KEY: '',
          PUBLIC_ORIGIN: '',
          SLACK_BOT_TOKEN: '',
          SLACK_BOT_WORKSPACE_ID: '',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          TEST_SEED: await readFile('./tests/fixtures/life-groups.sql', 'utf8'),
        },
      },
    }),
  ],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
  },
});
