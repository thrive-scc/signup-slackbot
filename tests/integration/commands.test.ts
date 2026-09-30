import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import ICAL from 'ical.js';
import { createWorker } from '../../worker/http';
import { signupForClass } from '../../worker/application/signup-for-class';
import { signupStore } from '../../worker/adapters/d1/signups';
import { fixedClock } from '../support/clock';
import {
  commandSecret,
  calendarSecret,
  signedCommand,
} from '../support/command';

const clock = fixedClock('2026-10-31T20:00:00Z');
const worker = createWorker(() => false, clock);
const config = () => ({
  ...env,
  SLACK_SIGNING_SECRET: commandSecret,
  CALENDAR_SIGNING_KEY: calendarSecret,
  PUBLIC_ORIGIN: 'https://snacks.invalid',
});
async function command(overrides: Record<string, string> = {}) {
  return worker.fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signedCommand(overrides),
    }),
    config(),
  );
}
const count = (table: string) =>
  env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>('n');

it('signed command → D1 → private confirmation → independently parsed calendar → admin API', async () => {
  const response = await command();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const confirmation = await response.json<{
    response_type: string;
    text: string;
  }>();
  expect(confirmation.response_type).toBe('ephemeral');
  expect(confirmation.text).toContain(
    '2026-11-01, 9:30 AM–11:45 AM America/Chicago',
  );
  expect(confirmation.text).toContain('Please plan to bring snacks');
  expect(confirmation.text).toContain('visible to group administrators');
  const link = /<(https:\/\/snacks.invalid\/calendar\/[^|]+)\|/.exec(
    confirmation.text,
  )?.[1];
  expect(link).toBeTruthy();
  const calendar = await worker.fetch(new Request(link!), config());
  expect(calendar.status).toBe(200);
  const event = new ICAL.Event(
    new ICAL.Component(ICAL.parse(await calendar.text())).getFirstSubcomponent(
      'vevent',
    )!,
  );
  expect(event.startDate.toJSDate().toISOString()).toBe(
    '2026-11-01T15:30:00.000Z',
  );
  const admin = await createWorker(
    () => ({ id: 'admin:fixture' }),
    clock,
  ).fetch(new Request('http://localhost/api/admin/groups'), config());
  expect(await admin.json()).toMatchObject({
    assignments: [{ localDate: '2026-11-01', volunteerUserId: 'U_FIXTURE' }],
  });
  expect(
    (
      await worker.fetch(
        new Request('https://snacks.invalid/api/admin/groups'),
        config(),
      )
    ).status,
  ).toBe(503);
  expect(await count('classes')).toBe(1);
  expect(await count('operation_receipts')).toBe(1);
  expect(
    (
      await env.DB.prepare(
        'SELECT kind, outcome FROM activity ORDER BY id',
      ).all()
    ).results,
  ).toEqual([
    { kind: 'SIGNUP', outcome: 'SIGNED_UP' },
    { kind: 'CALENDAR_DOWNLOAD', outcome: 'SERVED' },
  ]);
  const stored = JSON.stringify(
    (await env.DB.prepare('SELECT * FROM operation_receipts').all()).results,
  );
  expect(stored).not.toContain('hooks.slack');
  expect(stored).not.toContain('fixture-trigger');
});

it('concurrent signed Slack retries return identical confirmations with one signup and audit', async () => {
  const responses = await Promise.all([command(), command()]);
  const bodies = await Promise.all(responses.map((r) => r.text()));
  expect(bodies[0]).toBe(bodies[1]);
  expect(await (await command()).text()).toBe(bodies[0]);
  for (const table of ['classes', 'activity', 'operation_receipts'])
    expect(await count(table)).toBe(1);
});

it('two signed requests compete for an implicit OPEN class with exactly one winner', async () => {
  const responses = await Promise.all([
    command(),
    command({ user_id: 'U_OTHER', trigger_id: 'second-trigger' }),
  ]);
  const texts = await Promise.all(
    responses.map(async (r) => (await r.json<{ text: string }>()).text),
  );
  expect(texts.filter((t) => t.includes('You’re signed up'))).toHaveLength(1);
  expect(texts.filter((t) => t.includes('already volunteered'))).toHaveLength(
    1,
  );
  expect(await count('classes')).toBe(1);
});

it('new invocations can recover an existing commitment and claim additional dates', async () => {
  await command();
  expect(
    (
      await (
        await command({ trigger_id: 'fresh-command' })
      ).json<{ text: string }>()
    ).text,
  ).toContain('already signed up');
  expect(
    (
      await (
        await command({ text: 'signup 2026-11-08', trigger_id: 'other-date' })
      ).json<{ text: string }>()
    ).text,
  ).toContain('You’re signed up');
  expect(await count('classes')).toBe(2);
  expect(await count('operation_receipts')).toBe(3);
});

it.each([
  [{ channel_id: 'D_FIXTURE' }, 'configured Slack channel'],
  [{ channel_id: 'C_OTHER' }, 'configured Slack channel'],
  [{ team_id: 'T_OTHER' }, 'configured Slack channel'],
  [{ text: 'signup 2026-11-02' }, 'weekly schedule'],
  [{ text: 'signup 2027-02-30' }, 'valid date'],
  [{ text: 'signup 2025-12-28' }, 'weekly schedule'],
  [{ text: 'signup 2026-10-25' }, 'Signup closes'],
  [{ text: 'help' }, '/snack signup YYYY-MM-DD'],
  [{ text: '' }, '/snack signup YYYY-MM-DD'],
  [{ text: 'signup next Sunday' }, '/snack signup YYYY-MM-DD'],
])(
  'rejects unsupported context/date or supplies guidance: %j',
  async (overrides, message) => {
    const response = await command(overrides);
    expect(response.status).toBe(200);
    expect((await response.json<{ text: string }>()).text).toContain(message);
    expect(await count('classes')).toBe(0);
    expect(await count('operation_receipts')).toBe(0);
  },
);

it('rejects ambiguous channel mappings without selecting a group', async () => {
  await env.DB.prepare(
    `INSERT INTO life_groups SELECT 'ambiguous', name, slack_workspace_id, slack_channel_id, timezone, weekday, start_time, end_time, schedule_start_date FROM life_groups`,
  ).run();
  expect((await (await command()).json<{ text: string }>()).text).toContain(
    'More than one life group',
  );
  expect(await count('classes')).toBe(0);
});

it('never assigns a NO_SNACK class', async () => {
  await env.DB.prepare(
    "INSERT INTO classes(life_group_id, local_date, status) VALUES ('thrive-fixture', '2026-11-01', 'NO_SNACK')",
  ).run();
  expect((await (await command()).json<{ text: string }>()).text).toContain(
    'Snack is not needed',
  );
  expect(
    await env.DB.prepare('SELECT status FROM classes').first('status'),
  ).toBe('NO_SNACK');
});

it('accepts just before class start, closes exactly at start, and replays the earlier success', async () => {
  const before = fixedClock('2026-11-01T15:29:59.999Z');
  const at = fixedClock('2026-11-01T15:30:00.000Z');
  const signed = signedCommand({}, Math.floor(before.now().getTime() / 1000));
  const request = () =>
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signed,
    });
  const first = await createWorker(() => false, before).fetch(
    request(),
    config(),
  );
  const retry = await createWorker(() => false, at).fetch(request(), config());
  expect(await retry.text()).toBe(await first.text());
  const fresh = signedCommand(
    { user_id: 'U_LATE', trigger_id: 'new-at-start' },
    Math.floor(at.now().getTime() / 1000),
  );
  const result = await createWorker(() => false, at).fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...fresh,
    }),
    config(),
  );
  expect((await result.json<{ text: string }>()).text).toContain(
    'Signup closes',
  );
  expect(await count('operation_receipts')).toBe(1);
});

it('rejects unsigned, tampered, stale, duplicate-field and malformed requests before mutation', async () => {
  const valid = signedCommand();
  const cases = [
    {
      body: valid.body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      status: 401,
    },
    { ...valid, body: valid.body + '&text=changed', status: 401 },
    { ...signedCommand({}, 1_000_000_000), status: 401 },
    { ...signedCommand({ user_id: '' }), status: 400 },
    { ...signedCommand({ command: '/other' }), status: 400 },
    {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      status: 415,
    },
  ];
  for (const { status, ...payload } of cases) {
    const response = await worker.fetch(
      new Request('https://snacks.invalid/slack/commands', {
        method: 'POST',
        ...payload,
      }),
      config(),
    );
    expect(response.status).toBe(status);
  }
  expect(await count('classes')).toBe(0);
});

it('fails closed on missing secrets or an invalid public origin', async () => {
  for (const overrides of [
    { SLACK_SIGNING_SECRET: '' },
    { CALENDAR_SIGNING_KEY: '' },
    { PUBLIC_ORIGIN: '' },
    { PUBLIC_ORIGIN: 'http://public.invalid' },
    { PUBLIC_ORIGIN: 'https://snacks.invalid/path' },
  ]) {
    expect(
      (
        await worker.fetch(
          new Request('https://snacks.invalid/slack/commands', {
            method: 'POST',
            ...signedCommand(),
          }),
          { ...config(), ...overrides },
        )
      ).status,
    ).toBe(503);
  }
  expect(
    (
      await worker.fetch(
        new Request('https://snacks.invalid/slack/commands'),
        config(),
      )
    ).status,
  ).toBe(405);
  expect(await count('classes')).toBe(0);
});

it('reports uncertain storage failure safely, then lets a retry complete', async () => {
  await env.DB.prepare(
    "CREATE TRIGGER reject_command_audit BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'sensitive fixture detail'); END",
  ).run();
  try {
    const result = await (await command()).json<{ text: string }>();
    expect(result.text).toContain('may have been saved');
    expect(result.text).not.toContain('sensitive fixture');
    expect(await count('classes')).toBe(0);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_command_audit').run();
  }
  expect((await (await command()).json<{ text: string }>()).text).toContain(
    'You’re signed up',
  );
});

it('application operation rejects nonexistent groups and cross-workspace callers without Slack', async () => {
  for (const [groupId, workspaceId] of [
    ['missing', 'T_FIXTURE'],
    ['thrive-fixture', 'T_OTHER'],
  ] as const) {
    await expect(
      signupForClass(
        {
          groupId,
          workspaceId,
          actorUserId: 'U_FIXTURE',
          requestId: 'request',
          localDate: '2026-11-01',
        },
        signupStore(env.DB),
        clock,
        () => crypto.randomUUID(),
      ),
    ).rejects.toThrow('not configured');
  }
  expect(await count('classes')).toBe(0);
});
