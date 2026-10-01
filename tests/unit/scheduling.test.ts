import { expect, it } from 'vitest';
import { dueClassStarts, reminderTime } from '../../worker/domain/scheduling';
import { classTimes } from '../../worker/domain/class-time';

const group = {
  id: 'thrive',
  name: 'Thrive',
  workspaceId: 'T_TEST',
  channelId: 'C_TEST',
  timezone: 'America/Chicago',
  weekday: 0,
  startTime: '09:30',
  endTime: '11:45',
  scheduleStartDate: '2026-01-01',
  reminderDaysBefore: 3,
  reminderTime: '15:00',
};

it.each([
  ['2026-03-08', '2026-03-05T21:00:00.000Z', '2026-03-08T14:30:00.000Z'],
  ['2026-11-01', '2026-10-29T20:00:00.000Z', '2026-11-01T15:30:00.000Z'],
])(
  'uses local Thursday and Sunday times across the DST transition on %s',
  (date, reminder, start) => {
    expect(reminderTime(group, date)).toBe(reminder);
    expect(classTimes(group, date).startsAt).toBe(start);
  },
);

it('uses each group’s weekday, local reminder time and calendar-day offset', () => {
  expect(
    reminderTime(
      { ...group, weekday: 3, reminderDaysBefore: 2, reminderTime: '18:15' },
      '2026-11-04',
    ),
  ).toBe('2026-11-03T00:15:00.000Z');
});

it('includes exactly the one-hour class-start window, even if it crosses local midnight', () => {
  expect(dueClassStarts(group, new Date('2026-11-01T15:29:59.999Z'))).toEqual(
    [],
  );
  for (const instant of ['2026-11-01T15:30:00Z', '2026-11-01T16:29:59.999Z'])
    expect(dueClassStarts(group, new Date(instant))).toEqual([
      {
        localDate: '2026-11-01',
        scheduledAt: '2026-11-01T15:30:00.000Z',
        expiresAt: '2026-11-01T16:30:00.000Z',
      },
    ]);
  expect(dueClassStarts(group, new Date('2026-11-01T16:30:00Z'))).toEqual([]);
  expect(
    dueClassStarts(
      { ...group, startTime: '23:30', endTime: '23:59' },
      new Date('2026-11-02T06:15:00Z'),
    )[0]?.localDate,
  ).toBe('2026-11-01');
  expect(
    dueClassStarts(
      { ...group, scheduleStartDate: '2026-11-02' },
      new Date('2026-11-01T15:30:00Z'),
    ),
  ).toEqual([]);
});

it('rejects nonexistent, ambiguous or non-advance reminder times without shifting them', () => {
  for (const [date, time] of [
    ['2026-03-08', '02:30'],
    ['2026-11-01', '01:30'],
    ['2026-11-01', '15:00'],
  ])
    expect(() =>
      reminderTime(
        { ...group, reminderDaysBefore: 0, reminderTime: time! },
        date!,
      ),
    ).toThrow('administrator attention');
  expect(() =>
    reminderTime({ ...group, reminderDaysBefore: -1 }, '2026-11-01'),
  ).toThrow();
});
