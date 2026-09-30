import type { Clock } from '../domain/clock';
import type { ScheduledGroup } from '../domain/life-group';
import { upcomingDates, type ClassOccurrence } from '../domain/classes';

export async function getUpcomingStatus(
  group: ScheduledGroup,
  readClasses: (
    groupId: string,
    first: string,
    last: string,
  ) => Promise<ClassOccurrence[]>,
  clock: Clock,
) {
  const dates = upcomingDates(group, clock.now());
  const rows = await readClasses(group.id, dates[0]!, dates.at(-1)!);
  const byDate = new Map(rows.map((row) => [row.localDate, row]));
  return dates.map(
    (localDate): ClassOccurrence =>
      byDate.get(localDate) ?? {
        groupId: group.id,
        localDate,
        status: 'OPEN',
        volunteerUserId: null,
        assignmentId: null,
      },
  );
}
