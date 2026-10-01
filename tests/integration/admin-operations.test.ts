import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { createWorker } from '../../worker/http';
import { signupForClass } from '../../worker/application/signup-for-class';
import { signupStore } from '../../worker/adapters/d1/signups';
import { calendarLink } from '../../worker/adapters/calendar-download';
import { deliverPending } from '../../worker/delivery';
import { enqueueScheduled } from '../../worker/scheduling';
import type { GroupOperations } from '../../worker/domain/operations';
import { fixedClock } from '../support/clock';
import { FakeSlack } from '../support/slack';
import { calendarSecret } from '../support/command';

const clock = fixedClock('2026-10-31T20:00:00Z');
const worker = createWorker(
  () => ({ id: 'admin:authenticated-fixture' }),
  clock,
  'class-start',
);
const config = () => ({
  ...env,
  CALENDAR_SIGNING_KEY: calendarSecret,
  PUBLIC_ORIGIN: 'https://snacks.invalid',
  SLACK_BOT_TOKEN: 'fixture-bot',
  SLACK_BOT_WORKSPACE_ID: 'T_FIXTURE',
});
const read = (query = 'groupId=thrive-fixture', method = 'GET') =>
  worker.fetch(
    new Request(`https://snacks.invalid/api/admin/operations?${query}`, {
      method,
    }),
    config(),
  );
const signup = (
  date = '2026-11-01',
  groupId = 'thrive-fixture',
  workspaceId = 'T_FIXTURE',
) =>
  signupForClass(
    {
      groupId,
      workspaceId,
      actorUserId: 'U_FIXTURE',
      localDate: date,
      requestId: crypto.randomUUID(),
      replyChannelId: 'C_FIXTURE',
    },
    signupStore(env.DB),
    clock,
    () => crypto.randomUUID(),
  );

it('shows signup, anonymous calendar request and admin cancellation with the original volunteer and delivery outcomes', async () => {
  const { receipt } = await signup();
  const link = await calendarLink(
    'https://snacks.invalid',
    calendarSecret,
    receipt.assignmentId!,
  );
  expect((await worker.fetch(new Request(link), config())).status).toBe(200);
  expect(
    (
      await worker.fetch(
        new Request('https://snacks.invalid/api/admin/classes', {
          method: 'POST',
          headers: {
            Origin: 'https://snacks.invalid',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            groupId: 'thrive-fixture',
            localDate: '2026-11-01',
            operation: 'NO_SNACK',
            expectedStatus: 'ASSIGNED',
            expectedAssignmentId: receipt.assignmentId,
            requestId: crypto.randomUUID(),
            actorUserId: 'forged:actor',
          }),
        }),
        config(),
      )
    ).status,
  ).toBe(200);
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: false, error: 'not_in_channel' }));
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(config(), clock, slack.fetch);
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const snapshot = await response.json<GroupOperations>();
  expect(snapshot.checkedAt).toBe(clock.now().toISOString());
  expect(snapshot.activity.map((entry) => entry.kind)).toEqual([
    'NO_SNACK',
    'CALENDAR_DOWNLOAD',
    'SIGNUP',
  ]);
  expect(snapshot.activity[0]).toMatchObject({
    actorUserId: 'admin:authenticated-fixture',
    previousVolunteerId: 'U_FIXTURE',
    previousAssignmentId: receipt.assignmentId,
    outcome: 'MARKED_NO_SNACK',
  });
  expect(snapshot.activity[1]).toMatchObject({
    actorUserId: null,
    outcome: 'SERVED',
    assignmentId: receipt.assignmentId,
  });
  expect(snapshot.deliveryCounts).toEqual({
    PENDING: 0,
    SENDING: 0,
    FAILED: 1,
    SENT: 1,
    SKIPPED: 0,
  });
  expect(snapshot.deliveries).toEqual([
    expect.objectContaining({
      status: 'FAILED',
      lastError: 'SLACK_REJECTED',
      recipientUserId: 'U_FIXTURE',
      attempts: 1,
    }),
  ]);
  const all = await (
    await read('groupId=thrive-fixture&messages=all')
  ).json<GroupOperations>();
  expect(all.deliveries[0]).toMatchObject({
    kind: 'CANCELLATION_NOTICE',
    status: 'SENT',
    recipientUserId: 'U_FIXTURE',
    localDate: '2026-11-01',
  });
  expect(JSON.stringify(all)).not.toContain('signature=');
  expect(JSON.stringify(all)).not.toContain('forged:actor');
});

it('keeps pending deliveries recoverable and reads do not send messages or mutate signup state', async () => {
  await signup();
  const slack = new FakeSlack();
  slack.enqueue(
    new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  );
  await deliverPending(config(), clock, slack.fetch);
  const before = (await env.DB.prepare('SELECT * FROM deliveries').all())
    .results;
  const snapshot = await (await read()).json<GroupOperations>();
  expect(snapshot.deliveryCounts.PENDING).toBe(1);
  expect(snapshot.deliveries[0]).toMatchObject({
    status: 'PENDING',
    availableAt: '2026-10-31T20:02:00.000Z',
    attempts: 1,
    lastError: 'RATE_LIMITED',
  });
  expect(
    (await env.DB.prepare('SELECT * FROM deliveries').all()).results,
  ).toEqual(before);
  expect(
    await env.DB.prepare('SELECT status FROM classes').first('status'),
  ).toBe('ASSIGNED');
  expect(slack.requests).toHaveLength(1);
});

it('shows scheduled messages without manufacturing operation receipts', async () => {
  await signup('2026-11-08');
  await enqueueScheduled(env.DB, fixedClock('2026-11-05T21:00:00Z'));
  const snapshot = await (await read()).json<GroupOperations>();
  expect(
    snapshot.deliveries.find((message) => message.kind === 'REMINDER'),
  ).toMatchObject({
    recipientUserId: 'U_FIXTURE',
    localDate: '2026-11-08',
    scheduledAt: '2026-11-05T21:00:00.000Z',
  });
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM operation_receipts').first(
      'n',
    ),
  ).toBe(1);
});

it('isolates activity, delivery history and counts by group', async () => {
  await env.DB.prepare(
    `INSERT INTO life_groups (id, name, slack_workspace_id, slack_channel_id, timezone, weekday, start_time, end_time, schedule_start_date)
    SELECT 'other-group', 'Other group', 'T_OTHER', 'C_OTHER', timezone, weekday, start_time, end_time, schedule_start_date FROM life_groups WHERE id='thrive-fixture'`,
  ).run();
  await signup();
  await signup('2026-11-08', 'other-group', 'T_OTHER');
  const otherActivity = await env.DB.prepare(
    "SELECT id FROM activity WHERE life_group_id='other-group'",
  ).first('id');
  const snapshot = await (await read()).json<GroupOperations>();
  expect(snapshot.workspaceId).toBe('T_FIXTURE');
  expect(snapshot.activity).toHaveLength(1);
  expect(snapshot.activity[0]!.id).not.toBe(otherActivity);
  expect(snapshot.deliveries).toHaveLength(1);
  expect(snapshot.deliveryCounts.PENDING).toBe(1);
  const other = await (
    await read('groupId=other-group')
  ).json<GroupOperations>();
  expect(other.workspaceId).toBe('T_OTHER');
  expect(other.activity[0]!.localDate).toBe('2026-11-08');
});

it('bounds history and reports older records, without hiding an old pending message behind newer sent ones', async () => {
  await signup();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < 51; i++) {
    const start = new Date(
      Date.parse('2026-11-08T15:30:00Z') + i * 7 * 86400_000,
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO activity (occurred_at, life_group_id, local_date, actor_user_id, kind, outcome)
      VALUES (?, 'thrive-fixture', ?, 'admin:fixture', 'OPEN', 'UNCHANGED')`,
      ).bind(clock.now().toISOString(), start.toISOString().slice(0, 10)),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO deliveries (life_group_id, kind, local_date, scheduled_at, available_at, expires_at, status)
      VALUES ('thrive-fixture', 'CLASS_START', ?, ?, ?, ?, 'SENT')`,
      ).bind(
        start.toISOString().slice(0, 10),
        start.toISOString(),
        start.toISOString(),
        new Date(start.getTime() + 3600_000).toISOString(),
      ),
    );
  }
  await env.DB.batch(statements);
  const attention = await (await read()).json<GroupOperations>();
  expect(attention.deliveries).toHaveLength(1);
  expect(attention.deliveries[0]!.kind).toBe('INTERACTION_REPLY');
  expect(attention.deliveryCounts).toMatchObject({ PENDING: 1, SENT: 51 });
  expect(attention.activity).toHaveLength(50);
  expect(attention.moreActivity).toBe(true);
  expect(
    attention.activity.every(
      (entry, index, entries) => !index || entry.id < entries[index - 1]!.id,
    ),
  ).toBe(true);
  const all = await (
    await read('groupId=thrive-fixture&messages=all')
  ).json<GroupOperations>();
  expect(all.deliveries).toHaveLength(50);
  expect(all.moreDeliveries).toBe(true);
  await env.DB.prepare(
    "UPDATE deliveries SET status='SENDING', lease_id='opaque-lease-secret', lease_until='2026-10-31T20:01:00.000Z' WHERE kind='INTERACTION_REPLY'",
  ).run();
  expect(JSON.stringify(await (await read()).json())).not.toContain(
    'opaque-lease-secret',
  );
});

it.each([
  ['', 400],
  ['groupId=missing', 404],
  ['groupId=thrive-fixture&groupId=other-group', 400],
  ['groupId=thrive-fixture&messages=unknown', 400],
  ['groupId=thrive-fixture&messages=all&messages=attention', 400],
])('rejects invalid or ambiguous read requests (%s)', async (query, status) => {
  expect((await read(query)).status).toBe(status);
});

it('requires authenticated admin access and rejects writes', async () => {
  const request = new Request(
    'https://snacks.invalid/api/admin/operations?groupId=thrive-fixture',
    {
      headers: {
        'CF-Access-Authenticated-User-Email': 'forged@example.invalid',
      },
    },
  );
  expect(
    (await createWorker(() => false, clock).fetch(request, config())).status,
  ).toBe(503);
  const post = await read('groupId=thrive-fixture', 'POST');
  expect(post.status).toBe(405);
  expect(post.headers.get('Allow')).toBe('GET');
});

it('database failures remain visible without exposing diagnostics or pretending history is empty', async () => {
  await env.DB.prepare('DROP TABLE activity').run();
  const response = await read();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Activity and messages are temporarily unavailable.',
  });
});
