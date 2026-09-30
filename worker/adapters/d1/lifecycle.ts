import type { LifecycleWrite, OperationReceipt } from '../../domain/lifecycle';

export const operationColumns = `operation, outcome, actor_user_id AS actorUserId,
  local_date AS localDate, target_date AS targetDate, assignment_id AS assignmentId,
  expected_assignment_id AS expectedAssignmentId, expected_status AS expectedStatus,
  previous_assignment_id AS previousAssignmentId, previous_volunteer_id AS previousVolunteerId`;

export function readOperation(
  db: D1Database,
  groupId: string,
  requestId: string,
) {
  return db
    .prepare(
      `SELECT ${operationColumns} FROM operation_receipts
    WHERE life_group_id = ? AND request_id = ?`,
    )
    .bind(groupId, requestId)
    .first<OperationReceipt>();
}

export function interactionDelivery(
  db: D1Database,
  groupId: string,
  requestId: string,
  attemptId: string,
  channelId: string | undefined,
) {
  return db
    .prepare(
      `INSERT INTO deliveries(life_group_id, request_id, kind, channel_id, available_at, expires_at)
    SELECT life_group_id, request_id, 'INTERACTION_REPLY', ?, created_at,
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 minutes')
    FROM operation_receipts WHERE life_group_id = ? AND request_id = ? AND attempt_id = ? AND ? IS NOT NULL
    ON CONFLICT DO NOTHING`,
    )
    .bind(channelId ?? null, groupId, requestId, attemptId, channelId ?? null);
}

/** Every eligibility check and mutation below occurs in one serialized D1 batch. */
export async function applyLifecycle(
  db: D1Database,
  input: LifecycleWrite,
): Promise<OperationReceipt> {
  const { groupId, requestId, actorUserId, operation, localDate, now } = input;
  const attemptId = crypto.randomUUID();
  const gate = `life_group_id = ? AND request_id = ? AND attempt_id = ? AND outcome = 'PENDING'`;
  const owner = [groupId, requestId, attemptId];
  const clear = `volunteer_user_id = NULL, assignment_id = NULL, assigned_at = NULL, starts_at = NULL, ends_at = NULL`;
  const statements = [
    db
      .prepare(
        `INSERT INTO operation_receipts
    (life_group_id, request_id, attempt_id, actor_user_id, local_date, operation, target_date,
      expected_assignment_id, expected_status, previous_assignment_id, previous_volunteer_id, outcome, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, c.assignment_id, c.volunteer_user_id,
      CASE
        WHEN ? IN ('CANCEL', 'CHANGE') THEN CASE
          WHEN c.status IS NOT 'ASSIGNED' OR c.volunteer_user_id IS NOT ? THEN 'NOT_OWNER'
          WHEN ? IS NOT NULL AND c.assignment_id IS NOT ? THEN 'STALE'
          WHEN c.${input.volunteerCutoff === 'class-start' ? 'starts_at' : 'ends_at'} <= ? THEN 'CLOSED'
          WHEN ? = 'CHANGE' AND t.status = 'NO_SNACK' THEN 'NO_SNACK'
          WHEN ? = 'CHANGE' AND t.status = 'ASSIGNED' THEN 'TAKEN'
          ELSE 'PENDING' END
        WHEN coalesce(c.status, 'OPEN') IS NOT ? OR c.assignment_id IS NOT ? THEN 'STALE'
        WHEN ? = 'OPEN' AND c.status = 'ASSIGNED' THEN 'STALE'
        WHEN coalesce(c.status, 'OPEN') = ? THEN 'UNCHANGED'
        ELSE 'PENDING' END, ?
    FROM (SELECT 1) LEFT JOIN classes c ON c.life_group_id = ? AND c.local_date = ?
      LEFT JOIN classes t ON t.life_group_id = ? AND t.local_date = ?
    WHERE 1 ON CONFLICT DO NOTHING`,
      )
      .bind(
        groupId,
        requestId,
        attemptId,
        actorUserId,
        localDate,
        operation,
        input.targetDate ?? null,
        input.expectedAssignmentId ?? null,
        input.expectedStatus ?? null,
        operation,
        actorUserId,
        input.expectedAssignmentId ?? null,
        input.expectedAssignmentId ?? null,
        now,
        operation,
        operation,
        input.expectedStatus ?? null,
        input.expectedAssignmentId ?? null,
        operation,
        operation,
        now,
        groupId,
        localDate,
        groupId,
        input.targetDate ?? null,
      ),
  ];

  if (operation === 'CHANGE') {
    statements.push(
      db
        .prepare(
          `INSERT INTO classes
      (life_group_id, local_date, status, volunteer_user_id, assignment_id, assigned_at, starts_at, ends_at)
      SELECT life_group_id, target_date, 'ASSIGNED', actor_user_id, ?, created_at, ?, ?
      FROM operation_receipts WHERE ${gate}
      ON CONFLICT(life_group_id, local_date) DO UPDATE SET status = 'ASSIGNED',
        volunteer_user_id = excluded.volunteer_user_id, assignment_id = excluded.assignment_id,
        assigned_at = excluded.assigned_at, starts_at = excluded.starts_at, ends_at = excluded.ends_at
      WHERE classes.status = 'OPEN'`,
        )
        .bind(
          input.newAssignmentId,
          input.targetStartsAt,
          input.targetEndsAt,
          ...owner,
        ),
    );
  }
  if (operation === 'CANCEL' || operation === 'CHANGE') {
    statements.push(
      db
        .prepare(
          `UPDATE classes SET status = 'OPEN', ${clear}
      WHERE life_group_id = ? AND local_date = ? AND EXISTS
        (SELECT 1 FROM operation_receipts WHERE ${gate})`,
        )
        .bind(groupId, localDate, ...owner),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO classes(life_group_id, local_date, status)
      SELECT life_group_id, local_date, ? FROM operation_receipts WHERE ${gate}
      ON CONFLICT(life_group_id, local_date) DO UPDATE SET status = excluded.status, ${clear}`,
        )
        .bind(operation, ...owner),
    );
  }
  const success = {
    CANCEL: 'CANCELLED',
    CHANGE: 'CHANGED',
    NO_SNACK: 'MARKED_NO_SNACK',
    OPEN: 'OPENED',
  }[operation];
  statements.push(
    db
      .prepare(
        `UPDATE operation_receipts SET outcome = ?, assignment_id = ? WHERE ${gate}`,
      )
      .bind(
        success,
        operation === 'CHANGE' ? input.newAssignmentId : null,
        ...owner,
      ),
    db
      .prepare(
        `INSERT INTO activity(occurred_at, life_group_id, local_date, assignment_id,
      actor_user_id, kind, outcome, target_date, previous_assignment_id, previous_volunteer_id)
      SELECT created_at, life_group_id, local_date, assignment_id, actor_user_id, operation, outcome,
        target_date, previous_assignment_id, previous_volunteer_id FROM operation_receipts
      WHERE life_group_id = ? AND request_id = ? AND attempt_id = ?`,
      )
      .bind(...owner),
    db
      .prepare(
        `INSERT INTO deliveries(life_group_id, request_id, kind, available_at, expires_at)
      SELECT life_group_id, request_id, 'CANCELLATION_NOTICE', created_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+1 day')
      FROM operation_receipts WHERE life_group_id = ? AND request_id = ? AND attempt_id = ?
        AND outcome = 'MARKED_NO_SNACK' AND previous_volunteer_id IS NOT NULL
      ON CONFLICT DO NOTHING`,
      )
      .bind(...owner),
    interactionDelivery(
      db,
      groupId,
      requestId,
      attemptId,
      input.replyChannelId,
    ),
    db
      .prepare(
        `SELECT ${operationColumns} FROM operation_receipts WHERE life_group_id = ? AND request_id = ?`,
      )
      .bind(groupId, requestId),
  );
  const results = await db.batch(statements);
  const receipt = results.at(-1)?.results[0] as OperationReceipt | undefined;
  if (!receipt) throw new Error('Missing committed operation receipt');
  return receipt;
}
