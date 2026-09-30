import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations, createScheduledController } from 'cloudflare:test';
import { expect, it } from 'vitest';
import localWorker from '../../worker/local';

it('reads migrated and seeded local D1 through the admin HTTP boundary', async () => {
  const response = await localWorker.fetch(
    new Request('http://localhost/api/admin/groups'),
    env,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    groups: [
      {
        id: 'thrive-fixture',
        name: 'Thrive (sample)',
        timezone: 'America/Chicago',
        weekday: 0,
        startTime: '09:30',
        endTime: '11:45',
      },
    ],
  });
});

it('blocks the deployable admin entry even with a forged localhost host/header', async () => {
  for (const path of ['/', '/api/admin/groups']) {
    const response = await exports.default.fetch('http://localhost' + path, {
      headers: {
        'Cf-Access-Authenticated-User-Email': 'fixture@example.invalid',
      },
    });
    expect(response.status).toBe(503);
  }
  expect(
    (await exports.default.fetch('https://example.invalid/health')).status,
  ).toBe(200);
});

it('does not route unknown APIs or Slack requests into the UI', async () => {
  for (const path of ['/api/missing', '/slack/missing']) {
    expect(
      (await localWorker.fetch(new Request('http://localhost' + path), env))
        .status,
    ).toBe(404);
  }
});

it('returns an actionable failure instead of empty data when the database fails', async () => {
  await env.DB.prepare(
    'ALTER TABLE life_groups RENAME TO unavailable_groups',
  ).run();
  try {
    const response = await localWorker.fetch(
      new Request('http://localhost/api/admin/groups'),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Life groups are temporarily unavailable.',
    });
  } finally {
    await env.DB.prepare(
      'ALTER TABLE unavailable_groups RENAME TO life_groups',
    ).run();
  }
});

it('can replay migrations and seeds without losing configuration', async () => {
  await env.DB.prepare("UPDATE life_groups SET name = 'Edited locally'").run();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(env.TEST_SEED).run();
  expect(
    await env.DB.prepare('SELECT name FROM life_groups').all(),
  ).toMatchObject({ results: [{ name: 'Edited locally' }] });
});

it('enforces a unique group and valid weekday directly in D1', async () => {
  await expect(
    env.DB.prepare('UPDATE life_groups SET weekday = 7').run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare('INSERT INTO life_groups SELECT * FROM life_groups').run(),
  ).rejects.toThrow();
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM life_groups').first(
      'count',
    ),
  ).toBe(1);
});

it('rolls back an earlier write when a later statement in the same D1 batch fails', async () => {
  await expect(
    env.DB.batch([
      env.DB.prepare("UPDATE life_groups SET name = 'Must roll back'"),
      env.DB.prepare('UPDATE life_groups SET weekday = 7'),
    ]),
  ).rejects.toThrow();
  expect(
    await env.DB.prepare('SELECT name FROM life_groups').first('name'),
  ).toBe('Thrive (sample)');
});

it('invokes the scheduled runtime probe twice without changing configuration', async () => {
  const controller = createScheduledController({
    scheduledTime: Date.parse('2026-09-10T20:00:00Z'),
  });
  await localWorker.scheduled(controller, env);
  await localWorker.scheduled(controller, env);
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM life_groups').first(
      'count',
    ),
  ).toBe(1);
});
