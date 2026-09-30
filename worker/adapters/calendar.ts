import type { Assignment } from '../domain/signup';

function escapeText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
function utc(iso: string) {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
// RFC 5545: fold at 75 octets without splitting a UTF-8 character.
function fold(line: string) {
  let result = '';
  let bytes = 0;
  for (const character of line) {
    const length = new TextEncoder().encode(character).length;
    if (bytes + length > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += length;
  }
  return result;
}
export function calendarEvent(assignment: Assignment): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Snack signup bot//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${assignment.assignmentId}@snack-signup`,
      `DTSTAMP:${utc(assignment.assignedAt)}`,
      `DTSTART:${utc(assignment.startsAt)}`,
      `DTEND:${utc(assignment.endsAt)}`,
      `SUMMARY:${escapeText(`Bring snacks for ${assignment.groupName}`)}`,
      `DESCRIPTION:${escapeText(`This event represents your ${assignment.groupName} snack commitment. Manage changes through the Slack bot. Already-imported calendar events will not update automatically.`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}
