import type { ClassOccurrence } from '../../domain/classes';
import type { Assignment } from '../../domain/signup';
import { assignmentColumns } from './signups';

export async function readClasses(
  db: D1Database,
  groupId: string,
  first: string,
  last: string,
) {
  return (
    await db
      .prepare(
        `SELECT life_group_id AS groupId, local_date AS localDate,
    status, volunteer_user_id AS volunteerUserId, assignment_id AS assignmentId
    FROM classes WHERE life_group_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`,
      )
      .bind(groupId, first, last)
      .all<ClassOccurrence>()
  ).results;
}
export async function readOwnAssignments(
  db: D1Database,
  groupId: string,
  userId: string,
  now: string,
): Promise<Assignment[]> {
  return (
    await db
      .prepare(
        `SELECT ${assignmentColumns} FROM classes c
    JOIN life_groups g ON g.id=c.life_group_id
    WHERE c.life_group_id=? AND c.volunteer_user_id=? AND c.status='ASSIGNED' AND c.ends_at > ?
    ORDER BY c.local_date`,
      )
      .bind(groupId, userId, now)
      .all<Assignment>()
  ).results;
}
