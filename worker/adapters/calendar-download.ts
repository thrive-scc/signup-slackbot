import type { Clock } from '../domain/clock';
import { readAssignment } from './d1/signups';
import { calendarEvent } from './calendar';
import { sign, verify } from './signatures';

export async function calendarLink(
  origin: string,
  secret: string,
  assignmentId: string,
) {
  const signature = await sign(secret, `calendar:v1:${assignmentId}`);
  return `${origin}/calendar/${assignmentId}.ics?signature=${signature}`;
}
export async function downloadCalendar(
  request: Request,
  db: D1Database,
  secret: string,
  clock: Clock,
) {
  const url = new URL(request.url);
  const assignmentId = /^\/calendar\/([0-9a-f-]{36})\.ics$/.exec(
    url.pathname,
  )?.[1];
  if (!assignmentId) return new Response('Not found', { status: 404 });
  const authenticated = await verify(
    secret,
    `calendar:v1:${assignmentId}`,
    url.searchParams.get('signature') ?? '',
  );
  const assignment = authenticated
    ? await readAssignment(db, assignmentId)
    : null;
  const outcome = !authenticated
    ? 'INVALID_LINK'
    : assignment
      ? 'SERVED'
      : 'NOT_FOUND';
  // No token, full URL, IP or inferred identity is retained. An assignment link
  // can be forwarded; its owner is not necessarily the person requesting it.
  await db
    .prepare(
      `INSERT INTO activity
    (occurred_at, life_group_id, local_date, assignment_id, kind, outcome)
    VALUES (?, ?, ?, ?, 'CALENDAR_DOWNLOAD', ?)`,
    )
    .bind(
      clock.now().toISOString(),
      assignment?.groupId ?? null,
      assignment?.localDate ?? null,
      authenticated ? assignmentId : null,
      outcome,
    )
    .run();
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (!assignment)
    return new Response(
      'Calendar link is invalid or the assignment is no longer available.',
      { status: 404, headers },
    );
  return new Response(calendarEvent(assignment), {
    headers: {
      ...headers,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="snacks-${assignment.localDate}.ics"`,
    },
  });
}
