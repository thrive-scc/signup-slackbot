import { expect, it } from 'vitest';
import { classStartMessage } from '../../worker/adapters/slack/scheduled-messages';
import type { ClassOccurrence, ClassStatus } from '../../worker/domain/classes';

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
const occurrence = (
  date: string,
  status: ClassStatus,
  user: string,
): ClassOccurrence => ({
  groupId: group.id,
  localDate: date,
  status,
  volunteerUserId: status === 'ASSIGNED' ? user : null,
  assignmentId: status === 'ASSIGNED' ? `assignment-${date}` : null,
});

it.each(['OPEN', 'ASSIGNED', 'NO_SNACK'] as const)(
  'always reports all next-class possibilities when today is %s',
  (status) => {
    const today = occurrence('2026-11-01', status, 'U_TODAY');
    for (const nextState of ['OPEN', 'ASSIGNED', 'NO_SNACK'] as const) {
      const { text } = classStartMessage(
        group,
        today,
        occurrence('2026-11-08', nextState, 'U_NEXT'),
      );
      expect(text).toContain('Next week (Nov 8):');
      expect(text).not.toMatch(/brought|delivered/);
      expect(text).not.toContain('/snack');
      if (nextState === 'ASSIGNED')
        expect(text).toContain('<@U_NEXT> is signed up');
      if (nextState === 'OPEN')
        expect(text).toContain('need a snack volunteer');
      if (nextState === 'NO_SNACK')
        expect(text).toContain('Snacks are not needed.');
      if (status === 'ASSIGNED') expect(text).toContain('Thanks <@U_TODAY>');
      else expect(text).not.toContain('<@U_TODAY>');
      if (status === 'NO_SNACK')
        expect(text).toContain('No snacks are needed for Thrive today');
    }
  },
);

it('escapes group names and does not assume Sunday wording', () => {
  const { text } = classStartMessage(
    { ...group, name: 'Midweek <friends> & family', weekday: 3 },
    occurrence('2026-11-04', 'OPEN', ''),
    occurrence('2026-11-11', 'OPEN', ''),
  );
  expect(text).toContain('Midweek &lt;friends&gt; &amp; family');
  expect(text).toContain('Nov 11');
  expect(text).not.toContain('Sunday');
});
