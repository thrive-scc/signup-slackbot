import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, vi } from 'vitest';

beforeAll(async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Integration tests must inject a fake for external HTTP.');
  });
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM deliveries').run();
  await env.DB.prepare('DELETE FROM activity').run();
  await env.DB.prepare('DELETE FROM operation_receipts').run();
  await env.DB.prepare('DELETE FROM classes').run();
  await env.DB.prepare('DELETE FROM life_groups').run();
  await env.DB.prepare(env.TEST_SEED).run();
});
