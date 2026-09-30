import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { signupForClass } from '../../worker/application/signup-for-class';
import { manageClass } from '../../worker/application/manage-class';
import { getUpcomingStatus } from '../../worker/application/get-upcoming-status';
import { signupStore, readAssignments } from '../../worker/adapters/d1/signups';
import {
  applyLifecycle,
  readOperation,
} from '../../worker/adapters/d1/lifecycle';
import { readClasses } from '../../worker/adapters/d1/classes';
import type { LifecycleInput } from '../../worker/domain/lifecycle';
import { fixedClock } from '../support/clock';

const clock = fixedClock('2026-10-31T20:00:00Z');
const groupId = 'thrive-fixture';
const workspaceId = 'T_FIXTURE';
const actorUserId = 'U_FIXTURE';
const localDate = '2026-11-01';
const targetDate = '2026-11-08';
const store = () => ({
  ...signupStore(env.DB),
  getReceipt: (g: string, r: string) => readOperation(env.DB, g, r),
  apply: (input: Parameters<typeof applyLifecycle>[1]) =>
    applyLifecycle(env.DB, input),
});
const signup = (date = localDate, user = actorUserId) =>
  signupForClass(
    {
      groupId,
      workspaceId,
      actorUserId: user,
      localDate: date,
      requestId: crypto.randomUUID(),
    },
    signupStore(env.DB),
    clock,
    () => crypto.randomUUID(),
  );
const operate = (input: Partial<LifecycleInput> = {}, at = clock) => {
  const args: LifecycleInput = {
    groupId,
    actorUserId,
    localDate,
    operation: 'CANCEL',
    requestId: crypto.randomUUID(),
    ...input,
  };
  return manageClass(
    args,
    args.operation === 'OPEN' || args.operation === 'NO_SNACK'
      ? { kind: 'admin' }
      : { kind: 'volunteer', workspaceId },
    store(),
    at,
    'class-start',
  );
};
const assignments = () => readAssignments(env.DB, clock.now().toISOString());

it('lists eight effective future classes without inserting rows, including both exception states', async () => {
  const group = (await signupStore(env.DB).getGroup(groupId))!;
  const read = (g: string, a: string, b: string) =>
    readClasses(env.DB, g, a, b);
  const initial = await getUpcomingStatus(group, read, clock);
  expect(initial).toHaveLength(8);
  expect(initial[0]).toMatchObject({ localDate, status: 'OPEN' });
  expect(initial.at(-1)?.localDate).toBe('2026-12-20');
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM classes').first('n'),
  ).toBe(0);
  await signup();
  await operate({
    operation: 'NO_SNACK',
    localDate: targetDate,
    expectedStatus: 'OPEN',
    actorUserId: 'admin:fixture',
  });
  expect(
    (await getUpcomingStatus(group, read, clock))
      .slice(0, 3)
      .map((c) => c.status),
  ).toEqual(['ASSIGNED', 'NO_SNACK', 'OPEN']);
});

it('cancels only your own commitment; exact retries do not cancel a later signup', async () => {
  const original = await signup();
  expect((await operate({ actorUserId: 'U_OTHER' })).receipt.outcome).toBe(
    'NOT_OWNER',
  );
  expect(await assignments()).toHaveLength(1);
  const request = {
    requestId: 'cancel-original',
    expectedAssignmentId: original.receipt.assignmentId!,
  };
  const cancelled = await operate(request);
  expect(cancelled.receipt.outcome).toBe('CANCELLED');
  expect(await assignments()).toHaveLength(0);
  const replacement = await signup();
  expect((await operate(request)).receipt).toEqual(cancelled.receipt);
  expect(
    (await operate({ expectedAssignmentId: original.receipt.assignmentId! }))
      .receipt.outcome,
  ).toBe('STALE');
  expect((await assignments())[0]?.assignmentId).toBe(
    replacement.receipt.assignmentId,
  );
});

it('moves to an absent OPEN date with a fresh assignment ID and one audit on retries', async () => {
  const before = await signup();
  const input = {
    operation: 'CHANGE' as const,
    targetDate,
    requestId: 'move',
    expectedAssignmentId: before.receipt.assignmentId!,
  };
  const results = await Promise.all([operate(input), operate(input)]);
  expect(results[0]!.receipt).toEqual(results[1]!.receipt);
  expect(results[0]!.receipt.outcome).toBe('CHANGED');
  const after = await assignments();
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    localDate: targetDate,
    volunteerUserId: actorUserId,
  });
  expect(after[0]?.assignmentId).not.toBe(before.receipt.assignmentId);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM activity WHERE kind='CHANGE'",
    ).first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare('SELECT status FROM classes WHERE local_date=?')
      .bind(localDate)
      .first('status'),
  ).toBe('OPEN');
});

it('failed moves to taken or NO_SNACK dates preserve the original assignment exactly', async () => {
  const original = await signup();
  await signup(targetDate, 'U_OTHER');
  expect(
    (await operate({ operation: 'CHANGE', targetDate })).receipt.outcome,
  ).toBe('TAKEN');
  await operate({
    operation: 'NO_SNACK',
    localDate: '2026-11-15',
    expectedStatus: 'OPEN',
  });
  expect(
    (await operate({ operation: 'CHANGE', targetDate: '2026-11-15' })).receipt
      .outcome,
  ).toBe('NO_SNACK');
  expect(
    (await assignments()).find((a) => a.localDate === localDate)?.assignmentId,
  ).toBe(original.receipt.assignmentId);
});

it('two moves racing for the same destination preserve the losing source', async () => {
  await signup();
  await signup('2026-11-15', 'U_OTHER');
  const results = await Promise.all([
    operate({ operation: 'CHANGE', targetDate }),
    operate({
      operation: 'CHANGE',
      localDate: '2026-11-15',
      actorUserId: 'U_OTHER',
      targetDate,
    }),
  ]);
  expect(results.map((r) => r.receipt.outcome).sort()).toEqual([
    'CHANGED',
    'TAKEN',
  ]);
  expect(await assignments()).toHaveLength(2);
  expect(
    (await assignments()).filter((a) => a.localDate === targetDate),
  ).toHaveLength(1);
});

it('NO_SNACK cancels the assignment, audits the admin and queues one durable notice; reopen restores nobody', async () => {
  const before = await signup();
  const input = {
    operation: 'NO_SNACK' as const,
    actorUserId: 'admin:fixture',
    expectedStatus: 'ASSIGNED' as const,
    expectedAssignmentId: before.receipt.assignmentId!,
    requestId: 'no-snack',
  };
  await Promise.all([operate(input), operate(input)]);
  expect(await assignments()).toHaveLength(0);
  expect(
    (await env.DB.prepare('SELECT kind, status FROM deliveries').all()).results,
  ).toEqual([{ kind: 'CANCELLATION_NOTICE', status: 'PENDING' }]);
  expect(
    await env.DB.prepare(
      "SELECT actor_user_id, previous_assignment_id, previous_volunteer_id FROM activity WHERE kind='NO_SNACK'",
    ).first(),
  ).toEqual({
    actor_user_id: 'admin:fixture',
    previous_assignment_id: before.receipt.assignmentId,
    previous_volunteer_id: actorUserId,
  });
  expect(
    (await operate({ operation: 'OPEN', expectedStatus: 'NO_SNACK' })).receipt
      .outcome,
  ).toBe('OPENED');
  expect(await assignments()).toHaveLength(0);
  expect((await signup()).receipt.outcome).toBe('SIGNED_UP');
  expect((await operate(input)).receipt.outcome).toBe('MARKED_NO_SNACK');
  expect(await assignments()).toHaveLength(1);
});

it('stale admin state cannot remove a new signup, and OPEN cannot erase an assignment', async () => {
  const before = await signup();
  expect(
    (await operate({ operation: 'NO_SNACK', expectedStatus: 'OPEN' })).receipt
      .outcome,
  ).toBe('STALE');
  expect(
    (
      await operate({
        operation: 'OPEN',
        expectedStatus: 'ASSIGNED',
        expectedAssignmentId: before.receipt.assignmentId!,
      })
    ).receipt.outcome,
  ).toBe('STALE');
  expect(await assignments()).toHaveLength(1);
});

it('audit or delivery failures roll back a move or admin cancellation with their receipts', async () => {
  const before = await signup();
  await env.DB.prepare(
    "CREATE TRIGGER fail_lifecycle_audit BEFORE INSERT ON activity WHEN NEW.kind='CHANGE' BEGIN SELECT RAISE(ABORT, 'fixture'); END",
  ).run();
  try {
    await expect(
      operate({ operation: 'CHANGE', targetDate, requestId: 'rollback-move' }),
    ).rejects.toThrow();
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_lifecycle_audit').run();
  }
  await env.DB.prepare(
    "CREATE TRIGGER fail_delivery BEFORE INSERT ON deliveries BEGIN SELECT RAISE(ABORT, 'fixture'); END",
  ).run();
  try {
    await expect(
      operate({
        operation: 'NO_SNACK',
        expectedStatus: 'ASSIGNED',
        expectedAssignmentId: before.receipt.assignmentId!,
        requestId: 'rollback-admin',
      }),
    ).rejects.toThrow();
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_delivery').run();
  }
  expect(await assignments()).toHaveLength(1);
  expect((await assignments())[0]?.assignmentId).toBe(
    before.receipt.assignmentId,
  );
  expect(await readOperation(env.DB, groupId, 'rollback-move')).toBeNull();
  expect(await readOperation(env.DB, groupId, 'rollback-admin')).toBeNull();
});

it('rejects malformed, same-date, off-cadence and past destinations without losing the source', async () => {
  await signup();
  for (const targetDate of [
    localDate,
    '2026-11-02',
    '2026-02-30',
    '2026-10-25',
  ])
    await expect(
      operate({ operation: 'CHANGE', targetDate }),
    ).rejects.toThrow();
  expect(await assignments()).toHaveLength(1);
});

it('applies the supplied cutoff atomically and recovers a committed cancellation after it', async () => {
  await signup();
  const atStart = fixedClock('2026-11-01T15:30:00Z');
  expect((await operate({}, atStart)).receipt.outcome).toBe('CLOSED');
  expect(await assignments()).toHaveLength(1);
  const requestId = 'before-cutoff';
  expect(
    (await operate({ requestId }, fixedClock('2026-11-01T15:29:59.999Z')))
      .receipt.outcome,
  ).toBe('CANCELLED');
  expect((await operate({ requestId }, atStart)).receipt.outcome).toBe(
    'CANCELLED',
  );
});
