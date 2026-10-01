import { Temporal } from '@js-temporal/polyfill';
import type { ScheduledGroup } from './life-group';
import { classTimes, ScheduleConfigurationError } from './class-time';

export const classPostLifetimeMs = 60 * 60 * 1000;

export function reminderTime(group: ScheduledGroup, localDate: string): string {
  const { startsAt } = classTimes(group, localDate);
  try {
    if (
      !Number.isSafeInteger(group.reminderDaysBefore) ||
      group.reminderDaysBefore < 0
    )
      throw new Error();
    const date = Temporal.PlainDate.from(localDate).subtract({
      days: group.reminderDaysBefore,
    });
    const reminder = Temporal.ZonedDateTime.from(
      `${date}T${group.reminderTime}[${group.timezone}]`,
      { disambiguation: 'reject' },
    )
      .toInstant()
      .toString({ smallestUnit: 'millisecond' });
    if (reminder >= startsAt) throw new Error();
    return reminder;
  } catch {
    throw new ScheduleConfigurationError(
      'This reminder schedule needs administrator attention.',
    );
  }
}

export const nextClassDate = (date: string) =>
  Temporal.PlainDate.from(date).add({ days: 7 }).toString();

/** One-hour catch-up can cross midnight; neither date requires a classes row. */
export function dueClassStarts(group: ScheduledGroup, now: Date) {
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(group.timezone)
    .toPlainDate();
  return [today.subtract({ days: 1 }), today].flatMap((date) => {
    const localDate = date.toString();
    if (
      date.dayOfWeek % 7 !== group.weekday ||
      localDate < group.scheduleStartDate
    )
      return [];
    const { startsAt } = classTimes(group, localDate);
    const expiresAt = new Date(
      Date.parse(startsAt) + classPostLifetimeMs,
    ).toISOString();
    return startsAt <= now.toISOString() && now.toISOString() < expiresAt
      ? [{ localDate, scheduledAt: startsAt, expiresAt }]
      : [];
  });
}
