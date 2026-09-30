import type { Clock } from '../../domain/clock';
import { verifySlackRequest } from './verify-request';

/** Share byte-preserving verification between slash commands and Block Kit actions. */
export async function readSlackRequest(
  request: Request,
  secret: string,
  clock: Clock,
): Promise<string | Response> {
  if (request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/x-www-form-urlencoded'
  )
    return new Response('Expected a form-encoded Slack request.', {
      status: 415,
    });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 65_536)
    return new Response('Request too large', { status: 413 });
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return new Response('Invalid UTF-8 payload.', { status: 400 });
  }
  if (!(await verifySlackRequest(request, raw, secret, clock)))
    return new Response('Invalid Slack signature or timestamp.', {
      status: 401,
    });
  return raw;
}
export function slackId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value);
}
