import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { createWorker } from '../../worker/http';
import { fixedClock } from '../support/clock';
import {
  calendarSecret,
  commandSecret,
  signedCommand,
} from '../support/command';

const clock = fixedClock('2026-10-31T20:00:00Z');
const worker = createWorker(
  () => ({ id: 'admin:authenticated-fixture' }),
  clock,
  'class-start',
);
const config = () => ({
  ...env,
  SLACK_SIGNING_SECRET: commandSecret,
  CALENDAR_SIGNING_KEY: calendarSecret,
  PUBLIC_ORIGIN: 'https://snacks.invalid',
});
const update = (body: object, origin = 'https://snacks.invalid') =>
  worker.fetch(
    new Request('https://snacks.invalid/api/admin/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        groupId: 'thrive-fixture',
        localDate: '2026-11-01',
        operation: 'NO_SNACK',
        expectedStatus: 'OPEN',
        requestId: crypto.randomUUID(),
        ...body,
      }),
    }),
    config(),
  );

it('admin HTTP updates show effective states, preserve actor identity, replay exactly, and invalidate old calendar links', async () => {
  const signed = await worker.fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signedCommand(),
    }),
    config(),
  );
  const link = /<(https:[^|]+)\|/.exec(
    (await signed.json<{ text: string }>()).text,
  )![1]!;
  const assignmentId = await env.DB.prepare(
    'SELECT assignment_id FROM classes',
  ).first<string>('assignment_id');
  const change = {
    expectedStatus: 'ASSIGNED',
    expectedAssignmentId: assignmentId,
    requestId: crypto.randomUUID(),
    actorUserId: 'forged:actor',
  };
  expect(await (await update(change)).json()).toMatchObject({
    receipt: { outcome: 'MARKED_NO_SNACK' },
    notificationQueued: true,
  });
  expect((await update(change)).status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT actor_user_id FROM activity WHERE kind='NO_SNACK'",
    ).first('actor_user_id'),
  ).toBe('admin:authenticated-fixture');
  expect((await worker.fetch(new Request(link), config())).status).toBe(404);
  const overview = await worker.fetch(
    new Request('https://snacks.invalid/api/admin/groups'),
    config(),
  );
  expect(await overview.json()).toMatchObject({
    assignments: [],
    classes: expect.arrayContaining([
      expect.objectContaining({ localDate: '2026-11-01', status: 'NO_SNACK' }),
      expect.objectContaining({ localDate: '2026-11-08', status: 'OPEN' }),
    ]),
  });
  expect(
    (await update({ operation: 'OPEN', expectedStatus: 'NO_SNACK' })).status,
  ).toBe(200);
  expect(
    await env.DB.prepare('SELECT volunteer_user_id FROM classes').first(
      'volunteer_user_id',
    ),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n'),
  ).toBe(1);
});

it('stale admin updates return a conflict and mismatched idempotency reuse is rejected', async () => {
  const requestId = crypto.randomUUID();
  expect((await update({ requestId })).status).toBe(200);
  expect((await update({})).status).toBe(409);
  expect((await update({ requestId, localDate: '2026-11-08' })).status).toBe(
    400,
  );
});

it('admin writes require authenticated identity and a same-origin JSON request', async () => {
  expect((await update({}, 'https://attacker.invalid')).status).toBe(403);
  expect((await update({}, '')).status).toBe(403);
  const request = new Request('https://snacks.invalid/api/admin/classes', {
    method: 'POST',
    headers: {
      Origin: 'https://snacks.invalid',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  expect(
    (await createWorker(() => false, clock).fetch(request, config())).status,
  ).toBe(503);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
  ).toBe(0);
});
