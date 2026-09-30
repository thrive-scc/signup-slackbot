export type SignupOutcome =
  'SIGNED_UP' | 'ALREADY_SIGNED_UP' | 'TAKEN' | 'NO_SNACK';
export interface SignupReceipt {
  operation: 'SIGNUP';
  outcome: SignupOutcome;
  assignmentId: string | null;
  actorUserId: string;
  localDate: string;
}
export interface Assignment {
  groupId: string;
  groupName: string;
  workspaceId: string;
  localDate: string;
  volunteerUserId: string;
  assignmentId: string;
  assignedAt: string;
  startsAt: string;
  endsAt: string;
}
export interface ClaimClass {
  replyChannelId?: string;
  groupId: string;
  requestId: string;
  actorUserId: string;
  localDate: string;
  assignmentId: string;
  now: string;
  startsAt: string;
  endsAt: string;
}
