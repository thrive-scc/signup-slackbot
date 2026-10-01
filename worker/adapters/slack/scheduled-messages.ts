import type { ClassOccurrence } from '../../domain/classes';
import type { ScheduledGroup } from '../../domain/life-group';
import { escapeSlack, type SlackMessage } from './messages';
import type { Assignment } from '../../domain/signup';
import { dateLabel } from './date-labels';

export function reminderMessage(
  group: ScheduledGroup,
  assignment: Assignment,
): SlackMessage {
  return {
    text: `A friendly reminder: you’re signed up to bring snacks for ${escapeSlack(group.name)} on ${dateLabel(assignment.localDate)}. Thank you! Use \`/snack mine\` in <#${group.channelId}> to manage your commitment.`,
  };
}

/** Both occurrences are read at delivery time, including implicitly OPEN dates. */
export function classStartMessage(
  group: ScheduledGroup,
  today: ClassOccurrence,
  next: ClassOccurrence,
): SlackMessage {
  const name = escapeSlack(group.name);
  const current =
    today.status === 'ASSIGNED'
      ? `Thanks <@${today.volunteerUserId}> for taking care of snacks for ${name} today (${dateLabel(today.localDate)})!`
      : today.status === 'NO_SNACK'
        ? `No snacks are needed for ${name} today (${dateLabel(today.localDate)}).`
        : `No one signed up for snacks for ${name} today (${dateLabel(today.localDate)}).`;
  const following =
    next.status === 'ASSIGNED'
      ? `<@${next.volunteerUserId}> is signed up to bring snacks.`
      : next.status === 'NO_SNACK'
        ? 'Snacks are not needed.'
        : 'We need a snack volunteer!';
  return {
    text: `${current}\nNext week (${dateLabel(next.localDate)}): ${following}`,
  };
}
