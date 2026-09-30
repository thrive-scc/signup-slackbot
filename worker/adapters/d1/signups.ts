import type {
  Assignment,
  ClaimClass,
  SignupReceipt,
} from '../../domain/signup';
import type { ScheduledGroup } from '../../domain/life-group';
import { interactionDelivery } from './lifecycle';

export const groupColumns = `id, name, timezone, weekday, start_time AS startTime,
  end_time AS endTime, slack_workspace_id AS workspaceId,
  slack_channel_id AS channelId, schedule_start_date AS scheduleStartDate`;
const receiptColumns = `operation, outcome, assignment_id AS assignmentId,
  actor_user_id AS actorUserId, local_date AS localDate`;
export const assignmentColumns = `c.life_group_id AS groupId, g.name AS groupName,
  g.slack_workspace_id AS workspaceId, c.local_date AS localDate,
  c.volunteer_user_id AS volunteerUserId, c.assignment_id AS assignmentId,
  c.assigned_at AS assignedAt, c.starts_at AS startsAt, c.ends_at AS endsAt`;

export function signupStore(db: D1Database) {
  return {
    getGroup: (id: string) =>
      db
        .prepare(`SELECT ${groupColumns} FROM life_groups WHERE id = ?`)
        .bind(id)
        .first<ScheduledGroup>(),
    getReceipt: (groupId: string, requestId: string) =>
      db
        .prepare(
          `SELECT ${receiptColumns} FROM operation_receipts WHERE life_group_id = ? AND request_id = ?`,
        )
        .bind(groupId, requestId)
        .first<SignupReceipt>(),
    async claim(input: ClaimClass): Promise<SignupReceipt> {
      const {
        groupId,
        requestId,
        actorUserId,
        localDate,
        assignmentId,
        now,
        startsAt,
        endsAt,
      } = input;
      // This unique attempt owns all writes only if it inserted the receipt.
      const attemptId = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO operation_receipts
          (life_group_id, request_id, attempt_id, actor_user_id, local_date, outcome, created_at)
          VALUES (?, ?, ?, ?, ?, 'PENDING', ?) ON CONFLICT DO NOTHING`,
          )
          .bind(groupId, requestId, attemptId, actorUserId, localDate, now),
        db
          .prepare(
            `INSERT INTO classes
          (life_group_id, local_date, status, volunteer_user_id, assignment_id, assigned_at, starts_at, ends_at)
          SELECT ?, ?, 'ASSIGNED', ?, ?, ?, ?, ? FROM operation_receipts
          WHERE life_group_id = ? AND request_id = ? AND attempt_id = ?
          ON CONFLICT(life_group_id, local_date) DO UPDATE SET
            status = 'ASSIGNED', volunteer_user_id = excluded.volunteer_user_id,
            assignment_id = excluded.assignment_id, assigned_at = excluded.assigned_at,
            starts_at = excluded.starts_at, ends_at = excluded.ends_at
          WHERE classes.status = 'OPEN'`,
          )
          .bind(
            groupId,
            localDate,
            actorUserId,
            assignmentId,
            now,
            startsAt,
            endsAt,
            groupId,
            requestId,
            attemptId,
          ),
        db
          .prepare(
            `UPDATE operation_receipts SET
          outcome = (SELECT CASE
            WHEN assignment_id = ? THEN 'SIGNED_UP'
            WHEN status = 'NO_SNACK' THEN 'NO_SNACK'
            WHEN volunteer_user_id = ? THEN 'ALREADY_SIGNED_UP'
            ELSE 'TAKEN' END FROM classes WHERE life_group_id = ? AND local_date = ?),
          assignment_id = (SELECT CASE WHEN volunteer_user_id = ? THEN assignment_id ELSE NULL END
            FROM classes WHERE life_group_id = ? AND local_date = ?)
          WHERE life_group_id = ? AND request_id = ? AND attempt_id = ?`,
          )
          .bind(
            assignmentId,
            actorUserId,
            groupId,
            localDate,
            actorUserId,
            groupId,
            localDate,
            groupId,
            requestId,
            attemptId,
          ),
        db
          .prepare(
            `INSERT INTO activity
          (occurred_at, life_group_id, local_date, assignment_id, actor_user_id, kind, outcome)
          SELECT created_at, life_group_id, local_date, assignment_id, actor_user_id, 'SIGNUP', outcome
          FROM operation_receipts WHERE life_group_id = ? AND request_id = ? AND attempt_id = ?`,
          )
          .bind(groupId, requestId, attemptId),
        db
          .prepare(
            `SELECT ${receiptColumns} FROM operation_receipts WHERE life_group_id = ? AND request_id = ?`,
          )
          .bind(groupId, requestId),
        interactionDelivery(
          db,
          groupId,
          requestId,
          attemptId,
          input.replyChannelId,
        ),
      ]);
      const receipt = results[4]?.results[0] as SignupReceipt | undefined;
      if (!receipt) throw new Error('Missing committed signup receipt');
      return receipt;
    },
  };
}

export async function findChannelGroups(
  db: D1Database,
  workspace: string,
  channel: string,
) {
  return (
    await db
      .prepare(
        `SELECT ${groupColumns} FROM life_groups
    WHERE slack_workspace_id = ? AND slack_channel_id = ?`,
      )
      .bind(workspace, channel)
      .all<ScheduledGroup>()
  ).results;
}
export async function readAssignments(db: D1Database, now: string) {
  return (
    await db
      .prepare(
        `SELECT ${assignmentColumns} FROM classes c JOIN life_groups g ON g.id = c.life_group_id
    WHERE c.status = 'ASSIGNED' AND c.ends_at > ? ORDER BY c.local_date, g.name`,
      )
      .bind(now)
      .all<Assignment>()
  ).results;
}
export function readAssignment(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT ${assignmentColumns} FROM classes c JOIN life_groups g ON g.id = c.life_group_id
    WHERE c.assignment_id = ? AND c.status = 'ASSIGNED'`,
    )
    .bind(id)
    .first<Assignment>();
}
