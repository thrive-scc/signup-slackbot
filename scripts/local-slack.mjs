import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URLSearchParams } from 'node:url';

export async function localCommand(text) {
  if (!process.env.SLACK_SIGNING_SECRET)
    throw new Error('Configure .dev.vars first (npm run setup:demo).');
  const fixture = JSON.parse(
    await readFile('tests/fixtures/slack/command.json', 'utf8'),
  );
  const body = new URLSearchParams({
    ...fixture,
    text,
    trigger_id: 'demo-' + randomUUID(),
  }).toString();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');
  // Loopback only. No real Slack calls or deployed application writes.
  const response = await globalThis.fetch(
    'http://127.0.0.1:8787/slack/commands',
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': String(timestamp),
        'X-Slack-Signature': 'v0=' + signature,
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `Local Worker returned HTTP ${response.status}. Check .dev.vars and restart after editing it.`,
    );
  return (await response.json()).text;
}
