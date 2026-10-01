import { env } from 'cloudflare:workers';
import { createScheduledController } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { enqueueScheduled } from '../../worker/scheduling';
import { deliverPending } from '../../worker/delivery';
import { createWorker } from '../../worker/http';
import localWorker from '../../worker/local';
import productionWorker from '../../worker/index';
import { signupForClass } from '../../worker/application/signup-for-class';
import { manageClass } from '../../worker/application/manage-class';
import { signupStore } from '../../worker/adapters/d1/signups';
import {
  applyLifecycle,
  readOperation,
} from '../../worker/adapters/d1/lifecycle';
import type { LifecycleOperation } from '../../worker/domain/lifecycle';
import { fixedClock } from '../support/clock';
import { FakeSlack } from '../support/slack';
import {
  calendarSecret,
  commandSecret,
  signedCommand,
} from '../support/command';

const groupId = 'thrive-fixture';
const date = '2026-11-01';
const due = '2026-10-29T20:00:00Z';
const start = '2026-11-01T15:30:00Z';
const early = '2026-10-28T20:00:00Z';
const config = () => ({
  ...env,
  SLACK_BOT_TOKEN: 'fixture-token',
  SLACK_BOT_WORKSPACE_ID: 'T_FIXTURE',
  SLACK_SIGNING_SECRET: commandSecret,
  CALENDAR_SIGNING_KEY: calendarSecret,
  PUBLIC_ORIGIN: 'https://snacks.invalid',
});
const signup = (localDate = date, at = early, group = groupId) =>
  signupForClass(
    {
      groupId: group,
      workspaceId: 'T_FIXTURE',
      actorUserId: 'U_FIXTURE',
      localDate,
      requestId: crypto.randomUUID(),
    },
    signupStore(env.DB),
    fixedClock(at),
    () => crypto.randomUUID(),
  );
async function change(
  operation: LifecycleOperation,
  at: string,
  targetDate?: string,
) {
  const assignmentId = await env.DB.prepare(
    'SELECT assignment_id FROM classes WHERE life_group_id=? AND local_date=?',
  )
    .bind(groupId, date)
    .first<string>('assignment_id');
  return manageClass(
    {
      groupId,
      localDate: date,
      actorUserId: 'U_FIXTURE',
      operation,
      targetDate,
      requestId: crypto.randomUUID(),
      expectedStatus: 'ASSIGNED',
      expectedAssignmentId: assignmentId!,
    },
    operation === 'NO_SNACK'
      ? { kind: 'admin' }
      : { kind: 'volunteer', workspaceId: 'T_FIXTURE' },
    {
      ...signupStore(env.DB),
      getReceipt: (g, r) => readOperation(env.DB, g, r),
      apply: (input) => applyLifecycle(env.DB, input),
    },
    fixedClock(at),
    'class-start',
  );
}
const jobs = async () =>
  (
    await env.DB.prepare(
      `SELECT kind, status, attempts, last_error, local_date, scheduled_at, expires_at
  FROM deliveries ORDER BY id`,
    ).all()
  ).results;
const messages = (slack: FakeSlack) =>
  slack.requests.map(
    (r) => JSON.parse(r.body) as { channel: string; text: string },
  );
async function cron(at: string, slack: FakeSlack) {
  const previous = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    // A delayed/replayed trigger timestamp does not override the actual clock.
    await createWorker(() => false, fixedClock(at), 'class-start').scheduled(
      createScheduledController({ scheduledTime: Date.parse(early) }),
      config(),
    );
  } finally {
    vi.stubGlobal('fetch', previous);
  }
}

it('the actual scheduled entry sends at Thursday 3 PM, and repeated/concurrent passes do not duplicate the job', async () => {
  await signup();
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await cron('2026-10-29T19:59:59.999Z', slack);
  expect(await jobs()).toEqual([]);
  await Promise.all([
    enqueueScheduled(env.DB, fixedClock(due)),
    enqueueScheduled(env.DB, fixedClock(due)),
  ]);
  await Promise.all([
    deliverPending(config(), fixedClock(due), slack.fetch),
    deliverPending(config(), fixedClock(due), slack.fetch),
  ]);
  await cron(due, slack);
  expect(messages(slack)).toEqual([
    {
      channel: 'U_FIXTURE',
      text: expect.stringContaining('Thrive (sample) on Nov 1.'),
      unfurl_links: false,
      unfurl_media: false,
    },
  ]);
  expect(slack.requests[0]?.url).toBe('https://slack.com/api/chat.postMessage');
  expect(messages(slack)[0]!.text).not.toMatch(
    /9:30|11:45|America\/Chicago|\/snack list/,
  );
  expect(await jobs()).toEqual([
    expect.objectContaining({
      kind: 'REMINDER',
      status: 'SENT',
      attempts: 1,
      scheduled_at: '2026-10-29T20:00:00.000Z',
      expires_at: '2026-11-01T15:30:00.000Z',
    }),
  ]);
});

it('OPEN, NO_SNACK, and cancellation before Thursday do not generate reminders', async () => {
  await enqueueScheduled(env.DB, fixedClock(due));
  expect(await jobs()).toEqual([]);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
  ).toBe(0);
  await signup();
  await change('CANCEL', '2026-10-29T19:00:00Z');
  await enqueueScheduled(env.DB, fixedClock(due));
  await env.DB.prepare("UPDATE classes SET status='NO_SNACK'").run();
  await enqueueScheduled(env.DB, fixedClock(due));
  expect(await jobs()).toEqual([]);
});

it.each(['CANCEL', 'CHANGE', 'NO_SNACK'] as const)(
  '%s after enqueue suppresses the obsolete reminder',
  async (operation) => {
    await signup();
    await enqueueScheduled(env.DB, fixedClock(due));
    await change(
      operation,
      '2026-10-29T20:01:00Z',
      operation === 'CHANGE' ? '2026-11-08' : undefined,
    );
    const slack = new FakeSlack();
    if (operation === 'NO_SNACK') slack.enqueue(Response.json({ ok: true }));
    await deliverPending(
      config(),
      fixedClock('2026-10-29T20:02:00Z'),
      slack.fetch,
    );
    expect((await jobs()).find((j) => j.kind === 'REMINDER')).toMatchObject({
      status: 'SKIPPED',
      attempts: 0,
      last_error: 'STALE_ASSIGNMENT',
    });
    expect(
      messages(slack).some((m) => m.text.includes('friendly reminder')),
    ).toBe(false);
  },
);

it('a cancelled/replaced signup never receives the old reminder, even if the same person signs up again', async () => {
  const old = await signup();
  await enqueueScheduled(env.DB, fixedClock(due));
  await change('CANCEL', '2026-10-29T20:01:00Z');
  const replacement = await signup(date, '2026-10-29T20:02:00Z');
  expect(replacement.receipt.assignmentId).not.toBe(old.receipt.assignmentId);
  const slack = new FakeSlack();
  await cron('2026-10-29T20:03:00Z', slack);
  expect(slack.requests).toHaveLength(0);
  expect(await jobs()).toHaveLength(1);
  expect((await jobs())[0]?.status).toBe('SKIPPED');
});

it('late signup gets its reminder in the signed command confirmation without an extra cron DM', async () => {
  const at = '2026-10-31T20:00:00Z';
  const response = await createWorker(
    () => false,
    fixedClock(at),
    'class-start',
  ).fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signedCommand(),
    }),
    config(),
  );
  expect((await response.json<{ text: string }>()).text).toContain(
    'usual reminder time has passed',
  );
  const slack = new FakeSlack();
  await cron(at, slack);
  expect(slack.requests).toHaveLength(0);
  expect(await jobs()).toEqual([]);
});

it.each(['OPEN', 'ASSIGNED', 'NO_SNACK'] as const)(
  'posts current and next-week %s state at class start, including absent rows',
  async (status) => {
    if (status === 'ASSIGNED') {
      await signup();
      await signup('2026-11-08');
    }
    if (status === 'NO_SNACK')
      await env.DB.batch(
        [date, '2026-11-08'].map((d) =>
          env.DB.prepare(
            "INSERT INTO classes(life_group_id,local_date,status) VALUES (?,?,'NO_SNACK')",
          ).bind(groupId, d),
        ),
      );
    const slack = new FakeSlack();
    slack.enqueue(Response.json({ ok: true }));
    await cron(start, slack);
    await cron('2026-11-01T15:31:00Z', slack);
    expect(messages(slack)).toHaveLength(1);
    const message = messages(slack)[0]!;
    expect(message.channel).toBe('C_FIXTURE');
    expect(message.text).toContain('Next week (Nov 8):');
    if (status === 'OPEN') {
      expect(message.text).toContain('need a snack volunteer');
      expect(
        await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
      ).toBe(0);
    }
    if (status === 'ASSIGNED')
      expect(message.text).toContain('Thanks <@U_FIXTURE>');
    if (status === 'NO_SNACK')
      expect(message.text).toContain('Snacks are not needed.');
    expect(await jobs()).toHaveLength(1);
  },
);

it('reads the following class status just before delivery rather than freezing it at enqueue', async () => {
  await enqueueScheduled(env.DB, fixedClock(start));
  await signup('2026-11-08', '2026-11-01T15:31:00Z');
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(
    config(),
    fixedClock('2026-11-01T15:32:00Z'),
    slack.fetch,
  );
  expect(messages(slack)[0]?.text).toContain(
    'Next week (Nov 8): <@U_FIXTURE> is signed up',
  );
});

it('recovers a missed Thursday run until class starts and expires pending reminders exactly at start', async () => {
  await signup();
  const slack = new FakeSlack();
  await enqueueScheduled(env.DB, fixedClock('2026-10-31T20:00:00Z'));
  await deliverPending(
    { ...config(), SLACK_BOT_TOKEN: '' },
    fixedClock('2026-10-31T20:00:00Z'),
    slack.fetch,
  );
  expect((await jobs())[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
  await deliverPending(config(), fixedClock(start), slack.fetch);
  expect((await jobs())[0]).toMatchObject({
    status: 'FAILED',
    last_error: 'EXPIRED_OR_EXHAUSTED',
  });
  expect(slack.requests).toHaveLength(0);
});

it('class-start catch-up delivers at 59 minutes but neither retries nor creates a post one hour late', async () => {
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await cron('2026-11-01T16:29:00Z', slack);
  expect(messages(slack)).toHaveLength(1);
  await env.DB.prepare("UPDATE deliveries SET status='PENDING'").run();
  await cron('2026-11-01T16:30:00Z', slack);
  expect((await jobs())[0]?.status).toBe('FAILED');
  expect(slack.requests).toHaveLength(1);
  await env.DB.prepare('DELETE FROM deliveries').run();
  await cron('2026-11-01T16:30:00Z', slack);
  expect(await jobs()).toEqual([]);
});

it('rate-limited reminders retry only while still assigned', async () => {
  await signup();
  const slack = new FakeSlack();
  slack.enqueue(
    new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  );
  await cron(due, slack);
  expect((await jobs())[0]).toMatchObject({
    status: 'PENDING',
    attempts: 1,
    last_error: 'RATE_LIMITED',
  });
  await change('CANCEL', '2026-10-29T20:01:00Z');
  await cron('2026-10-29T20:02:00Z', slack);
  expect(slack.requests).toHaveLength(1);
  expect((await jobs())[0]?.status).toBe('SKIPPED');
});

it('scheduled timeouts recover through leases and stop permanently after five attempts', async () => {
  await signup();
  await enqueueScheduled(env.DB, fixedClock(due));
  await env.DB.prepare(
    "UPDATE deliveries SET status='SENDING', lease_id='crashed', lease_until='2026-10-29T20:01:00.000Z', attempts=1",
  ).run();
  const slack = new FakeSlack();
  await cron(due, slack);
  expect(slack.requests).toHaveLength(0);
  for (const at of [
    '2026-10-29T20:01:00Z',
    '2026-10-29T20:03:00Z',
    '2026-10-29T20:07:00Z',
    '2026-10-29T20:15:00Z',
  ]) {
    slack.enqueue(new Error('timeout'));
    await cron(at, slack);
  }
  await cron('2026-10-30T20:00:00Z', slack);
  expect((await jobs())[0]).toMatchObject({ status: 'FAILED', attempts: 5 });
  expect(slack.requests).toHaveLength(4);
  expect(await jobs()).toHaveLength(1);
});

it('each group uses its own weekday, reminder settings and channel', async () => {
  await env.DB.prepare(
    `INSERT INTO life_groups (id,name,slack_workspace_id,slack_channel_id,timezone,weekday,start_time,end_time,schedule_start_date,reminder_days_before,reminder_time)
    VALUES ('midweek','Midweek','T_FIXTURE','C_MIDWEEK','America/Chicago',3,'18:00','19:00','2026-01-01',2,'18:15')`,
  ).run();
  await signup('2026-11-04', early, 'midweek');
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await cron('2026-11-03T00:15:00Z', slack);
  expect(messages(slack)[0]?.text).toContain('Midweek on Nov 4.');
  expect(messages(slack)[0]?.text).not.toContain('6:00 PM');
  slack.enqueue(Response.json({ ok: true }));
  await cron('2026-11-05T00:00:00Z', slack);
  expect(messages(slack)[1]?.channel).toBe('C_MIDWEEK');
  expect(messages(slack)[1]?.text).toContain('Next week (Nov 11)');
});

it('D1 enforces scheduled job identity and shape independently of the producer', async () => {
  await signup();
  await enqueueScheduled(env.DB, fixedClock(due));
  await expect(
    env.DB.prepare(
      `INSERT INTO deliveries (life_group_id,kind,local_date,assignment_id,scheduled_at,available_at,expires_at)
    SELECT life_group_id,kind,local_date,assignment_id,scheduled_at,available_at,expires_at FROM deliveries`,
    ).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare(
      "UPDATE deliveries SET assignment_id=NULL WHERE kind='REMINDER'",
    ).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare('UPDATE life_groups SET reminder_days_before=-1').run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare("UPDATE life_groups SET reminder_time='25:00'").run(),
  ).rejects.toThrow();
  await enqueueScheduled(env.DB, fixedClock(start));
  await expect(
    env.DB.prepare(
      `INSERT INTO deliveries(life_group_id,kind,local_date,scheduled_at,available_at,expires_at)
    SELECT life_group_id,kind,local_date,scheduled_at,available_at,expires_at FROM deliveries WHERE kind='CLASS_START'`,
    ).run(),
  ).rejects.toThrow();
});

it('a newly due channel post respects Retry-After even after the limited reminder has expired', async () => {
  await env.DB.prepare(
    "UPDATE life_groups SET reminder_days_before=0, reminder_time='09:29'",
  ).run();
  await signup();
  const slack = new FakeSlack();
  slack.enqueue(
    new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  );
  await cron('2026-11-01T15:29:00Z', slack);
  slack.enqueue(Response.json({ ok: true }));
  await cron(start, slack);
  expect(slack.requests).toHaveLength(1);
  expect((await jobs()).find((j) => j.kind === 'CLASS_START')).toMatchObject({
    status: 'PENDING',
    attempts: 0,
  });
  await cron('2026-11-01T15:31:00Z', slack);
  expect(slack.requests).toHaveLength(2);
  expect(messages(slack)[1]?.channel).toBe('C_FIXTURE');
});

it('configuration failure in one group is visible but does not prevent another group’s delivery', async () => {
  await signup();
  await env.DB.prepare(
    `INSERT INTO life_groups (id,name,slack_workspace_id,slack_channel_id,timezone,weekday,start_time,end_time,schedule_start_date)
    VALUES ('broken','Broken','T_FIXTURE','C_BROKEN','Not/AZone',0,'09:30','11:45','2026-01-01')`,
  ).run();
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(cron(due, slack)).rejects.toThrow(
      'Scheduled processing failed',
    );
    expect(log).toHaveBeenCalledWith('SCHEDULE_PROCESSING_FAILED', {
      groupId: 'broken',
    });
  } finally {
    log.mockRestore();
  }
  expect(messages(slack)[0]?.channel).toBe('U_FIXTURE');
  expect((await jobs())[0]?.status).toBe('SENT');
});

it('changing into a class after its reminder time includes the reminder in the new confirmation', async () => {
  await signup('2026-11-08');
  const response = await createWorker(
    () => false,
    fixedClock('2026-10-31T20:00:00Z'),
    'class-start',
  ).fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signedCommand({ text: 'change 2026-11-08 2026-11-01' }),
    }),
    config(),
  );
  const { text } = await response.json<{ text: string }>();
  expect(text).toContain('Change complete');
  expect(text).toContain('usual reminder time has passed');
  await enqueueScheduled(env.DB, fixedClock('2026-10-31T20:00:00Z'));
  expect(await jobs()).toEqual([]);
});

it('normal local and production entry points now permit own cancellation before class start', async () => {
  // Far future fixture; the entry points use the real clock, with a fresh signature.
  for (const [index, worker] of [localWorker, productionWorker].entries()) {
    const future = '2099-01-04';
    await signup(future);
    const response = await worker.fetch(
      new Request('https://snacks.invalid/slack/commands', {
        method: 'POST',
        ...signedCommand(
          { text: `cancel ${future}`, trigger_id: `entry-${index}` },
          Math.floor(Date.now() / 1000),
        ),
      }),
      config(),
    );
    expect((await response.json<{ text: string }>()).text).toContain(
      'was cancelled',
    );
  }
});
