export type SlackFetch = (request: Request) => Promise<Response>;
export interface SendResult {
  ok: boolean;
  retryable: boolean;
  error?: string;
  retryAfter?: number;
}

export function slackResponseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'hooks.slack.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/(actions|services)\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Used only while handling the signed interaction. Never persist the bearer URL.
export async function replaceSlackMessage(
  responseUrl: string,
  body: Record<string, unknown>,
  send: SlackFetch = (request) => fetch(request),
): Promise<SendResult> {
  const url = slackResponseUrl(responseUrl);
  if (!url)
    return { ok: false, retryable: false, error: 'INVALID_RESPONSE_URL' };
  try {
    const response = await send(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          replace_original: true,
          response_type: 'ephemeral',
        }),
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
        error: 'SOURCE_UPDATE_REJECTED',
      };
    const text = (await response.text()).trim();
    if (text === 'ok' || text === '') return { ok: true, retryable: false };
    const result = JSON.parse(text) as { ok?: boolean };
    return result.ok === true
      ? { ok: true, retryable: false }
      : { ok: false, retryable: false, error: 'SOURCE_UPDATE_REJECTED' };
  } catch {
    return { ok: false, retryable: true, error: 'NETWORK_OR_RESPONSE_ERROR' };
  }
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
