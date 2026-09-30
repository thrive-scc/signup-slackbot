import { createHmac } from 'node:crypto';
import { commandSecret } from './command';

export function signedInteraction(
  action: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const timestamp = String(
    Math.floor(Date.parse('2026-10-31T20:00:00Z') / 1000),
  );
  const payload = {
    type: 'block_actions',
    team: { id: 'T_FIXTURE' },
    channel: { id: 'C_FIXTURE' },
    user: { id: 'U_FIXTURE' },
    actions: [{ action_ts: '1793476800.001', ...action }],
    ...overrides,
  };
  const body = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  return {
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature':
        'v0=' +
        createHmac('sha256', commandSecret)
          .update(`v0:${timestamp}:${body}`)
          .digest('hex'),
    },
  };
}
