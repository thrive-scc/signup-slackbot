import type { Clock } from '../../domain/clock';
import { verify } from '../signatures';

export async function verifySlackRequest(
  request: Request,
  rawBody: string,
  secret: string,
  clock: Clock,
) {
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
  const signature = request.headers.get('x-slack-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || !signature.startsWith('v0=')) return false;
  if (Math.abs(clock.now().getTime() / 1000 - Number(timestamp)) > 300)
    return false;
  return verify(secret, `v0:${timestamp}:${rawBody}`, signature.slice(3));
}
