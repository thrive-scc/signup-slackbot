import { expect, it } from 'vitest';
import command from '../fixtures/slack/command.json';
import { FakeSlack } from '../support/slack';

it('keeps fixture traffic local while representing success, rate limits, and timeout', async () => {
  const slack = new FakeSlack();
  slack.enqueue(Response.json({ ok: true, ts: 'fixture.001' }));
  slack.enqueue(
    new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
  );
  slack.enqueue(new Error('simulated timeout'));
  const request = new Request(command.response_url, {
    method: 'POST',
    body: 'fixture',
  });
  expect(await (await slack.fetch(request)).json()).toEqual({
    ok: true,
    ts: 'fixture.001',
  });
  const limited = await slack.fetch(request);
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('30');
  await expect(slack.fetch(request)).rejects.toThrow('simulated timeout');
  expect(slack.requests).toHaveLength(3);
});
