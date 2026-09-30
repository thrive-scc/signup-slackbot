import type { ClassStatus } from './classes';
import type { SignupOutcome } from './signup';

export type VolunteerCutoff = 'class-start' | 'class-end';
export type LifecycleOperation = 'CANCEL' | 'CHANGE' | 'NO_SNACK' | 'OPEN';
export type OperationOutcome =
  | SignupOutcome
  | 'CANCELLED'
  | 'CHANGED'
  | 'MARKED_NO_SNACK'
  | 'OPENED'
  | 'UNCHANGED'
  | 'NOT_OWNER'
  | 'STALE'
  | 'CLOSED';
export interface OperationReceipt {
  operation: LifecycleOperation | 'SIGNUP';
  outcome: OperationOutcome;
  actorUserId: string;
  localDate: string;
  targetDate: string | null;
  expectedAssignmentId: string | null;
  expectedStatus: ClassStatus | null;
  previousAssignmentId: string | null;
  previousVolunteerId: string | null;
  assignmentId: string | null;
}
export interface LifecycleInput {
  groupId: string;
  requestId: string;
  actorUserId: string;
  operation: LifecycleOperation;
  localDate: string;
  targetDate?: string;
  expectedAssignmentId?: string;
  expectedStatus?: ClassStatus;
  replyChannelId?: string;
}
export interface LifecycleWrite extends LifecycleInput {
  now: string;
  newAssignmentId: string;
  targetStartsAt: string | null;
  targetEndsAt: string | null;
  /** Resolved by the application from the approved volunteer cutoff policy. */
  volunteerCutoff: VolunteerCutoff;
}
