import type { SnackEnv } from '../../env';
import type { Clock } from '../../domain/clock';
import { digest } from '../signatures';
import { findChannelGroups } from '../d1/signups';
import { deliverPending } from '../../delivery';
import { readSlackRequest, slackId } from './read-request';
import {
  commandMessage,
  knownError,
  uncertainMessage,
  ownSignupsUnavailable,
  type VolunteerCutoff,
} from './commands';
import {
  privacy,
  privateMessage,
  publicOrigin,
  type SlackMessage,
} from './messages';
import { sendSlack, slackResponseUrl, replaceSlackMessage } from './api';
import { section } from './messages';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export async function handleInteraction(
  request: Request,
  env: SnackEnv,
  clock: Clock,
  context: Pick<ExecutionContext, 'waitUntil'>,
  cutoff?: VolunteerCutoff,
) {
  if (
    !env.SLACK_SIGNING_SECRET ||
    !env.CALENDAR_SIGNING_KEY ||
    !publicOrigin(env.PUBLIC_ORIGIN) ||
    !env.SLACK_BOT_TOKEN ||
    !env.SLACK_BOT_WORKSPACE_ID
  )
    return new Response('Slack interactions are not configured.', {
      status: 503,
    });
  const raw = await readSlackRequest(request, env.SLACK_SIGNING_SECRET, clock);
  if (raw instanceof Response) return raw;
  const form = new URLSearchParams(raw);
  let payload: Record<string, unknown>;
  let value: Record<string, unknown>;
  let action: Record<string, unknown>;
  try {
    if (form.getAll('payload').length !== 1) throw new Error();
    payload = object(JSON.parse(form.get('payload')!));
    if (
      payload.type !== 'block_actions' ||
      !Array.isArray(payload.actions) ||
      payload.actions.length !== 1
    )
      throw new Error();
    action = object(payload.actions[0]);
    value = object(
      JSON.parse(
        String(
          action.action_id === 'snack_change'
            ? object(action.selected_option).value
            : action.value,
        ),
      ),
    );
  } catch {
    return new Response('Malformed interaction.', { status: 400 });
  }
  const workspace = object(payload.team).id;
  const channel = object(payload.channel).id;
  const user = object(payload.user).id;
  const { groupId, localDate, assignmentId, targetDate, page } = value;
  const pageNavigation = ['snack_mine_previous', 'snack_mine_next'].includes(
    String(action.action_id),
  );
  if (
    ![workspace, channel, user].every(slackId) ||
    typeof groupId !== 'string' ||
    typeof action.action_ts !== 'string' ||
    !/^\d+\.\d+$/.test(action.action_ts) ||
    ![
      'snack_signup',
      'snack_cancel',
      'snack_change',
      'snack_mine_previous',
      'snack_mine_next',
    ].includes(String(action.action_id)) ||
    (pageNavigation &&
      (typeof page !== 'number' ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 9999)) ||
    (!pageNavigation &&
      (typeof localDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(localDate))) ||
    (!pageNavigation &&
      action.action_id !== 'snack_signup' &&
      (typeof assignmentId !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(assignmentId))) ||
    (action.action_id === 'snack_change' &&
      (typeof targetDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)))
  )
    return new Response('Malformed interaction.', { status: 400 });
  const workspaceId = workspace as string;
  const channelId = channel as string;
  const actorUserId = user as string;
  if (workspaceId !== env.SLACK_BOT_WORKSPACE_ID || channelId.startsWith('D'))
    return new Response('Unsupported workspace or channel.', { status: 403 });
  const responseUrl =
    (action.action_id === 'snack_signup' || pageNavigation) &&
    object(payload.container).is_ephemeral === true
      ? slackResponseUrl(payload.response_url)
      : null;
  try {
    const groups = await findChannelGroups(env.DB, workspaceId, channelId);
    if (groups.length !== 1 || groups[0]!.id !== groupId)
      return new Response('These controls are not available in this channel.', {
        status: 403,
      });
    if (pageNavigation) {
      // Pagination is a current, private read. It has no mutation receipt or job.
      // Fetch and delivery stay outside Slack's acknowledgment deadline.
      context.waitUntil(
        (async () => {
          let message: SlackMessage;
          try {
            message = await commandMessage(
              `mine ${page}`,
              groups[0]!,
              actorUserId,
              '',
              env,
              clock,
              cutoff,
            );
          } catch {
            message = {
              text: ownSignupsUnavailable,
            };
          }
          const body = privateMessage(message);
          if (responseUrl) {
            const result = await replaceSlackMessage(responseUrl, body);
            if (result.ok || result.retryAfter) return;
          }
          await sendSlack(env.SLACK_BOT_TOKEN!, 'chat.postEphemeral', {
            channel: channelId,
            user: actorUserId,
            ...body,
          });
        })(),
      );
      return new Response(null, { status: 200 });
    }
    const operation =
      action.action_id === 'snack_signup'
        ? 'signup'
        : action.action_id === 'snack_cancel'
          ? 'cancel'
          : 'change';
    // Slack's action timestamp identifies this click. Transport-only response URLs
    // and trigger IDs are deliberately excluded from the idempotency key.
    const requestId = `action:${await digest(JSON.stringify([workspaceId, channelId, actorUserId, action.action_ts, action.action_id, value]))}`;
    await commandMessage(
      `${operation} ${localDate}${operation === 'change' ? ` ${targetDate}` : ''}`,
      groups[0]!,
      actorUserId,
      requestId,
      env,
      clock,
      cutoff,
      {
        channelId,
        assignmentId:
          typeof assignmentId === 'string' ? assignmentId : undefined,
      },
    );
    context.waitUntil(
      deliverPending(
        env,
        clock,
        undefined,
        responseUrl ? { groupId, requestId, responseUrl } : undefined,
      ),
    );
  } catch (error) {
    // Validation failures have no state change to commit. Give immediate private
    // guidance outside the ACK path; successful mutation replies live in D1.
    const text = `${pageNavigation ? ownSignupsUnavailable : knownError(error) ? (error as Error).message : uncertainMessage}\n\n${privacy}`;
    const fallback = () =>
      sendSlack(env.SLACK_BOT_TOKEN!, 'chat.postEphemeral', {
        channel: channelId,
        user: actorUserId,
        text,
      });
    context.waitUntil(
      (async () => {
        if (responseUrl) {
          const result = await replaceSlackMessage(responseUrl, {
            text,
            blocks: [section(text)],
          });
          if (result.ok || result.retryAfter) return;
        }
        await fallback();
      })(),
    );
  }
  return new Response(null, { status: 200 });
}
