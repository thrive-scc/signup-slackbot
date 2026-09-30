import type { Clock } from './domain/clock';
import type { SnackEnv } from './env';
import { readOperation } from './adapters/d1/lifecycle';
import { signupStore } from './adapters/d1/signups';
import {
  escapeSlack,
  operationMessage,
} from './adapters/slack/messages';
import {
  sendSlack,
  type SlackFetch,
  type SendResult,
} from './adapters/slack/api';

interface Delivery {
  id: number;
  groupId: string;
  requestId: string;
  kind: 'INTERACTION_REPLY' | 'CANCELLATION_NOTICE';
  channelId: string | null;
  attempts: number;
  expiresAt: string;
}
const columns = `id, life_group_id AS groupId, request_id AS requestId,
  kind, channel_id AS channelId, attempts, expires_at AS expiresAt`;

/** One short bounded pass; cron recovers pending work and expired leases. */
export async function deliverPending(
  env: SnackEnv,
  clock: Clock,
  send?: SlackFetch,
) {
  const db = env.DB;
  const now = clock.now().toISOString();
  await db
    .prepare(
      `UPDATE deliveries SET status='FAILED', last_error='EXPIRED_OR_EXHAUSTED', lease_id=NULL, lease_until=NULL
    WHERE (status='PENDING' OR (status='SENDING' AND lease_until <= ?)) AND (expires_at <= ? OR attempts >= 5)`,
    )
    .bind(now, now)
    .run();
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_BOT_WORKSPACE_ID) {
    await db
      .prepare(
        "UPDATE deliveries SET last_error='SLACK_NOT_CONFIGURED' WHERE status='PENDING'",
      )
      .run();
    return;
  }
  for (let i = 0; i < 4; i++) {
    const instant = clock.now();
    const leaseId = crypto.randomUUID();
    const job = await db
      .prepare(
        `UPDATE deliveries SET status='SENDING', attempts=attempts+1, lease_id=?, lease_until=?
      WHERE id=(SELECT id FROM deliveries WHERE available_at <= ? AND expires_at > ? AND attempts < 5
        AND (status='PENDING' OR (status='SENDING' AND lease_until <= ?)) ORDER BY id LIMIT 1)
      RETURNING ${columns}`,
      )
      .bind(
        leaseId,
        new Date(instant.getTime() + 60_000).toISOString(),
        instant.toISOString(),
        instant.toISOString(),
        instant.toISOString(),
      )
      .first<Delivery>();
    if (!job) return;
    let result: SendResult;
    try {
      const group = await signupStore(db).getGroup(job.groupId);
      const receipt = await readOperation(db, job.groupId, job.requestId);
      if (
        !group ||
        !receipt ||
        group.workspaceId !== env.SLACK_BOT_WORKSPACE_ID
      ) {
        result = {
          ok: false,
          retryable: false,
          error: 'WORKSPACE_OR_RECEIPT_MISMATCH',
        };
      } else {
        const notice = job.kind === 'CANCELLATION_NOTICE';
        const message = notice
          ? {
              text: `We don't need snack for ${escapeSlack(group.name)} on ${receipt.localDate}.  You're off the hook!  Use \`/snack mine\` in <#${group.channelId}> to see your current commitments.`,
            }
          : await operationMessage(env, group, receipt);
        result = await sendSlack(
          env.SLACK_BOT_TOKEN,
          notice ? 'chat.postMessage' : 'chat.postEphemeral',
          {
            channel: notice ? receipt.previousVolunteerId : job.channelId,
            ...(!notice ? { user: receipt.actorUserId } : {}),
            ...message,
            text: `${message.text}`,
            unfurl_links: false,
            unfurl_media: false,
          },
          send,
        );
      }
    } catch {
      result = {
        ok: false,
        retryable: true,
        error: 'DELIVERY_PREPARATION_FAILED',
      };
    }
    const completed = clock.now();
    const next = new Date(
      completed.getTime() +
        Math.max(result.retryAfter ?? 0, 30 * 2 ** (job.attempts - 1)) * 1000,
    ).toISOString();
    const status = result.ok
      ? 'SENT'
      : result.retryable && job.attempts < 5 && next < job.expiresAt
        ? 'PENDING'
        : 'FAILED';
    await db
      .prepare(
        `UPDATE deliveries SET status=?, available_at=?, last_error=?, lease_id=NULL, lease_until=NULL
      WHERE id=? AND status='SENDING' AND lease_id=?`,
      )
      .bind(status, next, result.error ?? null, job.id, leaseId)
      .run();
    // A workspace rate limit should also stop this pass instead of hammering Slack.
    if (result.retryAfter) {
      await db
        .prepare(
          `UPDATE deliveries SET available_at=max(available_at, ?)
        WHERE status='PENDING' AND life_group_id IN (SELECT id FROM life_groups WHERE slack_workspace_id=?)`,
        )
        .bind(next, env.SLACK_BOT_WORKSPACE_ID)
        .run();
      return;
    }
  }
}
