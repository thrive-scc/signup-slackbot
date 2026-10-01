import { expect, test } from '@playwright/test';
import ICAL from 'ical.js';
import { signedCommand } from '../support/command';

test('signed signup produces a downloadable calendar and appears in the built admin UI', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('No upcoming snack assignments.')).toBeVisible();
  const payload = signedCommand({ user_id: 'U_BROWSER_FIXTURE' });
  const started = performance.now();
  const signup = await request.post('/slack/commands', {
    data: payload.body,
    headers: payload.headers,
  });
  expect(performance.now() - started).toBeLessThan(3000);
  expect(signup.status()).toBe(200);
  const confirmation = await signup.json();
  expect(confirmation.response_type).toBe('ephemeral');
  expect(confirmation.text).toContain('Thrive (sample) on Nov 1!');
  expect(confirmation.text).not.toMatch(/9:30|Manage signup changes|\/snack\b/);
  const link = /<(http:\/\/127.0.0.1:8788\/calendar\/[^|]+)\|/.exec(
    confirmation.text,
  )?.[1];
  expect(link).toBeTruthy();
  await page.evaluate((url) => {
    const anchor = document.createElement('a');
    anchor.href = url!;
    anchor.textContent = 'Download confirmed commitment';
    document.body.appendChild(anchor);
  }, link);
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('link', { name: 'Download confirmed commitment' })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('snacks-2026-11-01.ics');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const event = new ICAL.Event(
    new ICAL.Component(
      ICAL.parse(Buffer.concat(chunks).toString('utf8')),
    ).getFirstSubcomponent('vevent')!,
  );
  expect(event.startDate.toJSDate().toISOString()).toBe(
    '2026-11-01T15:30:00.000Z',
  );
  expect(event.endDate.toJSDate().toISOString()).toBe(
    '2026-11-01T17:45:00.000Z',
  );
  await page
    .getByRole('link', { name: 'Download confirmed commitment' })
    .evaluate((element) => element.remove());
  const refresh = page.waitForResponse('/api/admin/groups');
  await page.getByRole('button', { name: 'Refresh' }).click();
  expect((await refresh).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Thrive (sample)' }),
  ).toBeVisible();
  await expect(page.getByText('Sunday · 09:30–11:45')).toBeVisible();
  await expect(page.getByText('America/Chicago')).toBeVisible();
  await expect(page.getByText('2026-11-01')).toBeVisible();
  await expect(page.getByText('Assigned', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'U_BROWSER_FIXTURE' }),
  ).toHaveAttribute('href', 'slack://user?team=T_FIXTURE&id=U_BROWSER_FIXTURE');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/admin-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: 'test-results/admin-desktop.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('shows a recoverable failure when the API is unavailable', async ({
  page,
}) => {
  await page.route('**/api/admin/groups', (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(
    'Unable to load life groups',
  );
  await page.unroute('**/api/admin/groups');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Thrive (sample)' }),
  ).toBeVisible();
});

test('admin cancels an assignment with NO_SNACK, recovers a lost response, then reopens without restoring it', async ({
  page,
  request,
}) => {
  const payload = signedCommand({
    text: 'signup 2026-11-08',
    user_id: 'U_CANCEL_FIXTURE',
    trigger_id: 'browser-admin-cancel',
  });
  const signup = await request.post('/slack/commands', {
    data: payload.body,
    headers: payload.headers,
  });
  const link = /<(http:[^|]+)\|/.exec((await signup.json()).text)![1]!;
  await page.goto('/');
  const row = page.getByRole('listitem', { name: 'Class 2026-11-08' });
  await expect(row.getByText('Assigned', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark no snack for 2026-11-08' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Confirm class change' }),
  ).toContainText('cancels U_CANCEL_FIXTURE');
  await expect(
    page.getByRole('button', { name: 'Confirm change' }),
  ).toBeFocused();
  // Real server commit followed by a dropped response, not a mocked mutation.
  await page.route('**/api/admin/classes', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(
    page.getByRole('status', { name: 'Class update' }),
  ).toContainText('could not confirm');
  await page.unroute('**/api/admin/classes');
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(
    page.getByRole('status', { name: 'Class update' }),
  ).toContainText('cancellation notice is queued');
  await expect(row.getByText('No snack needed', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'U_CANCEL_FIXTURE' })).toHaveCount(
    0,
  );
  expect((await request.get(link)).status()).toBe(404);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/lifecycle-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: 'test-results/lifecycle-desktop.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Open signup for 2026-11-08' })
    .click();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(row.getByText('Open', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'U_CANCEL_FIXTURE' })).toHaveCount(
    0,
  );
});

test('a stale admin page cannot cancel a volunteer who signed up after it loaded', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark no snack for 2026-11-15' })
    .click();
  const payload = signedCommand({
    text: 'signup 2026-11-15',
    user_id: 'U_RACE_FIXTURE',
    trigger_id: 'browser-stale-page',
  });
  expect(
    (
      await request.post('/slack/commands', {
        data: payload.body,
        headers: payload.headers,
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(
    page.getByRole('status', { name: 'Class update' }),
  ).toContainText('class changed while you were viewing');
  await expect(
    page
      .getByRole('listitem', { name: 'Class 2026-11-15' })
      .getByRole('link', { name: 'U_RACE_FIXTURE' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'View activity and messages' })
    .click();
  const rejected = page
    .getByRole('list', { name: 'Bot activity' })
    .getByRole('listitem')
    .filter({ hasText: 'Mark no snack' })
    .filter({ hasText: '2026-11-15' });
  await expect(rejected).toContainText('Class had changed');
  await expect(rejected).toContainText('Volunteer at request U_RACE_FIXTURE');
  await expect(rejected).not.toContainText('Previous volunteer');
});

test('shows the empty state without manufacturing configuration', async ({
  page,
}) => {
  await page.route('**/api/admin/groups', (route) =>
    route.fulfill({ json: { groups: [], checkedAt: '2026-09-10T20:00:00Z' } }),
  );
  await page.goto('/');
  await expect(page.getByText('No life groups configured.')).toBeVisible();
});

test('deployable Worker denies admin pages, API, and static assets', async ({
  request,
}) => {
  for (const path of [
    '/',
    '/index.html',
    '/api/admin/groups',
    '/api/admin/operations?groupId=thrive-fixture',
  ]) {
    const response = await request.get('http://127.0.0.1:8789' + path);
    expect(response.status()).toBe(503);
    expect(await response.text()).toBe('Admin access is not configured.');
  }
});

test('admin can inspect real signup, calendar and cancellation history with pending messages on mobile and desktop', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const payload = signedCommand({
    text: 'signup 2026-11-29',
    user_id: 'U_HISTORY_FIXTURE',
    trigger_id: 'browser-history-signup',
  });
  const signup = await request.post('/slack/commands', {
    data: payload.body,
    headers: payload.headers,
  });
  expect(signup.status()).toBe(200);
  const link = /<(http:[^|]+)\|/.exec((await signup.json()).text)![1]!;
  expect((await request.get(link)).status()).toBe(200);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark no snack for 2026-11-29' })
    .click();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(
    page.getByRole('status', { name: 'Class update' }),
  ).toContainText('cancellation notice is queued');
  const opened = page.waitForResponse((response) =>
    response.url().includes('/api/admin/operations?'),
  );
  await page
    .getByRole('button', { name: 'View activity and messages' })
    .click();
  expect((await opened).status()).toBe(200);
  const panel = page.getByRole('region', {
    name: 'Activity and messages for Thrive (sample)',
  });
  const activity = panel.getByRole('list', { name: 'Bot activity' });
  const download = activity
    .getByRole('listitem')
    .filter({ hasText: 'Calendar download request' })
    .filter({ hasText: '2026-11-29' });
  await expect(download).toContainText('Download served');
  await expect(download).toContainText('Requester unknown (calendar link)');
  await expect(download).toContainText('does not confirm calendar import');
  const cancellation = activity
    .getByRole('listitem')
    .filter({ hasText: 'Mark no snack' })
    .filter({ hasText: '2026-11-29' });
  await expect(cancellation).toContainText('By admin:browser-fixture');
  await expect(cancellation).toContainText(
    'Previous volunteer U_HISTORY_FIXTURE',
  );
  await expect(
    cancellation.getByRole('link', { name: 'U_HISTORY_FIXTURE' }),
  ).toHaveAttribute('href', 'slack://user?team=T_FIXTURE&id=U_HISTORY_FIXTURE');
  const notice = panel
    .getByRole('list', { name: 'Message deliveries' })
    .getByRole('listitem')
    .filter({ hasText: 'Cancellation notice' })
    .filter({ hasText: '2026-11-29' });
  await expect(notice).toContainText('Pending');
  await expect(notice).toContainText('To U_HISTORY_FIXTURE');
  await expect(notice).toContainText('0 attempts');
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/admin/operations' &&
      url.searchParams.get('messages') === 'all'
    );
  });
  await panel.getByLabel('Messages to show').selectOption('all');
  expect((await filtered).status()).toBe(200);
  await expect(
    panel.getByRole('button', { name: 'Refresh activity' }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: 'test-results/operations-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await panel.screenshot({ path: 'test-results/operations-desktop.png' });
  await page
    .getByRole('button', { name: 'Hide activity and messages' })
    .click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('activity API failure is visible and retry loads the actual history', async ({
  page,
}) => {
  await page.route('**/api/admin/operations?*', (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'View activity and messages' })
    .click();
  const panel = page.getByRole('region', {
    name: 'Activity and messages for Thrive (sample)',
  });
  await expect(panel.getByRole('alert')).toContainText(
    'Unable to load activity and messages',
  );
  await expect(panel.getByText('No bot activity recorded.')).toHaveCount(0);
  await page.unroute('**/api/admin/operations?*');
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByRole('list', { name: 'Bot activity' })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('local scheduled entry executes and unknown URLs remain 404', async ({
  request,
}) => {
  expect((await request.get('/__scheduled?time=1789070400000')).status()).toBe(
    200,
  );
  expect((await request.get('/api/unknown')).status()).toBe(404);
  expect((await request.get('/missing-page')).status()).toBe(404);
});

test('Vite preview allows same-origin admin changes and rejects cross-origin writes', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:5174');
  const row = page.getByRole('listitem', { name: 'Class 2026-11-22' });
  await expect(row.getByText('Open', { exact: true })).toBeVisible();
  await row
    .getByRole('button', { name: 'Mark no snack for 2026-11-22' })
    .click();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(row.getByText('No snack needed', { exact: true })).toBeVisible();
  for (const origin of [
    'https://attacker.invalid',
    'http://127.0.0.1:8788',
    'null',
  ]) {
    const response = await request.post(
      'http://127.0.0.1:5174/api/admin/classes',
      {
        headers: { Origin: origin },
        data: {
          groupId: 'thrive-fixture',
          localDate: '2026-11-22',
          operation: 'OPEN',
          expectedStatus: 'NO_SNACK',
          requestId: crypto.randomUUID(),
        },
      },
    );
    expect(response.status()).toBe(403);
  }
  await row.getByRole('button', { name: 'Open signup for 2026-11-22' }).click();
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(row.getByText('Open', { exact: true })).toBeVisible();
});
