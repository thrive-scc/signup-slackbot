import { createHmac } from 'node:crypto';
import fixture from '../fixtures/slack/command.json' with { type: 'json' };

export const commandSecret = 'fixture-slack-signing-secret';
export const calendarSecret = 'fixture-calendar-signing-secret';
export function signedCommand(
  overrides: Record<string, string> = {},
  timestamp = Math.floor(Date.parse('2026-10-31T20:00:00Z') / 1000),
) {
  const body = new URLSearchParams({
    ...fixture,
    text: 'signup 2026-11-01',
    ...overrides,
  }).toString();
  return {
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature':
        'v0=' +
        createHmac('sha256', commandSecret)
          .update(`v0:${timestamp}:${body}`)
          .digest('hex'),
    },
  };
}
