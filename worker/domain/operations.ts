export interface ActivityEntry {
  id: number;
  occurredAt: string;
  localDate: string | null;
  assignmentId: string | null;
  actorUserId: string | null;
  kind:
    'SIGNUP' | 'CANCEL' | 'CHANGE' | 'NO_SNACK' | 'OPEN' | 'CALENDAR_DOWNLOAD';
  outcome: string;
  targetDate: string | null;
  previousAssignmentId: string | null;
  previousVolunteerId: string | null;
}

export type DeliveryStatus =
  'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
export type DeliveryFilter = 'attention' | 'all';
export interface DeliveryEntry {
  id: number;
  kind:
    'INTERACTION_REPLY' | 'CANCELLATION_NOTICE' | 'REMINDER' | 'CLASS_START';
  status: DeliveryStatus;
  localDate: string | null;
  targetDate: string | null;
  recipientUserId: string | null;
  attempts: number;
  availableAt: string;
  expiresAt: string;
  scheduledAt: string | null;
  leaseUntil: string | null;
  lastError: string | null;
}

export interface GroupOperations {
  groupId: string;
  workspaceId: string;
  checkedAt: string;
  activity: ActivityEntry[];
  deliveries: DeliveryEntry[];
  moreActivity: boolean;
  moreDeliveries: boolean;
  deliveryFilter: DeliveryFilter;
  deliveryCounts: Record<DeliveryStatus, number>;
}
