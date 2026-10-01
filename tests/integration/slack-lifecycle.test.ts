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
import { deliverPending } from '../../worker/delivery';
import { signupForClass } from '../../worker/application/signup-for-class';
import { signupStore } from '../../worker/adapters/d1/signups';

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
  blocks: { type: string; accessory?: Action; elements?: Action[] }[];
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
const sourceUrl =
  'https://hooks.slack.com/actions/T_FIXTURE/reply/fixture-response-token';
const privateSource = {
  container: { is_ephemeral: true },
  response_url: sourceUrl,
};

it('updates the clicked signup before older pending replies can consume the delivery pass', async () => {
  for (const date of ['2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']) {
    await signupForClass(
      {
        groupId: 'thrive-fixture',
        workspaceId: 'T_FIXTURE',
        actorUserId: 'U_OTHER',
        localDate: date,
        requestId: `older:${date}`,
        replyChannelId: 'C_FIXTURE',
      },
      signupStore(env.DB),
      clock,
      () => crypto.randomUUID(),
    );
  }
  const button = (await command('list')).blocks.find(
    (b) => b.accessory,
  )!.accessory!;
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    slack.enqueue(new Response('ok'));
    for (let i = 0; i < 3; i++) slack.enqueue(Response.json({ ok: true }));
    await interact(
      { action_id: button.action_id, value: button.value },
      tasks,
      privateSource,
    );
    await Promise.all(tasks);
    expect(slack.requests).toHaveLength(4);
    expect(slack.requests[0]!.url).toBe(sourceUrl);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM deliveries WHERE status='PENDING'",
      ).first('n'),
    ).toBe(1);
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('replaces the private signup list with confirmation, without storing its response URL or replying again on retry', async () => {
  const button = (await command('list')).blocks.find(
    (b) => b.accessory,
  )!.accessory!;
  const action = { action_id: button.action_id, value: button.value };
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    slack.enqueue(new Response('ok'));
    const ack = await interact(action, tasks, privateSource);
    expect(ack.status).toBe(200);
    expect(await ack.text()).toBe('');
    await Promise.all(tasks);
    expect(slack.requests).toHaveLength(1);
    expect(slack.requests[0]!.url).toBe(sourceUrl);
    const message = JSON.parse(slack.requests[0]!.body);
    expect(message).toMatchObject({
      replace_original: true,
      response_type: 'ephemeral',
    });
    expect(message.text).toContain('Thrive (sample) on Nov 1!');
    expect(message.text).toContain('Add to your calendar');
    expect(message.text).not.toMatch(
      /9:30|11:45|America\/Chicago|2026-11-01|Manage signup changes|already-imported|\/snack\b/,
    );
    expect(
      message.blocks.some((block: Record<string, unknown>) => block.accessory),
    ).toBe(false);
    expect(
      await env.DB.prepare('SELECT status FROM deliveries').first('status'),
    ).toBe('SENT');
    await interact(action, tasks, privateSource);
    await Promise.all(tasks);
    expect(slack.requests).toHaveLength(1);
    for (const table of [
      'classes',
      'operation_receipts',
      'activity',
      'deliveries',
    ]) {
      const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(rows)).not.toMatch(
        /hooks\.slack\.com|fixture-response-token/,
      );
    }
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it.each([
  [new Error('fixture timeout'), 'NETWORK_OR_RESPONSE_ERROR', 30],
  [
    new Response('limited', { status: 429, headers: { 'Retry-After': '120' } }),
    'RATE_LIMITED',
    120,
  ],
] as const)(
  'keeps a committed signup recoverable when its source update fails (%s)',
  async (failure, category, delay) => {
    const button = (await command('list')).blocks.find(
      (b) => b.accessory,
    )!.accessory!;
    const tasks: Promise<unknown>[] = [];
    const slack = new FakeSlack();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', slack.fetch);
    try {
      slack.enqueue(failure);
      await interact(
        { action_id: button.action_id, value: button.value },
        tasks,
        privateSource,
      );
      await Promise.all(tasks);
      expect(
        await env.DB.prepare('SELECT status FROM classes').first('status'),
      ).toBe('ASSIGNED');
      expect(
        await env.DB.prepare(
          'SELECT status, last_error FROM deliveries',
        ).first(),
      ).toMatchObject({ status: 'PENDING', last_error: category });
      await deliverPending(
        config(),
        fixedClock('2026-10-31T20:00:01Z'),
        slack.fetch,
      );
      expect(slack.requests).toHaveLength(1);
      slack.enqueue(Response.json({ ok: true }));
      await deliverPending(
        config(),
        fixedClock(
          new Date(
            Date.parse('2026-10-31T20:00:00Z') + delay * 1000,
          ).toISOString(),
        ),
        slack.fetch,
      );
      expect(slack.requests).toHaveLength(2);
      expect(slack.requests[1]!.url).toBe(
        'https://slack.com/api/chat.postEphemeral',
      );
      expect(
        await env.DB.prepare('SELECT status FROM deliveries').first('status'),
      ).toBe('SENT');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  },
);

it('falls back to a private reply when Slack explicitly rejects a source update', async () => {
  const button = (await command('list')).blocks.find(
    (b) => b.accessory,
  )!.accessory!;
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    slack.enqueue(new Response('expired', { status: 400 }));
    slack.enqueue(Response.json({ ok: true }));
    await interact(
      { action_id: button.action_id, value: button.value },
      tasks,
      privateSource,
    );
    await Promise.all(tasks);
    expect(slack.requests.map((r) => r.url)).toEqual([
      sourceUrl,
      'https://slack.com/api/chat.postEphemeral',
    ]);
    expect(
      await env.DB.prepare('SELECT status FROM deliveries').first('status'),
    ).toBe('SENT');
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it.each([
  { container: { is_ephemeral: false }, response_url: sourceUrl },
  {
    container: { is_ephemeral: true },
    response_url: 'https://example.invalid/actions/T/reply/token',
  },
  {
    container: { is_ephemeral: true },
    response_url:
      'https://hooks.slack.com.example.invalid/actions/T/reply/token',
  },
  {
    container: { is_ephemeral: true },
    response_url: sourceUrl + '?token=extra',
  },
])(
  'does not replace a public message or send credentials to an unsupported response URL (%j)',
  async (overrides) => {
    const button = (await command('list')).blocks.find(
      (b) => b.accessory,
    )!.accessory!;
    const tasks: Promise<unknown>[] = [];
    const slack = new FakeSlack();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', slack.fetch);
    try {
      slack.enqueue(Response.json({ ok: true }));
      await interact(
        { action_id: button.action_id, value: button.value },
        tasks,
        overrides,
      );
      await Promise.all(tasks);
      expect(slack.requests).toHaveLength(1);
      expect(slack.requests[0]!.url).toBe(
        'https://slack.com/api/chat.postEphemeral',
      );
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  },
);

it('shows an invalid signup in the original private message without creating an assignment', async () => {
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    slack.enqueue(new Response('ok'));
    await interact(
      {
        action_id: 'snack_signup',
        value: JSON.stringify({
          groupId: 'thrive-fixture',
          localDate: '2026-10-25',
        }),
      },
      tasks,
      privateSource,
    );
    await Promise.all(tasks);
    expect(slack.requests[0]!.url).toBe(sourceUrl);
    expect(JSON.parse(slack.requests[0]!.body).replace_original).toBe(true);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
    ).toBe(0);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n'),
    ).toBe(0);
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('slash commands list effective availability, only your assignments, atomically move, cancel, and replay a cancellation', async () => {
  const list = await command('');
  expect(list.text).toContain('Nov 1 — Volunteer needed');
  expect(JSON.stringify(list)).not.toMatch(
    /\/snack\b|Classes meet|09:30|11:45|America\/Chicago/,
  );
  expect(await command('list')).toEqual(list);
  expect(await command('help')).toEqual(list);
  await command('signup 2026-11-01');
  await command('signup 2026-11-08', 'U_OTHER');
  const mine = await command('mine');
  expect(mine.text).toContain('Nov 1 —');
  expect(mine.text).not.toContain('Nov 8 —');
  expect(mine.text).toContain('Add to your calendar');
  expect(JSON.stringify(mine)).not.toMatch(
    /\/snack\b|Classes meet|09:30|11:45|America\/Chicago|already-imported|Page 1 of 1/,
  );
  expect(
    mine.blocks
      .filter((b) => b.type === 'actions')
      .flatMap((b) => b.elements ?? [])
      .map((a) => a.action_id),
  ).toEqual(['snack_cancel']);
  expect((await command('cancel 2026-11-01', 'U_OTHER')).text).toContain(
    'only cancel or change your own',
  );
  expect((await command('change 2026-11-01 2026-11-08')).text).toContain(
    'already volunteered',
  );
  expect((await command('mine')).text).toContain('Nov 1 —');
  expect((await command('change 2026-11-01 2026-11-15')).text).toContain(
    'Change complete',
  );
  expect((await command('mine')).text).toContain('Nov 15 —');
  const cancel = await command('cancel 2026-11-15', 'U_FIXTURE', 'cancel-once');
  expect(cancel.text).toContain('was cancelled');
  expect(
    await command('cancel 2026-11-15', 'U_FIXTURE', 'cancel-once'),
  ).toEqual(cancel);
  expect((await command('mine')).text).toContain('No signups on this page');
  expect((await command('mine', 'U_OTHER')).text).toContain('Nov 8 —');
});

it('guided signup and cancellation retain retry protection and reject controls made stale by a date change', async () => {
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
    expect(slack.requests[0]?.body).toContain('Add to your calendar');
    const mine = await command('mine');
    const elements = mine.blocks
      .filter((b) => b.type === 'actions')
      .flatMap((b) => b.elements ?? []);
    const oldCancel = elements.find((e) => e.action_id === 'snack_cancel')!;
    expect(elements.map((a) => a.action_id)).toEqual(['snack_cancel']);
    expect((await command('change 2026-11-01 2026-11-08')).text).toContain(
      'Change complete',
    );
    expect((await command('mine')).text).toContain('Nov 8 —');
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
    expect((await command('mine')).text).toContain('Nov 8 —');
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
    ).toBe(3);
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('acknowledges interactions without waiting for a slow source-message update', async () => {
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
      privateSource,
    );
    expect(ack.status).toBe(200);
    expect(
      await env.DB.prepare('SELECT status FROM classes').first('status'),
    ).toBe('ASSIGNED');
  } finally {
    release(new Response('ok'));
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
  const first = await command('mine');
  expect(first.text).toContain('Page 1 of 2');
  expect(JSON.stringify(first)).not.toMatch(/\/snack\b/);
  expect(
    first.blocks
      .flatMap((b) => b.elements ?? [])
      .find((action) => action.action_id === 'snack_mine_next'),
  ).toBeDefined();
  expect((await command('mine 2')).text).toContain('Jan 3 —');
  const next = first.blocks
    .flatMap((b) => b.elements ?? [])
    .find((action) => action.action_id === 'snack_mine_next')!;
  const tables = ['classes', 'operation_receipts', 'activity', 'deliveries'];
  const before = await Promise.all(
    tables.map(
      async (table) =>
        (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
          .results,
    ),
  );
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const previousFetch = globalThis.fetch;
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal('fetch', async (request: Request) => {
    await slow;
    return slack.fetch(request);
  });
  try {
    slack.enqueue(new Response('ok'));
    const ack = await interact(
      { action_id: next.action_id, value: next.value },
      tasks,
      privateSource,
    );
    expect(ack.status).toBe(200);
    expect(await ack.text()).toBe('');
    expect(slack.requests).toHaveLength(0);
    release();
    await Promise.all(tasks);
    const second = JSON.parse(slack.requests[0]!.body) as Message & {
      replace_original: boolean;
    };
    expect(slack.requests[0]!.url).toBe(sourceUrl);
    expect(second.replace_original).toBe(true);
    expect(second.text).toContain('Jan 3 —');
    expect(second.text).not.toContain('Nov 1 —');
    expect(JSON.stringify(second)).not.toMatch(/\/snack\b/);
    const back = second.blocks
      .flatMap((b) => b.elements ?? [])
      .find((action) => action.action_id === 'snack_mine_previous')!;
    slack.enqueue(new Response('ok'));
    await interact(
      { action_id: back.action_id, value: back.value },
      tasks,
      privateSource,
    );
    await Promise.all(tasks);
    expect(JSON.parse(slack.requests[1]!.body).text).toContain('Nov 1 —');
    slack.enqueue(new Response('ok'));
    await interact(
      { action_id: next.action_id, value: next.value },
      tasks,
      privateSource,
    );
    await Promise.all(tasks);
    expect(JSON.parse(slack.requests[2]!.body).text).toBe(second.text);
    expect(
      await Promise.all(
        tables.map(
          async (table) =>
            (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
              .results,
        ),
      ),
    ).toEqual(before);
  } finally {
    release();
    await Promise.all(tasks);
    vi.stubGlobal('fetch', previousFetch);
  }
});

it('pagination reads the clicking user’s signups and never replaces a public message', async () => {
  await command('signup 2026-11-01');
  await command('signup 2026-11-08', 'U_OTHER');
  const tasks: Promise<unknown>[] = [];
  const slack = new FakeSlack();
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', slack.fetch);
  try {
    slack.enqueue(Response.json({ ok: true }));
    await interact(
      {
        action_id: 'snack_mine_next',
        value: JSON.stringify({
          groupId: 'thrive-fixture',
          page: 1,
          actorUserId: 'U_FIXTURE',
        }),
      },
      tasks,
      {
        ...privateSource,
        container: { is_ephemeral: false },
        user: { id: 'U_OTHER' },
      },
    );
    await Promise.all(tasks);
    expect(slack.requests).toHaveLength(1);
    expect(slack.requests[0]!.url).toBe(
      'https://slack.com/api/chat.postEphemeral',
    );
    const reply = JSON.parse(slack.requests[0]!.body);
    expect(reply).toMatchObject({ channel: 'C_FIXTURE', user: 'U_OTHER' });
    expect(reply.text).toContain('Nov 8 —');
    expect(reply.text).not.toContain('Nov 1 —');
  } finally {
    vi.stubGlobal('fetch', previousFetch);
  }
});

it.each([-1, 1.5, '2', 10000])(
  'rejects malformed pagination (%s) before any work is scheduled',
  async (page) => {
    const tasks: Promise<unknown>[] = [];
    expect(
      (
        await interact(
          {
            action_id: 'snack_mine_next',
            value: JSON.stringify({ groupId: 'thrive-fixture', page }),
          },
          tasks,
        )
      ).status,
    ).toBe(400);
    expect(tasks).toEqual([]);
  },
);

it.each(['life_groups', 'classes'])(
  'signup reads fail clearly without command guidance when %s is unavailable',
  async (table) => {
    await env.DB.prepare(
      `ALTER TABLE ${table} RENAME TO unavailable_${table}`,
    ).run();
    const tasks: Promise<unknown>[] = [];
    const slack = new FakeSlack();
    const previousFetch = globalThis.fetch;
    vi.stubGlobal('fetch', slack.fetch);
    try {
      const mine = await command('mine');
      expect(mine.text).toContain('Your signups are temporarily unavailable');
      expect(mine.text).not.toMatch(/\/snack\b|may have been saved/);
      slack.enqueue(new Response('ok'));
      const ack = await interact(
        {
          action_id: 'snack_mine_next',
          value: JSON.stringify({ groupId: 'thrive-fixture', page: 1 }),
        },
        tasks,
        privateSource,
      );
      expect(ack.status).toBe(200);
      await Promise.all(tasks);
      const reply = JSON.parse(slack.requests[0]!.body);
      expect(reply.text).toContain('Your signups are temporarily unavailable');
      expect(reply.text).not.toMatch(/\/snack\b|may have been saved/);
    } finally {
      vi.stubGlobal('fetch', previousFetch);
      await env.DB.prepare(
        `ALTER TABLE unavailable_${table} RENAME TO ${table}`,
      ).run();
    }
  },
);
