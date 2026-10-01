import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('upgrades actual M2 deliveries without losing IDs, leases, receipts or class history', async () => {
  // Separate disposable binding lets this test start at the pre-M3 schema.
  const db = env.UPGRADE_DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS.slice(0, 3));
  await db.prepare(env.TEST_SEED).run();
  await db.batch([
    db.prepare(`INSERT INTO classes(life_group_id,local_date,status,volunteer_user_id,assignment_id,assigned_at,starts_at,ends_at)
      VALUES ('thrive-fixture','2026-11-01','ASSIGNED','U_FIXTURE','preserved','2026-10-28T20:00:00.000Z','2026-11-01T15:30:00.000Z','2026-11-01T17:45:00.000Z')`),
    db.prepare(`INSERT INTO operation_receipts(life_group_id,request_id,attempt_id,actor_user_id,local_date,outcome,assignment_id,created_at)
      VALUES ('thrive-fixture','existing','attempt','U_FIXTURE','2026-11-01','SIGNED_UP','preserved','2026-10-28T20:00:00.000Z')`),
    db.prepare(`INSERT INTO activity(occurred_at,life_group_id,local_date,assignment_id,actor_user_id,kind,outcome)
      VALUES ('2026-10-28T20:00:00.000Z','thrive-fixture','2026-11-01','preserved','U_FIXTURE','SIGNUP','SIGNED_UP')`),
    db.prepare(`INSERT INTO deliveries(id,life_group_id,request_id,kind,channel_id,status,attempts,available_at,expires_at,lease_id,lease_until,last_error)
      VALUES (47,'thrive-fixture','existing','INTERACTION_REPLY','C_FIXTURE','SENDING',2,'2026-10-28T20:01:00.000Z','2026-10-28T20:30:00.000Z','lease','2026-10-28T20:02:00.000Z','NETWORK_OR_RESPONSE_ERROR')`),
  ]);
  const before = {} as Record<string, unknown>;
  for (const table of [
    'classes',
    'operation_receipts',
    'activity',
    'deliveries',
  ])
    before[table] = (await db.prepare(`SELECT * FROM ${table}`).all()).results;
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  for (const table of ['classes', 'operation_receipts', 'activity'])
    expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(
      before[table],
    );
  const deliveries = (await db.prepare('SELECT * FROM deliveries').all())
    .results;
  expect(deliveries).toMatchObject(before.deliveries as object[]);
  expect(deliveries[0]).toMatchObject({
    local_date: null,
    scheduled_at: null,
    assignment_id: null,
  });
  expect(
    await db
      .prepare('SELECT reminder_days_before, reminder_time FROM life_groups')
      .first(),
  ).toEqual({ reminder_days_before: 3, reminder_time: '15:00' });
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual(
    [],
  );
  expect(
    (
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%replacement' OR name LIKE '%_v2')",
        )
        .all()
    ).results,
  ).toEqual([]);
});
