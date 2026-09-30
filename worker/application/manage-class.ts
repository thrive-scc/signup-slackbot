import type { Clock } from '../domain/clock';
import type { ScheduledGroup } from '../domain/life-group';
import type {
  LifecycleInput,
  LifecycleWrite,
  OperationReceipt,
  VolunteerCutoff,
} from '../domain/lifecycle';
import { classTimes } from '../domain/class-time';
import { SignupError } from './signup-for-class';

interface LifecycleStore {
  getGroup(id: string): Promise<ScheduledGroup | null>;
  getReceipt(
    groupId: string,
    requestId: string,
  ): Promise<OperationReceipt | null>;
  apply(input: LifecycleWrite): Promise<OperationReceipt>;
}

/** Transport supplies an authenticated actor, never an actor from an admin form. */
export async function manageClass(
  input: LifecycleInput,
  actor: { kind: 'volunteer'; workspaceId: string } | { kind: 'admin' },
  store: LifecycleStore,
  clock: Clock,
  cutoff: VolunteerCutoff,
) {
  const group = await store.getGroup(input.groupId);
  if (
    !group ||
    (actor.kind === 'volunteer' && group.workspaceId !== actor.workspaceId)
  )
    throw new SignupError(
      'This life group is not configured for your workspace.',
    );
  const adminOperation =
    input.operation === 'NO_SNACK' || input.operation === 'OPEN';
  if (adminOperation !== (actor.kind === 'admin'))
    throw new SignupError('This operation is not available to this actor.');
  if (adminOperation && !input.expectedStatus)
    throw new SignupError('Refresh the class list before changing its status.');
  const previous = await store.getReceipt(group.id, input.requestId);
  const validateReceipt = (receipt: OperationReceipt) => {
    if (
      receipt.operation !== input.operation ||
      receipt.actorUserId !== input.actorUserId ||
      receipt.localDate !== input.localDate ||
      receipt.targetDate !== (input.targetDate ?? null) ||
      receipt.expectedAssignmentId !== (input.expectedAssignmentId ?? null) ||
      receipt.expectedStatus !== (input.expectedStatus ?? null)
    )
      throw new SignupError(
        'This request does not match its original operation. Run /snack again.',
      );
  };
  if (previous) {
    validateReceipt(previous);
    return { group, receipt: previous };
  }
  classTimes(group, input.localDate);
  const now = clock.now();
  let times: { startsAt: string; endsAt: string } | null = null;
  if (input.operation === 'CHANGE') {
    if (!input.targetDate || input.targetDate === input.localDate)
      throw new SignupError(
        'Choose a different class date. Your original signup is unchanged.',
      );
    times = classTimes(group, input.targetDate);
    if (Date.parse(times.startsAt) <= now.getTime())
      throw new SignupError(
        'Choose a future destination class. Your original signup is unchanged.',
      );
  }
  const receipt = await store.apply({
    ...input,
    now: now.toISOString(),
    newAssignmentId: crypto.randomUUID(),
    targetStartsAt: times?.startsAt ?? null,
    targetEndsAt: times?.endsAt ?? null,
    volunteerCutoff: cutoff,
  });
  validateReceipt(receipt);
  return { group, receipt };
}
