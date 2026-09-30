import { expect, it } from 'vitest';
import ICAL from 'ical.js';
import { classTimes } from '../../worker/domain/class-time';
import { calendarEvent } from '../../worker/adapters/calendar';
import type { ScheduledGroup } from '../../worker/domain/life-group';

const group: ScheduledGroup = {
  id: 'thrive',
  name: 'Thrive',
  workspaceId: 'T_TEST',
  channelId: 'C_TEST',
  timezone: 'America/Chicago',
  weekday: 0,
  startTime: '09:30',
  endTime: '11:45',
  scheduleStartDate: '2026-01-01',
};

it.each([
  ['2026-03-01', '2026-03-01T15:30:00.000Z', '2026-03-01T17:45:00.000Z'],
  ['2026-03-08', '2026-03-08T14:30:00.000Z', '2026-03-08T16:45:00.000Z'],
  ['2026-10-25', '2026-10-25T14:30:00.000Z', '2026-10-25T16:45:00.000Z'],
  ['2026-11-01', '2026-11-01T15:30:00.000Z', '2026-11-01T17:45:00.000Z'],
])(
  'independently parses the correct Chicago calendar event for %s',
  (localDate, start, end) => {
    const times = classTimes(group, localDate);
    const text = calendarEvent({
      ...times,
      groupId: group.id,
      groupName: group.name,
      workspaceId: group.workspaceId,
      localDate,
      volunteerUserId: 'U_TEST',
      assignmentId: 'fixed-assignment',
      assignedAt: '2026-01-01T12:00:00.000Z',
    });
    const event = new ICAL.Event(
      new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent')!,
    );
    expect(event.startDate.toJSDate().toISOString()).toBe(start);
    expect(event.endDate.toJSDate().toISOString()).toBe(end);
    expect(event.summary).toBe('Bring snacks for Thrive');
    expect(event.uid).toBe('fixed-assignment@snack-signup');
    expect(event.description).toContain('Slack bot');
    expect(event.description).toContain('will not update automatically');
    expect(text.endsWith('\r\n')).toBe(true);
  },
);

it('preserves Unicode and punctuation through RFC text escaping and byte folding', () => {
  const name = 'Thrive; friends, family\\neighbors\n' + '食'.repeat(40);
  const text = calendarEvent({
    ...classTimes(group, '2026-11-01'),
    groupId: 'g',
    groupName: name,
    workspaceId: 'T',
    localDate: '2026-11-01',
    volunteerUserId: 'U',
    assignmentId: 'id',
    assignedAt: '2026-01-01T00:00:00.000Z',
  });
  const event = new ICAL.Event(
    new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent')!,
  );
  expect(event.summary).toBe(`Bring snacks for ${name}`);
  for (const line of text.split('\r\n'))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});

it('validates dates and cadence while allowing a different group weekday', () => {
  for (const date of ['2026-02-30', '2026-03-09', '2025-12-28', '2026-3-08'])
    expect(() => classTimes(group, date)).toThrow();
  expect(classTimes({ ...group, weekday: 3 }, '2026-03-11').startsAt).toBe(
    '2026-03-11T14:30:00.000Z',
  );
});

it('fails visibly for unsupported schedule times instead of shifting commitments', () => {
  expect(() =>
    classTimes({ ...group, startTime: '02:30' }, '2026-03-08'),
  ).toThrow('administrator attention');
  expect(() =>
    classTimes({ ...group, startTime: '01:30' }, '2026-11-01'),
  ).toThrow('administrator attention');
  expect(() =>
    classTimes({ ...group, timezone: 'Not/AZone' }, '2026-11-01'),
  ).toThrow('administrator attention');
  expect(() =>
    classTimes({ ...group, endTime: '08:00' }, '2026-11-01'),
  ).toThrow('administrator attention');
});
