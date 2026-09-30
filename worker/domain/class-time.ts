import { Temporal } from '@js-temporal/polyfill';
import type { ScheduledGroup } from './life-group';

export class ClassDateError extends Error {}
export class ScheduleConfigurationError extends Error {}

export function classTimes(group: ScheduledGroup, localDate: string) {
  let date: Temporal.PlainDate;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error();
    date = Temporal.PlainDate.from(localDate, { overflow: 'reject' });
  } catch {
    throw new ClassDateError('Use a valid date in YYYY-MM-DD format.');
  }
  if (
    date.dayOfWeek % 7 !== group.weekday ||
    localDate < group.scheduleStartDate
  ) {
    throw new ClassDateError(
      'That date is outside this life group’s weekly schedule.',
    );
  }
  try {
    if (group.endTime <= group.startTime) throw new Error();
    // Unsupported ambiguous/nonexistent times fail visibly; never guess an offset.
    const start = Temporal.ZonedDateTime.from(
      `${localDate}T${group.startTime}[${group.timezone}]`,
      { disambiguation: 'reject' },
    );
    const end = Temporal.ZonedDateTime.from(
      `${localDate}T${group.endTime}[${group.timezone}]`,
      { disambiguation: 'reject' },
    );
    return {
      startsAt: start.toInstant().toString({ smallestUnit: 'millisecond' }),
      endsAt: end.toInstant().toString({ smallestUnit: 'millisecond' }),
    };
  } catch {
    throw new ScheduleConfigurationError(
      'This class schedule needs administrator attention.',
    );
  }
}
