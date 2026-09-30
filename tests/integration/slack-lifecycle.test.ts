import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import { createWorker } from '../../worker/http';
import { fixedClock } from '../support/clock';
import {
  signedCommand,
  commandSecret,
  calendarSecret,
} from '../support/command';
import { signedInteraction } from '../support/interaction';
import { FakeSlack } from '../support/slack';

const clock = fixedClock('2026-10-31T20:00:00Z');
const worker = createWorker(() => false, clock, 'class-start');
const config = () => ({
  ...env,
  SLACK_SIGNING_SECRET: commandSecret,
  CALENDAR_SIGNING_KEY: calendarSecret,
  PUBLIC_ORIGIN: 'https://snacks.invalid',
  SLACK_BOT_TOKEN: 'fixture-token',
  SLACK_BOT_WORKSPACE_ID: 'T_FIXTURE',
});
interface Action {
  action_id: string;
  value: string;
  options?: { value: string }[];
}
interface Message {
  text: string;
  blocks: { accessory?: Action; elements?: Action[] }[];
}
const command = async (
  text: string,
  user_id = 'U_FIXTURE',
  trigger_id: string = crypto.randomUUID(),
) => {
  const response = await worker.fetch(
    new Request('https://snacks.invalid/slack/commands', {
      method: 'POST',
      ...signedCommand({ text, user_id, trigger_id }),
    }),
    config(),
  );
  return response.json<Message>();
};
const interact = (
  action: Record<string, unknown>,
  tasks: Promise<unknown>[],
  overrides: Record<string, unknown> = {},
) =>
  worker.fetch(
    new Request('https://snacks.invalid/slack/interactions', {
      method: 'POST',
      ...signedInteraction(action, overrides),
    }),
    config(),
    { waitUntil: (p) => tasks.push(p) },
  );

it('slash commands list effective availability, only your assignments, atomically move, cancel, and replay a cancellation', async () => {
  expect((await command('list')).text).toContain(
    '2026-11-01 — Volunteer needed',
  );
  await command('signup 2026-11-01');
  await command('signup 2026-11-08', 'U_OTHER');
  const mine = await command('mine');
  expect(mine.text).toContain('2026-11-01 —');
  expect(mine.text).not.toContain('2026-11-08 —');
  expect((await command('cancel 2026-11-01', 'U_OTHER')).text).toContain(
    'only cancel or change your own',
  );
  expect((await command('change 2026-11-01 2026-11-08')).text).toContain(
    'existing signups are unchanged',
  );
  expect((await command('change 2026-11-01 2026-11-15')).text).toContain(
    'Your signup was moved',
  );
  expect((await command('mine')).text).toContain('2026-11-15 —');
  const cancel = await command('cancel 2026-11-15', 'U_FIXTURE', 'cancel-once');
  expect(cancel.text).toContain('was cancelled');
  expect(
    await command('cancel 2026-11-15', 'U_FIXTURE', 'cancel-once'),
  ).toEqual(cancel);
  expect((await command('mine')).text).toContain('No signups on this page');
  expect((await command('mine', 'U_OTHER')).text).toContain('2026-11-08 —');
});

it('guided signup, move, and cancellation use signed actions and one durable private confirmation per exact retry', async () => {
  const slack = new FakeSlack();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    const list = await command('list');
    const button = list.blocks.find((b) => b.accessory)!.accessory!;
    const signupAction = { action_id: button.action_id, value: button.value };
    const tasks: Promise<unknown>[] = [];
    slack.enqueue(Response.json({ ok: true }));
    const ack = await interact(signupAction, tasks);
    expect(ack.status).toBe(200);
    expect(await ack.text()).toBe('');
    await Promise.all(tasks);
    expect((await interact(signupAction, tasks)).status).toBe(200);
    await Promise.all(tasks);
    expect(slack.requests).toHaveLength(1);
    expect(slack.requests[0]?.body).toContain('Download your calendar event');
    const mine = await command('mine');
    const elements = mine.blocks.flatMap((b) => b.elements ?? []);
    const move = elements.find((e) => e.action_id === 'snack_change')!;
    const oldCancel = elements.find((e) => e.action_id === 'snack_cancel')!;
    slack.enqueue(Response.json({ ok: true }));
    expect(
      (
        await interact(
          {
            action_id: move.action_id,
            selected_option: move.options![0],
            action_ts: '1793476800.002',
          },
          tasks,
        )
      ).status,
    ).toBe(200);
    await Promise.all(tasks);
    expect((await command('mine')).text).toContain('2026-11-08 —');
    // A stale cancellation of the original commitment must not cancel the move.
    slack.enqueue(Response.json({ ok: true }));
    await interact(
      {
        action_id: oldCancel.action_id,
        value: oldCancel.value,
        action_ts: '1793476800.003',
      },
      tasks,
    );
    await Promise.all(tasks);
    expect((await command('mine')).text).toContain('2026-11-08 —');
    const current = (await command('mine')).blocks
      .flatMap((b) => b.elements ?? [])
      .find((e) => e.action_id === 'snack_cancel')!;
    slack.enqueue(Response.json({ ok: true }));
    await interact(
      {
        action_id: current.action_id,
        value: current.value,
        action_ts: '1793476800.004',
      },
      tasks,
    );
    await Promise.all(tasks);
    expect((await command('mine')).text).toContain('No signups');
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n'),
    ).toBe(4);
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('acknowledges interactions without waiting for a slow outbound Slack API', async () => {
  const button = (await command('list')).blocks.find(
    (b) => b.accessory,
  )!.accessory!;
  const tasks: Promise<unknown>[] = [];
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (release = resolve));
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', () => pending);
  try {
    const ack = await interact(
      { action_id: button.action_id, value: button.value },
      tasks,
    );
    expect(ack.status).toBe(200);
    expect(
      await env.DB.prepare('SELECT status FROM classes').first('status'),
    ).toBe('ASSIGNED');
  } finally {
    release(Response.json({ ok: true }));
    await Promise.all(tasks);
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('does not accept forged signatures, malformed actions, wrong groups, workspaces or channels', async () => {
  const button = (await command('list')).blocks.find(
    (b) => b.accessory,
  )!.accessory!;
  const action = { action_id: button.action_id, value: button.value };
  for (const overrides of [
    { team: { id: 'T_OTHER' } },
    { channel: { id: 'C_OTHER' } },
    { channel: { id: 'D_FIXTURE' } },
  ]) {
    expect((await interact(action, [], overrides)).status).toBe(403);
  }
  expect(
    (
      await interact(
        {
          ...action,
          value: JSON.stringify({
            groupId: 'another-group',
            localDate: '2026-11-01',
          }),
        },
        [],
      )
    ).status,
  ).toBe(403);
  expect((await interact({ ...action, value: 'not-json' }, [])).status).toBe(
    400,
  );
  const signed = signedInteraction(action);
  expect(
    (
      await worker.fetch(
        new Request('https://snacks.invalid/slack/interactions', {
          method: 'POST',
          ...signed,
          body: signed.body + 'tampered',
        }),
        config(),
        { waitUntil: () => {} },
      )
    ).status,
  ).toBe(401);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
  ).toBe(0);
});

it('paginates own commitments without imposing a signup horizon', async () => {
  for (const date of [
    '2026-11-01',
    '2026-11-08',
    '2026-11-15',
    '2026-11-22',
    '2026-11-29',
    '2026-12-06',
    '2026-12-13',
    '2026-12-20',
    '2027-01-03',
  ])
    await command(`signup ${date}`);
  expect((await command('mine')).text).toContain('/snack mine 2');
  expect((await command('mine 2')).text).toContain('2027-01-03 —');
});
