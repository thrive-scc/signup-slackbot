import { expect, it } from 'vitest';
import { upcomingDates } from '../../worker/domain/classes';
import { classTimes } from '../../worker/domain/class-time';
import type { ScheduledGroup } from '../../worker/domain/life-group';

const group: ScheduledGroup = {
  id: 'fixture',
  name: 'Fixture',
  workspaceId: 'T_FIXTURE',
  channelId: 'C_FIXTURE',
  timezone: 'America/Chicago',
  weekday: 0,
  startTime: '09:30',
  endTime: '11:45',
  scheduleStartDate: '2026-01-01',
  reminderDaysBefore: 3,
  reminderTime: '15:00',
};

it('uses the group-local date and skips a class exactly at its start', () => {
  expect(upcomingDates(group, new Date('2026-11-01T15:29:59.999Z'))[0]).toBe(
    '2026-11-01',
  );
  expect(upcomingDates(group, new Date('2026-11-01T15:30:00.000Z'))[0]).toBe(
    '2026-11-08',
  );
  // UTC Monday is still Sunday evening in Chicago.
  const evening = { ...group, startTime: '20:00', endTime: '21:00' };
  expect(upcomingDates(evening, new Date('2026-11-02T00:00:00Z'))[0]).toBe(
    '2026-11-01',
  );
});

it('honors a non-Sunday cadence and a later schedule start without manufacturing exceptions', () => {
  const dates = upcomingDates(
    { ...group, weekday: 2, scheduleStartDate: '2027-01-01' },
    new Date('2026-09-25T20:00:00Z'),
  );
  expect(dates[0]).toBe('2027-01-05');
  expect(dates[1]).toBe('2027-01-12');
  expect(dates).toHaveLength(8);
});

it('lists local weekly dates across both DST changes without assuming 168 UTC hours', () => {
  for (const [now, first, second, firstStart, secondStart] of [
    [
      '2026-02-28T20:00:00Z',
      '2026-03-01',
      '2026-03-08',
      '2026-03-01T15:30:00.000Z',
      '2026-03-08T14:30:00.000Z',
    ],
    [
      '2026-10-24T20:00:00Z',
      '2026-10-25',
      '2026-11-01',
      '2026-10-25T14:30:00.000Z',
      '2026-11-01T15:30:00.000Z',
    ],
  ]) {
    const dates = upcomingDates(group, new Date(now!));
    expect(dates.slice(0, 2)).toEqual([first, second]);
    expect(classTimes(group, dates[0]!).startsAt).toBe(firstStart);
    expect(classTimes(group, dates[1]!).startsAt).toBe(secondStart);
  }
});
