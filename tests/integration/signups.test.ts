import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { signupStore } from '../../worker/adapters/d1/signups';
import type { ClaimClass } from '../../worker/domain/signup';

const claim: ClaimClass = {
  groupId: 'thrive-fixture',
  requestId: 'request-one',
  actorUserId: 'U_ONE',
  assignmentId: 'assignment-one',
  localDate: '2026-11-01',
  now: '2026-10-30T15:00:00.000Z',
  startsAt: '2026-11-01T15:30:00.000Z',
  endsAt: '2026-11-01T17:45:00.000Z',
};
const count = (table: string) =>
  env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>(
    'count',
  );

it('keeps class claims and request receipts isolated between groups', async () => {
  await env.DB.prepare(
    `INSERT INTO life_groups
    (id, name, slack_workspace_id, slack_channel_id, timezone, weekday, start_time, end_time, schedule_start_date)
    SELECT 'other-group', 'Other group', 'T_OTHER', 'C_OTHER', timezone, weekday, start_time, end_time, schedule_start_date FROM life_groups`,
  ).run();
  const store = signupStore(env.DB);
  expect((await store.claim(claim)).outcome).toBe('SIGNED_UP');
  expect(
    (
      await store.claim({
        ...claim,
        groupId: 'other-group',
        assignmentId: 'other-assignment',
      })
    ).outcome,
  ).toBe('SIGNED_UP');
  expect(await count('classes')).toBe(2);
  expect(await count('operation_receipts')).toBe(2);
});

it('two simultaneous first claims have one winner, never an overwritten volunteer', async () => {
  const store = signupStore(env.DB);
  expect(await count('classes')).toBe(0);
  const results = await Promise.all([
    store.claim(claim),
    store.claim({
      ...claim,
      requestId: 'request-two',
      actorUserId: 'U_TWO',
      assignmentId: 'assignment-two',
    }),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual(['SIGNED_UP', 'TAKEN']);
  expect(await count('classes')).toBe(1);
  const winner = results.find((r) => r.outcome === 'SIGNED_UP');
  expect(
    await env.DB.prepare('SELECT volunteer_user_id FROM classes').first(
      'volunteer_user_id',
    ),
  ).toBe(winner?.actorUserId);
  expect(await count('operation_receipts')).toBe(2);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM activity WHERE outcome='SIGNED_UP'",
    ).first('count'),
  ).toBe(1);
});

it('concurrent and later retries return the original receipt and record only one activity', async () => {
  const store = signupStore(env.DB);
  const results = await Promise.all([
    store.claim(claim),
    store.claim({ ...claim, assignmentId: 'retry-assignment' }),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await store.claim({ ...claim, assignmentId: 'later-retry' })).toEqual(
    results[0],
  );
  expect(await count('operation_receipts')).toBe(1);
  expect(await count('activity')).toBe(1);
});

it('a new request by the same person recovers their existing assignment without a second commitment', async () => {
  const store = signupStore(env.DB);
  await store.claim(claim);
  expect(
    await store.claim({
      ...claim,
      requestId: 'new-request',
      assignmentId: 'unused',
    }),
  ).toMatchObject({
    outcome: 'ALREADY_SIGNED_UP',
    assignmentId: 'assignment-one',
  });
  expect(await count('classes')).toBe(1);
  expect(await count('operation_receipts')).toBe(2);
});

it('claims explicit OPEN but never NO_SNACK', async () => {
  await env.DB.prepare(
    "INSERT INTO classes(life_group_id, local_date, status) VALUES (?, ?, 'NO_SNACK')",
  )
    .bind(claim.groupId, claim.localDate)
    .run();
  expect((await signupStore(env.DB).claim(claim)).outcome).toBe('NO_SNACK');
  await env.DB.prepare("UPDATE classes SET status='OPEN'").run();
  expect(
    (await signupStore(env.DB).claim({ ...claim, requestId: 'fresh' })).outcome,
  ).toBe('SIGNED_UP');
});

it('rolls back the claim and receipt if recording the audit fails', async () => {
  await env.DB.prepare(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  ).run();
  try {
    await expect(signupStore(env.DB).claim(claim)).rejects.toThrow();
    for (const table of ['classes', 'operation_receipts', 'activity'])
      expect(await count(table)).toBe(0);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_audit').run();
  }
});

it('D1 directly enforces class uniqueness, dates, foreign keys and state/assignment consistency', async () => {
  for (const date of ['2026-02-30', '2026-13-01', 'bad']) {
    await expect(
      env.DB.prepare(
        "INSERT INTO classes(life_group_id, local_date, status) VALUES ('thrive-fixture', ?, 'OPEN')",
      )
        .bind(date)
        .run(),
    ).rejects.toThrow();
  }
  await expect(
    env.DB.prepare(
      "INSERT INTO classes(life_group_id, local_date, status) VALUES ('missing', '2026-11-01', 'OPEN')",
    ).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare(
      "INSERT INTO classes(life_group_id, local_date, status) VALUES ('thrive-fixture', '2026-11-01', 'ASSIGNED')",
    ).run(),
  ).rejects.toThrow();
  await signupStore(env.DB).claim(claim);
  await expect(
    env.DB.prepare('INSERT INTO classes SELECT * FROM classes').run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare("UPDATE classes SET status='NO_SNACK'").run(),
  ).rejects.toThrow();
  expect(await count('classes')).toBe(1);
});
