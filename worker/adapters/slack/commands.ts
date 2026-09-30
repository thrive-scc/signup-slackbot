import type { SnackEnv } from '../../env';
import type { Clock } from '../../domain/clock';
import type { ScheduledGroup } from '../../domain/life-group';
import {
  ClassDateError,
  ScheduleConfigurationError,
} from '../../domain/class-time';
import {
  SignupError,
  signupForClass,
} from '../../application/signup-for-class';
import { manageClass } from '../../application/manage-class';
import { getUpcomingStatus } from '../../application/get-upcoming-status';
import { findChannelGroups, signupStore } from '../d1/signups';
import { applyLifecycle, readOperation } from '../d1/lifecycle';
import { readClasses, readOwnAssignments } from '../d1/classes';
import { calendarLink } from '../calendar-download';
import { digest } from '../signatures';
import { readSlackRequest, slackId } from './read-request';
import {
  escapeSlack,
  operationMessage,
  privateReply,
  publicOrigin,
  section,
  type SlackMessage,
} from './messages';

import type { VolunteerCutoff } from '../../domain/lifecycle';
export type { VolunteerCutoff } from '../../domain/lifecycle';
export const uncertainMessage =
  'We could not confirm the result. Your change may have been saved. Use `/snack mine` to check before making another change.';
export const knownError = (error: unknown) =>
  error instanceof SignupError ||
  error instanceof ClassDateError ||
  error instanceof ScheduleConfigurationError;
const plain = (text: string) => ({ type: 'plain_text', text });
const actionValue = (
  group: ScheduledGroup,
  date: string,
  assignmentId?: string,
  targetDate?: string,
) =>
  JSON.stringify({
    groupId: group.id,
    localDate: date,
    assignmentId,
    targetDate,
  });

export async function commandMessage(
  text: string,
  group: ScheduledGroup,
  actorUserId: string,
  requestId: string,
  env: SnackEnv,
  clock: Clock,
  cutoff: VolunteerCutoff | undefined,
  interaction?: { channelId: string; assignmentId?: string },
): Promise<SlackMessage> {
  const guide = `Use \`/snack list\` for the next eight classes, \`/snack mine\` for your signups, or \`/snack signup YYYY-MM-DD\`.\nCancel: \`/snack cancel YYYY-MM-DD\`. Move: \`/snack change YYYY-MM-DD YYYY-MM-DD\`.\nClasses meet ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][group.weekday]}, ${group.startTime}–${group.endTime} ${escapeSlack(group.timezone)}. Signup closes at class start.`;
  const buttonsEnabled =
    !!env.SLACK_BOT_TOKEN && env.SLACK_BOT_WORKSPACE_ID === group.workspaceId;
  if (text === '' || text === 'list' || text === 'help') {
    const classes = await getUpcomingStatus(
      group,
      (g, a, b) => readClasses(env.DB, g, a, b),
      clock,
    );
    const descriptions = classes.map(
      (c) =>
        `${c.localDate} — ${c.status === 'OPEN' ? 'Volunteer needed' : c.status === 'NO_SNACK' ? 'No snack needed' : `<@${c.volunteerUserId}> is signed up`}`,
    );
    return {
      text: `${escapeSlack(group.name)}\n${descriptions.join('\n')}\n\n${guide}`,
      blocks: [
        section(`*${escapeSlack(group.name)} · Upcoming classes*`),
        ...classes.map((c, i) => ({
          ...section(descriptions[i]!),
          ...(buttonsEnabled && c.status === 'OPEN'
            ? {
                accessory: {
                  type: 'button',
                  text: plain('Bring snacks'),
                  action_id: 'snack_signup',
                  value: actionValue(group, c.localDate),
                },
              }
            : {}),
        })),
        section(guide),
      ],
    };
  }
  const mine = /^mine(?:\s+([1-9]\d{0,3}))?$/.exec(text);
  if (mine) {
    const assignments = await readOwnAssignments(
      env.DB,
      group.id,
      actorUserId,
      clock.now().toISOString(),
    );
    const page = Number(mine[1] ?? 1);
    const selected = assignments.slice((page - 1) * 8, page * 8);
    const available = await getUpcomingStatus(
      group,
      (g, a, b) => readClasses(env.DB, g, a, b),
      clock,
    );
    const blocks: unknown[] = [
      section(`*Your snack signups for ${escapeSlack(group.name)}*`),
    ];
    const lines: string[] = [];
    for (const a of selected) {
      const link = await calendarLink(
        publicOrigin(env.PUBLIC_ORIGIN)!,
        env.CALENDAR_SIGNING_KEY!,
        a.assignmentId,
      );
      const description = `${a.localDate} — <${link}|Calendar (.ics)>`;
      lines.push(description);
      blocks.push(section(description));
      if (
        buttonsEnabled &&
        cutoff &&
        Date.parse(cutoff === 'class-start' ? a.startsAt : a.endsAt) >
          clock.now().getTime()
      ) {
        const elements: unknown[] = [
          {
            type: 'button',
            text: plain('Cancel signup'),
            action_id: 'snack_cancel',
            value: actionValue(group, a.localDate, a.assignmentId),
            confirm: {
              title: plain('Cancel your signup?'),
              text: plain(`Release your snack commitment for ${a.localDate}?`),
              confirm: plain('Cancel signup'),
              deny: plain('Keep signup'),
            },
          },
        ];
        const options = available
          .filter((c) => c.status === 'OPEN' && c.localDate !== a.localDate)
          .map((c) => ({
            text: plain(c.localDate),
            value: actionValue(group, a.localDate, a.assignmentId, c.localDate),
          }));
        if (options.length)
          elements.push({
            type: 'static_select',
            action_id: 'snack_change',
            placeholder: plain('Move to another date'),
            options,
            confirm: {
              title: plain('Move your signup?'),
              text: plain(
                'Your original date is released only if the selected date is still open.',
              ),
              confirm: plain('Move signup'),
              deny: plain('Keep signup'),
            },
          });
        blocks.push({ type: 'actions', elements });
      }
    }
    const footer = `${selected.length ? `Page ${page} of ${Math.ceil(assignments.length / 8)}.` : 'No signups on this page.'}${assignments.length > page * 8 ? ` Next: \`/snack mine ${page + 1}\`.` : ''}\n${guide}\nAlready-imported calendar events will not update automatically. If a button has no confirmation, run \`/snack mine\` to check the result.`;
    blocks.push(section(footer));
    return {
      text: `Your snack signups\n${lines.join('\n')}\n${footer}`,
      blocks,
    };
  }
  const signup = /^signup\s+(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (signup) {
    const { receipt } = await signupForClass(
      {
        groupId: group.id,
        workspaceId: group.workspaceId,
        actorUserId,
        localDate: signup[1]!,
        requestId,
        replyChannelId: interaction?.channelId,
      },
      signupStore(env.DB),
      clock,
      () => crypto.randomUUID(),
    );
    return operationMessage(env, group, receipt);
  }
  const cancel = /^cancel\s+(\d{4}-\d{2}-\d{2})$/.exec(text);
  const change = /^change\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/.exec(
    text,
  );
  if (cancel || change) {
    if (!cutoff)
      throw new SignupError(
        'Cancellation and date changes are awaiting the group’s cutoff policy.',
      );
    const { receipt } = await manageClass(
      {
        groupId: group.id,
        actorUserId,
        requestId,
        operation: cancel ? 'CANCEL' : 'CHANGE',
        localDate: (cancel ?? change)![1]!,
        targetDate: change?.[2],
        expectedAssignmentId: interaction?.assignmentId,
        replyChannelId: interaction?.channelId,
      },
      { kind: 'volunteer', workspaceId: group.workspaceId },
      {
        ...signupStore(env.DB),
        getReceipt: (g, r) => readOperation(env.DB, g, r),
        apply: (input) => applyLifecycle(env.DB, input),
      },
      clock,
      cutoff,
    );
    return operationMessage(env, group, receipt);
  }
  return { text: guide };
}

export async function handleSnackCommand(
  request: Request,
  env: SnackEnv,
  clock: Clock,
  cutoff?: VolunteerCutoff,
) {
  if (request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  if (
    !env.SLACK_SIGNING_SECRET ||
    !env.CALENDAR_SIGNING_KEY ||
    !publicOrigin(env.PUBLIC_ORIGIN)
  )
    return new Response('Snack signup is not configured.', { status: 503 });
  const raw = await readSlackRequest(request, env.SLACK_SIGNING_SECRET, clock);
  if (raw instanceof Response) return raw;
  const form = new URLSearchParams(raw);
  if (
    ['team_id', 'channel_id', 'user_id', 'command', 'text', 'trigger_id'].some(
      (key) =>
        form.getAll(key).length !== 1 || (key !== 'text' && !form.get(key)),
    ) ||
    form.get('command') !== '/snack'
  )
    return new Response('Malformed Slack command.', { status: 400 });
  const workspaceId = form.get('team_id')!;
  const channelId = form.get('channel_id')!;
  const userId = form.get('user_id')!;
  if (![workspaceId, channelId, userId].every(slackId))
    return new Response('Malformed Slack command.', { status: 400 });
  try {
    const groups = await findChannelGroups(env.DB, workspaceId, channelId);
    if (channelId.startsWith('D') || !groups.length)
      return privateReply({
        text: 'Please use /snack in your life group’s configured Slack channel. Signups are not available in DMs or unconfigured channels.',
      });
    if (groups.length !== 1)
      return privateReply({
        text: 'More than one life group is configured for this channel. Ask an administrator to correct the channel configuration.',
      });
    return privateReply(
      await commandMessage(
        form.get('text')!.trim(),
        groups[0]!,
        userId,
        `slack:${await digest(raw)}`,
        env,
        clock,
        cutoff,
      ),
    );
  } catch (error) {
    return privateReply({
      text: knownError(error) ? (error as Error).message : uncertainMessage,
    });
  }
}
