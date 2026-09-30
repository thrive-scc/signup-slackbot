export type SlackFetch = (request: Request) => Promise<Response>;
export interface SendResult {
  ok: boolean;
  retryable: boolean;
  error?: string;
  retryAfter?: number;
}

export async function sendSlack(
  token: string,
  method: 'chat.postEphemeral' | 'chat.postMessage',
  body: Record<string, unknown>,
  send: SlackFetch = (request) => fetch(request),
): Promise<SendResult> {
  try {
    const response = await send(
      new Request(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      }),
    );
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      return {
        ok: false,
        retryable: true,
        error: 'RATE_LIMITED',
        retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
      };
    }
    if (!response.ok)
      return {
        ok: false,
        retryable: response.status >= 500,
        error:
          response.status >= 500 ? 'SLACK_UNAVAILABLE' : 'SLACK_HTTP_REJECTED',
      };
    const result = await response.json<{ ok?: boolean; error?: string }>();
    if (result.ok === true) return { ok: true, retryable: false };
    const retryable = [
      'ratelimited',
      'internal_error',
      'service_unavailable',
      'request_timeout',
    ].includes(result.error ?? '');
    return {
      ok: false,
      retryable,
      error: retryable ? 'SLACK_TEMPORARY_ERROR' : 'SLACK_REJECTED',
      ...(result.error === 'ratelimited' ? { retryAfter: 60 } : {}),
    };
  } catch {
    // Do not retain bodies, headers, URLs, or raw exception messages.
    return { ok: false, retryable: true, error: 'NETWORK_OR_RESPONSE_ERROR' };
  }
}
