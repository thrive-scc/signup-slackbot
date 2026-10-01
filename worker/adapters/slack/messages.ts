import type { SnackEnv } from '../../env';
import type { ScheduledGroup } from '../../domain/life-group';
import type { OperationReceipt } from '../../domain/lifecycle';
import type { SignupReceipt } from '../../domain/signup';
import { calendarLink } from '../calendar-download';
import { readAssignment } from '../d1/signups';
import { reminderTime } from '../../domain/scheduling';
import { dateLabel, startTimeLabel } from './date-labels';

export const privacy =
  'Direct interactions with this bot may be visible to group administrators.';
export const escapeSlack = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const section = (text: string) => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});
export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export function privateReply(message: SlackMessage) {
  return Response.json(
    {
      response_type: 'ephemeral',
      ...message,
      text: `${message.text}\n\n${privacy}`,
      ...(message.blocks
        ? {
            blocks: [
              ...message.blocks,
              {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: privacy }],
              },
            ],
          }
        : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export function publicOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    if (
      !allowed ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function operationMessage(
  env: SnackEnv,
  group: ScheduledGroup,
  receipt: SignupReceipt | OperationReceipt,
): Promise<SlackMessage> {
  const calendarNote =
    'Manage signup changes through the Slack bot; already-imported calendar events will not update automatically.';
  const messages: Partial<Record<OperationReceipt['outcome'], string>> = {
    NO_SNACK: 'Snack is not needed for that class.',
    TAKEN: 'Someone has already volunteered for that class.',
    NOT_OWNER:
      'You do not have a signup for that class. You can only cancel or change your own signup. Use `/snack mine` to check.',
    STALE:
      'That class has changed since these controls were displayed. Refresh the list before trying again.',
    CLOSED:
      'Class has started, so signup changes are closed. Please contact a group administrator.',
    CANCELLED: `Your snack signup for ${dateLabel(receipt.localDate)} was cancelled. ${calendarNote}`,
    MARKED_NO_SNACK: `Snack is not needed on ${dateLabel(receipt.localDate)}.`,
    OPENED: `Snack volunteering is open for ${dateLabel(receipt.localDate)}.`,
    UNCHANGED: 'The class already has that status.',
  };
  if (messages[receipt.outcome]) return { text: messages[receipt.outcome]! };
  const assignment = receipt.assignmentId
    ? await readAssignment(env.DB, receipt.assignmentId)
    : null;
  if (!assignment)
    return {
      text: 'The original signup was recorded, but that assignment is no longer active. Use `/snack mine` for current commitments.',
    };
  const origin = publicOrigin(env.PUBLIC_ORIGIN);
  if (!origin || !env.CALENDAR_SIGNING_KEY)
    throw new Error('Calendar configuration unavailable');
  const link = await calendarLink(
    origin,
    env.CALENDAR_SIGNING_KEY,
    assignment.assignmentId,
  );
  const opening =
    receipt.outcome === 'ALREADY_SIGNED_UP'
      ? 'You are already signed up'
      : receipt.outcome === 'CHANGED'
        ? 'Change complete; you’re signed up'
        : 'You’re signed up';
  const lateReminder =
    assignment.assignedAt >= reminderTime(group, assignment.localDate)
      ? '\nThe usual reminder time has passed. Please remember to bring snacks for this upcoming class!'
      : '';
  return {
    text: `${opening} to bring snacks for ${escapeSlack(group.name)} on ${dateLabel(assignment.localDate)} at ${startTimeLabel(assignment.startsAt, group.timezone)}!${lateReminder}\n\n<${link}|Add to your calendar>\n${calendarNote}\nUse \`/snack mine\` to manage your signups.`,
  };
}
