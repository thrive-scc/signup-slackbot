import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { signupForClass } from '../../worker/application/signup-for-class';
import { signupStore } from '../../worker/adapters/d1/signups';
import { applyLifecycle } from '../../worker/adapters/d1/lifecycle';
import { deliverPending } from '../../worker/delivery';
import { FakeSlack } from '../support/slack';
import { fixedClock } from '../support/clock';

const clock = fixedClock('2026-10-31T20:00:00Z');
const config = () => ({
  ...env,
  SLACK_BOT_TOKEN: 'fixture-token',
  SLACK_BOT_WORKSPACE_ID: 'T_FIXTURE',
  PUBLIC_ORIGIN: 'https://snacks.invalid',
  CALENDAR_SIGNING_KEY: 'fixture-calendar',
});
const jobs = () =>
  env.DB.prepare(
    'SELECT status, attempts, last_error FROM deliveries ORDER BY id',
  ).all();
async function seed(reply = false) {
  const { receipt } = await signupForClass(
    {
      groupId: 'thrive-fixture',
      workspaceId: 'T_FIXTURE',
      actorUserId: 'U_FIXTURE',
      localDate: '2026-11-01',
      requestId: 'signup',
      ...(reply ? { replyChannelId: 'C_FIXTURE' } : {}),
    },
    signupStore(env.DB),
    clock,
    () => crypto.randomUUID(),
  );
  if (!reply)
    await applyLifecycle(env.DB, {
      groupId: 'thrive-fixture',
      requestId: 'admin-cancel',
      actorUserId: 'admin:fixture',
      operation: 'NO_SNACK',
      localDate: '2026-11-01',
      expectedStatus: 'ASSIGNED',
      expectedAssignmentId: receipt.assignmentId!,
      now: clock.now().toISOString(),
      newAssignmentId: crypto.randomUUID(),
      targetStartsAt: null,
      targetEndsAt: null,
      volunteerCutoff: 'class-start',
    });
}

it('competing and repeated delivery passes send one committed cancellation notice to the affected volunteer', async () => {
  await seed();
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await Promise.all([
    deliverPending(config(), clock, slack.fetch),
    deliverPending(config(), clock, slack.fetch),
  ]);
  await deliverPending(config(), clock, slack.fetch);
  expect(slack.requests).toHaveLength(1);
  expect(slack.requests[0]?.url).toBe('https://slack.com/api/chat.postMessage');
  expect(JSON.parse(slack.requests[0]!.body)).toMatchObject({
    channel: 'U_FIXTURE',
    text: expect.stringContaining("You're off the hook!"),
  });
  expect((await jobs()).results).toEqual([
    { status: 'SENT', attempts: 1, last_error: null },
  ]);
  expect(
    await env.DB.prepare('SELECT status FROM classes').first('status'),
  ).toBe('NO_SNACK');
});

it('interactive signup confirmation is private and includes the calendar link', async () => {
  await seed(true);
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(config(), clock, slack.fetch);
  expect(slack.requests[0]?.url).toBe(
    'https://slack.com/api/chat.postEphemeral',
  );
  expect(JSON.parse(slack.requests[0]!.body)).toMatchObject({
    channel: 'C_FIXTURE',
    user: 'U_FIXTURE',
    text: expect.stringContaining('Add to your calendar'),
  });
  expect((await jobs()).results[0]?.status).toBe('SENT');
});

it('rate limits honor Retry-After and retry without changing assignment state', async () => {
  await seed(true);
  const slack = new FakeSlack();
  slack.enqueue(
    new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  );
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(config(), clock, slack.fetch);
  await deliverPending(
    config(),
    fixedClock('2026-10-31T20:01:59Z'),
    slack.fetch,
  );
  expect(slack.requests).toHaveLength(1);
  expect((await jobs()).results[0]).toMatchObject({
    status: 'PENDING',
    last_error: 'RATE_LIMITED',
  });
  await deliverPending(
    config(),
    fixedClock('2026-10-31T20:02:00Z'),
    slack.fetch,
  );
  expect(slack.requests).toHaveLength(2);
  expect(
    await env.DB.prepare('SELECT status FROM classes').first('status'),
  ).toBe('ASSIGNED');
});

it.each([
  new Error('timeout with secret-token'),
  new Response('private debug body', { status: 503 }),
  Response.json({ ok: false, error: 'internal_error' }),
])('retains a sanitized retryable failure, then recovers', async (failure) => {
  await seed();
  const slack = new FakeSlack();
  slack.enqueue(failure);
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(config(), clock, slack.fetch);
  expect((await jobs()).results[0]).toMatchObject({
    status: 'PENDING',
    attempts: 1,
  });
  expect(JSON.stringify((await jobs()).results)).not.toMatch(
    /secret-token|private debug/,
  );
  await deliverPending(
    config(),
    fixedClock('2026-10-31T20:00:30Z'),
    slack.fetch,
  );
  expect((await jobs()).results[0]?.status).toBe('SENT');
});

it('permanent Slack rejection is visible as failed and never undoes the admin change', async () => {
  await seed();
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: false, error: 'invalid_auth' }));
  await deliverPending(config(), clock, slack.fetch);
  await deliverPending(
    config(),
    fixedClock('2026-10-31T21:00:00Z'),
    slack.fetch,
  );
  expect(slack.requests).toHaveLength(1);
  expect((await jobs()).results[0]).toMatchObject({
    status: 'FAILED',
    last_error: 'SLACK_REJECTED',
  });
  expect(
    await env.DB.prepare('SELECT status FROM classes').first('status'),
  ).toBe('NO_SNACK');
});

it('recovers an expired claim but respects a live lease, expiry, and the attempt limit', async () => {
  await seed();
  await env.DB.prepare(
    "UPDATE deliveries SET status='SENDING',lease_id='crashed',lease_until='2026-10-31T20:01:00.000Z',attempts=1",
  ).run();
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true }));
  await deliverPending(config(), clock, slack.fetch);
  expect(slack.requests).toHaveLength(0);
  await deliverPending(
    config(),
    fixedClock('2026-10-31T20:01:00Z'),
    slack.fetch,
  );
  expect(slack.requests).toHaveLength(1);
  expect((await jobs()).results[0]).toMatchObject({
    status: 'SENT',
    attempts: 2,
  });
  await env.DB.prepare(
    "UPDATE deliveries SET status='PENDING',attempts=5",
  ).run();
  await deliverPending(config(), clock, slack.fetch);
  expect((await jobs()).results[0]?.status).toBe('FAILED');
  await env.DB.prepare(
    "UPDATE deliveries SET status='PENDING',attempts=0",
  ).run();
  await deliverPending(
    config(),
    fixedClock('2026-11-01T20:00:00Z'),
    slack.fetch,
  );
  expect((await jobs()).results[0]?.status).toBe('FAILED');
  expect(slack.requests).toHaveLength(1);
});

it('missing delivery configuration retains work and a different workspace token never sends it', async () => {
  await seed();
  const slack = new FakeSlack();
  await deliverPending(
    { ...config(), SLACK_BOT_TOKEN: '' },
    clock,
    slack.fetch,
  );
  expect((await jobs()).results[0]).toMatchObject({
    status: 'PENDING',
    attempts: 0,
    last_error: 'SLACK_NOT_CONFIGURED',
  });
  await deliverPending(
    { ...config(), SLACK_BOT_WORKSPACE_ID: 'T_OTHER' },
    clock,
    slack.fetch,
  );
  expect((await jobs()).results[0]?.status).toBe('FAILED');
  expect(slack.requests).toHaveLength(0);
});
