import type { Clock } from './domain/clock';
import { classTimes } from './domain/class-time';
import { dueClassStarts, reminderTime } from './domain/scheduling';
import { readLifeGroups } from './adapters/d1/life-groups';
import { readAssignments } from './adapters/d1/signups';

/** Discover still-useful work; uniqueness in D1 survives competing cron passes. */
export async function enqueueScheduled(db: D1Database, clock: Clock) {
  const now = clock.now();
  const groups = await readLifeGroups(db);
  const assignments = await readAssignments(db, now.toISOString());
  let failed = false;
  for (const group of groups) {
    try {
      const statements: D1PreparedStatement[] = [];
      for (const occurrence of dueClassStarts(group, now)) {
        statements.push(
          db
            .prepare(
              `INSERT INTO deliveries
          (life_group_id, kind, local_date, scheduled_at, available_at, expires_at)
          VALUES (?, 'CLASS_START', ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
            )
            .bind(
              group.id,
              occurrence.localDate,
              occurrence.scheduledAt,
              occurrence.scheduledAt,
              occurrence.expiresAt,
            ),
        );
      }
      for (const assignment of assignments.filter(
        (a) => a.groupId === group.id && a.startsAt > now.toISOString(),
      )) {
        const times = classTimes(group, assignment.localDate);
        if (
          times.startsAt !== assignment.startsAt ||
          times.endsAt !== assignment.endsAt
        )
          throw new Error('Schedule changed since signup');
        const due = reminderTime(group, assignment.localDate);
        // A late signup's confirmation is its reminder. No second DM on the next tick.
        if (assignment.assignedAt >= due || due > now.toISOString()) continue;
        statements.push(
          db
            .prepare(
              `INSERT INTO deliveries
          (life_group_id, kind, local_date, assignment_id, scheduled_at, available_at, expires_at)
          SELECT life_group_id, 'REMINDER', local_date, assignment_id, ?, ?, starts_at
          FROM classes WHERE life_group_id=? AND local_date=? AND assignment_id=?
            AND status='ASSIGNED' AND assigned_at < ? AND starts_at > ?
          ON CONFLICT DO NOTHING`,
            )
            .bind(
              due,
              due,
              group.id,
              assignment.localDate,
              assignment.assignmentId,
              due,
              now.toISOString(),
            ),
        );
      }
      if (statements.length) await db.batch(statements);
    } catch {
      // Let other groups and delivery recovery proceed, but make cron failure visible.
      console.error('SCHEDULE_PROCESSING_FAILED', { groupId: group.id });
      failed = true;
    }
  }
  if (failed)
    throw new Error(
      'Scheduled processing failed; inspect group configuration and D1 availability.',
    );
}
