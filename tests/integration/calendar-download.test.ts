import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import ICAL from 'ical.js';
import { createWorker } from '../../worker/http';
import { signupStore } from '../../worker/adapters/d1/signups';
import { calendarLink } from '../../worker/adapters/calendar-download';
import { fixedClock } from '../support/clock';

const clock = fixedClock('2026-10-31T20:00:00Z');
const worker = createWorker(() => false, clock);
const secret = 'calendar-fixture-not-a-real-secret';
const id = '00000000-0000-4000-8000-000000000001';
async function assignment() {
  await signupStore(env.DB).claim({
    groupId: 'thrive-fixture',
    localDate: '2026-11-01',
    actorUserId: 'U_FIXTURE',
    requestId: 'calendar-request',
    assignmentId: id,
    now: clock.now().toISOString(),
    startsAt: '2026-11-01T15:30:00.000Z',
    endsAt: '2026-11-01T17:45:00.000Z',
  });
}
async function download(url: string) {
  return worker.fetch(new Request(url), {
    ...env,
    CALENDAR_SIGNING_KEY: secret,
  });
}

it('serves a repeatable signed calendar outside admin auth and records requests without identifying the visitor', async () => {
  await assignment();
  const url = await calendarLink('https://snacks.invalid', secret, id);
  const response = await download(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/calendar');
  expect(response.headers.get('Content-Disposition')).toContain('attachment');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const text = await response.text();
  const event = new ICAL.Event(
    new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent')!,
  );
  expect(event.startDate.toJSDate().toISOString()).toBe(
    '2026-11-01T15:30:00.000Z',
  );
  expect(await (await download(url)).text()).toBe(text);
  const logs = (
    await env.DB.prepare(
      "SELECT * FROM activity WHERE kind='CALENDAR_DOWNLOAD'",
    ).all()
  ).results;
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    outcome: 'SERVED',
    life_group_id: 'thrive-fixture',
    local_date: '2026-11-01',
    assignment_id: id,
    actor_user_id: null,
  });
  expect(JSON.stringify(logs)).not.toContain('signature');
  expect(JSON.stringify(logs)).not.toContain(secret);
});

it('rejects forged links and links for assignments that no longer exist', async () => {
  await assignment();
  const url = await calendarLink('https://snacks.invalid', secret, id);
  expect((await download(url + 'bad')).status).toBe(404);
  await env.DB.prepare('DELETE FROM classes').run();
  expect((await download(url)).status).toBe(404);
  expect(
    (
      await env.DB.prepare(
        "SELECT outcome FROM activity WHERE kind='CALENDAR_DOWNLOAD' ORDER BY id",
      ).all()
    ).results,
  ).toEqual([{ outcome: 'INVALID_LINK' }, { outcome: 'NOT_FOUND' }]);
});

it('fails closed when the calendar secret is missing', async () => {
  expect(
    (
      await worker.fetch(
        new Request(`https://snacks.invalid/calendar/${id}.ics`),
        env,
      )
    ).status,
  ).toBe(503);
});
