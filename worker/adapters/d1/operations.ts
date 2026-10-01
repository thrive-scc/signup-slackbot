import type {
  ActivityEntry,
  DeliveryEntry,
  DeliveryFilter,
  DeliveryStatus,
} from '../../domain/operations';

const limit = 50;

/** An explicit read model: no request bodies, bearer URLs or delivery leases. */
export async function readGroupOperations(
  db: D1Database,
  groupId: string,
  filter: DeliveryFilter,
) {
  const [activity, deliveries, counts] = await Promise.all([
    db
      .prepare(
        `SELECT id, occurred_at AS occurredAt, local_date AS localDate,
      assignment_id AS assignmentId, actor_user_id AS actorUserId, kind, outcome,
      target_date AS targetDate, previous_assignment_id AS previousAssignmentId,
      previous_volunteer_id AS previousVolunteerId
      FROM activity WHERE life_group_id=? ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      )
      .bind(groupId, limit + 1)
      .all<ActivityEntry>(),
    db
      .prepare(
        `SELECT d.id, d.kind, d.status,
      coalesce(d.local_date, r.local_date) AS localDate, r.target_date AS targetDate,
      CASE d.kind
        WHEN 'INTERACTION_REPLY' THEN r.actor_user_id
        WHEN 'CANCELLATION_NOTICE' THEN r.previous_volunteer_id
        WHEN 'REMINDER' THEN (SELECT actor_user_id FROM operation_receipts
          WHERE life_group_id=d.life_group_id AND assignment_id=d.assignment_id
            AND outcome IN ('SIGNED_UP', 'CHANGED')
          ORDER BY created_at DESC, request_id DESC LIMIT 1)
        ELSE NULL END AS recipientUserId,
      d.attempts, d.available_at AS availableAt, d.expires_at AS expiresAt,
      d.scheduled_at AS scheduledAt, d.lease_until AS leaseUntil, d.last_error AS lastError
      FROM deliveries d LEFT JOIN operation_receipts r
        ON r.life_group_id=d.life_group_id AND r.request_id=d.request_id
      WHERE d.life_group_id=? AND (?='all' OR d.status IN ('PENDING', 'SENDING', 'FAILED'))
      ORDER BY d.id DESC LIMIT ?`,
      )
      .bind(groupId, filter, limit + 1)
      .all<DeliveryEntry>(),
    db
      .prepare(
        `SELECT status, count(*) AS total FROM deliveries
      WHERE life_group_id=? GROUP BY status`,
      )
      .bind(groupId)
      .all<{ status: DeliveryStatus; total: number }>(),
  ]);
  const deliveryCounts: Record<DeliveryStatus, number> = {
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
  for (const row of counts.results) deliveryCounts[row.status] = row.total;
  return {
    activity: activity.results.slice(0, limit),
    deliveries: deliveries.results.slice(0, limit),
    moreActivity: activity.results.length > limit,
    moreDeliveries: deliveries.results.length > limit,
    deliveryCounts,
  };
}
