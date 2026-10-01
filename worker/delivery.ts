import type { Clock } from './domain/clock';
import type { SnackEnv } from './env';
import { readOperation } from './adapters/d1/lifecycle';
import { signupStore, readAssignment } from './adapters/d1/signups';
import { readClasses } from './adapters/d1/classes';
import { classTimes } from './domain/class-time';
import { nextClassDate, reminderTime } from './domain/scheduling';
import type { ScheduledGroup } from './domain/life-group';
import type { ClassOccurrence } from './domain/classes';
import {
  classStartMessage,
  reminderMessage,
} from './adapters/slack/scheduled-messages';
import {
  escapeSlack,
  operationMessage,
  privacy,
  section,
} from './adapters/slack/messages';
import { dateLabel } from './adapters/slack/date-labels';
import {
  sendSlack,
  replaceSlackMessage,
  type SlackFetch,
  type SendResult,
} from './adapters/slack/api';

interface Delivery {
  id: number;
  groupId: string;
  requestId: string | null;
  kind:
    'INTERACTION_REPLY' | 'CANCELLATION_NOTICE' | 'REMINDER' | 'CLASS_START';
  channelId: string | null;
  localDate: string | null;
  assignmentId: string | null;
  scheduledAt: string | null;
  attempts: number;
  expiresAt: string;
}
interface SourceReply {
  groupId: string;
  requestId: string;
  responseUrl: string;
}
const columns = `id, life_group_id AS groupId, request_id AS requestId,
  kind, channel_id AS channelId, local_date AS localDate, assignment_id AS assignmentId,
  scheduled_at AS scheduledAt, attempts, expires_at AS expiresAt`;

type PreparedDelivery =
  | { skip: string }
  | {
      method: 'chat.postMessage' | 'chat.postEphemeral';
      body: Record<string, unknown>;
    };

async function prepareDelivery(
  env: SnackEnv,
  group: ScheduledGroup,
  job: Delivery,
): Promise<PreparedDelivery> {
  if (job.kind === 'REMINDER') {
    const assignment = await readAssignment(env.DB, job.assignmentId!);
    if (
      !assignment ||
      assignment.groupId !== job.groupId ||
      assignment.localDate !== job.localDate
    )
      return { skip: 'STALE_ASSIGNMENT' };
    const times = classTimes(group, assignment.localDate);
    if (
      reminderTime(group, assignment.localDate) !== job.scheduledAt ||
      assignment.startsAt !== times.startsAt ||
      assignment.endsAt !== times.endsAt ||
      assignment.startsAt !== job.expiresAt
    )
      return { skip: 'SCHEDULE_CHANGED' };
    return {
      method: 'chat.postMessage',
      body: {
        channel: assignment.volunteerUserId,
        ...reminderMessage(group, assignment),
      },
    };
  }
  if (job.kind === 'CLASS_START') {
    const date = job.localDate!;
    if (classTimes(group, date).startsAt !== job.scheduledAt)
      return { skip: 'SCHEDULE_CHANGED' };
    const next = nextClassDate(date);
    const rows = await readClasses(env.DB, group.id, date, next);
    const occurrence = (localDate: string): ClassOccurrence =>
      rows.find((c) => c.localDate === localDate) ?? {
        groupId: group.id,
        localDate,
        status: 'OPEN',
        volunteerUserId: null,
        assignmentId: null,
      };
    return {
      method: 'chat.postMessage',
      body: {
        channel: group.channelId,
        ...classStartMessage(group, occurrence(date), occurrence(next)),
      },
    };
  }
  const receipt = await readOperation(env.DB, job.groupId, job.requestId!);
  if (!receipt) throw new Error('Missing delivery receipt');
  const notice = job.kind === 'CANCELLATION_NOTICE';
  const message = notice
    ? {
        text: `We don't need snack for ${escapeSlack(group.name)} on ${dateLabel(receipt.localDate)}.  You're off the hook!  Use \`/snack mine\` in <#${group.channelId}> to see your current commitments.`,
      }
    : await operationMessage(env, group, receipt);
  return {
    method: notice ? 'chat.postMessage' : 'chat.postEphemeral',
    body: {
      channel: notice ? receipt.previousVolunteerId : job.channelId,
      ...(!notice ? { user: receipt.actorUserId } : {}),
      ...message,
    },
  };
}

/** One short bounded pass; cron recovers pending work and expired leases. */
export async function deliverPending(
  env: SnackEnv,
  clock: Clock,
  send?: SlackFetch,
  sourceReply?: SourceReply,
) {
  const db = env.DB;
  const now = clock.now().toISOString();
  await db
    .prepare(
      `UPDATE deliveries SET status='SKIPPED', last_error='STALE_ASSIGNMENT', lease_id=NULL, lease_until=NULL
    WHERE kind='REMINDER' AND (status='PENDING' OR (status='SENDING' AND lease_until <= ?))
      AND NOT EXISTS (SELECT 1 FROM classes c WHERE c.life_group_id=deliveries.life_group_id
        AND c.local_date=deliveries.local_date AND c.assignment_id=deliveries.assignment_id AND c.status='ASSIGNED')`,
    )
    .bind(now)
    .run();
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
    // Preserve Slack's wait deadline even if the limited job expires or is skipped.
    // Newly enqueued jobs must honor it too; one installation is used per deployment.
    const blockedUntil = await db
      .prepare(
        `SELECT max(d.retry_after_until) AS until
      FROM deliveries d JOIN life_groups g ON g.id=d.life_group_id
      WHERE g.slack_workspace_id=?`,
      )
      .bind(env.SLACK_BOT_WORKSPACE_ID)
      .first<string>('until');
    if (blockedUntil && blockedUntil > instant.toISOString()) return;
    const leaseId = crypto.randomUUID();
    const job = await db
      .prepare(
        `UPDATE deliveries SET status='SENDING', attempts=attempts+1, lease_id=?, lease_until=?
      WHERE id=(SELECT id FROM deliveries WHERE available_at <= ? AND expires_at > ? AND attempts < 5
        AND (status='PENDING' OR (status='SENDING' AND lease_until <= ?))
        ORDER BY CASE WHEN life_group_id=? AND request_id=? AND kind='INTERACTION_REPLY' THEN 0 ELSE 1 END, id LIMIT 1)
      RETURNING ${columns}`,
      )
      .bind(
        leaseId,
        new Date(instant.getTime() + 60_000).toISOString(),
        instant.toISOString(),
        instant.toISOString(),
        instant.toISOString(),
        sourceReply?.groupId ?? null,
        sourceReply?.requestId ?? null,
      )
      .first<Delivery>();
    if (!job) return;
    let result: SendResult & { skipped?: boolean };
    try {
      const group = await signupStore(db).getGroup(job.groupId);
      if (!group || group.workspaceId !== env.SLACK_BOT_WORKSPACE_ID) {
        result = {
          ok: false,
          retryable: false,
          error: 'WORKSPACE_OR_RECEIPT_MISMATCH',
        };
      } else {
        const prepared = await prepareDelivery(env, group, job);
        if ('skip' in prepared) {
          result = {
            ok: false,
            retryable: false,
            skipped: true,
            error: prepared.skip,
          };
        } else if (clock.now().toISOString() >= job.expiresAt) {
          result = {
            ok: false,
            retryable: false,
            error: 'EXPIRED_OR_EXHAUSTED',
          };
        } else {
          const body = {
            ...prepared.body,
            unfurl_links: false,
            unfurl_media: false,
          };
          const inPlace =
            job.kind === 'INTERACTION_REPLY' &&
            sourceReply &&
            job.groupId === sourceReply.groupId &&
            job.requestId === sourceReply.requestId;
          if (inPlace) {
            const text = String(prepared.body.text);
            result = await replaceSlackMessage(
              sourceReply.responseUrl,
              {
                text: `${text}\n\n${privacy}`,
                blocks: [
                  section(text),
                  {
                    type: 'context',
                    elements: [{ type: 'mrkdwn', text: privacy }],
                  },
                ],
                unfurl_links: false,
                unfurl_media: false,
              },
              send,
            );
            // An explicitly rejected/expired source update can use the normal
            // private reply. Ambiguous failures wait for the durable retry.
            if (!result.ok && !result.retryable)
              result = await sendSlack(
                env.SLACK_BOT_TOKEN,
                prepared.method,
                body,
                send,
              );
          } else {
            result = await sendSlack(
              env.SLACK_BOT_TOKEN,
              prepared.method,
              body,
              send,
            );
          }
        }
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
    const status = result.skipped
      ? 'SKIPPED'
      : result.ok
        ? 'SENT'
        : result.retryable && job.attempts < 5 && next < job.expiresAt
          ? 'PENDING'
          : 'FAILED';
    await db
      .prepare(
        `UPDATE deliveries SET status=?, available_at=?, last_error=?, retry_after_until=coalesce(?, retry_after_until), lease_id=NULL, lease_until=NULL
      WHERE id=? AND status='SENDING' AND lease_id=?`,
      )
      .bind(
        status,
        next,
        result.error ?? null,
        result.retryAfter ? next : null,
        job.id,
        leaseId,
      )
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
