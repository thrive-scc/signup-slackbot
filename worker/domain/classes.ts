import { Temporal } from '@js-temporal/polyfill';
import type { ScheduledGroup } from './life-group';
import { classTimes } from './class-time';

export type ClassStatus = 'OPEN' | 'ASSIGNED' | 'NO_SNACK';
export interface ClassOccurrence {
  groupId: string;
  localDate: string;
  status: ClassStatus;
  volunteerUserId: string | null;
  assignmentId: string | null;
}

/** A bounded view, not a signup horizon: dated commands can use any future class. */
export function upcomingDates(group: ScheduledGroup, now: Date, count = 8) {
  let date = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(group.timezone)
    .toPlainDate();
  if (date.toString() < group.scheduleStartDate)
    date = Temporal.PlainDate.from(group.scheduleStartDate);
  date = date.add({ days: (group.weekday - (date.dayOfWeek % 7) + 7) % 7 });
  const dates: string[] = [];
  while (dates.length < count) {
    const localDate = date.toString();
    if (Date.parse(classTimes(group, localDate).startsAt) > now.getTime())
      dates.push(localDate);
    date = date.add({ days: 7 });
  }
  return dates;
}
