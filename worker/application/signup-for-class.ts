import type { Clock } from '../domain/clock';
import type { ScheduledGroup } from '../domain/life-group';
import type { ClaimClass, SignupReceipt } from '../domain/signup';
import { classTimes } from '../domain/class-time';

export interface SignupStore {
  getGroup(id: string): Promise<ScheduledGroup | null>;
  getReceipt(groupId: string, requestId: string): Promise<SignupReceipt | null>;
  claim(input: ClaimClass): Promise<SignupReceipt>;
}
export class SignupError extends Error {}

export async function signupForClass(
  input: {
    groupId: string;
    workspaceId: string;
    actorUserId: string;
    localDate: string;
    requestId: string;
    replyChannelId?: string;
  },
  store: SignupStore,
  clock: Clock,
  newAssignmentId: () => string,
) {
  const group = await store.getGroup(input.groupId);
  if (!group || group.workspaceId !== input.workspaceId) {
    throw new SignupError(
      'This life group is not configured for your workspace.',
    );
  }
  // Replay before the cutoff check: a successful request must still recover its
  // receipt when a retry arrives just after class starts.
  const previous = await store.getReceipt(group.id, input.requestId);
  const validateReceipt = (receipt: SignupReceipt) => {
    if (
      receipt.operation !== 'SIGNUP' ||
      receipt.actorUserId !== input.actorUserId ||
      receipt.localDate !== input.localDate
    )
      throw new SignupError(
        'This request does not match its original signup. Please run /snack again.',
      );
  };
  if (previous) {
    validateReceipt(previous);
    return { group, receipt: previous };
  }
  const times = classTimes(group, input.localDate);
  const now = clock.now();
  if (now.getTime() >= Date.parse(times.startsAt)) {
    throw new SignupError(
      'Signup closes when class starts. Please choose a future class date.',
    );
  }
  const receipt = await store.claim({
    groupId: group.id,
    requestId: input.requestId,
    replyChannelId: input.replyChannelId,
    actorUserId: input.actorUserId,
    localDate: input.localDate,
    assignmentId: newAssignmentId(),
    now: now.toISOString(),
    ...times,
  });
  validateReceipt(receipt);
  return { group, receipt };
}
