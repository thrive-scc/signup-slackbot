import type { Assignment } from './signup';
export interface LifeGroup {
  id: string;
  name: string;
  timezone: string;
  weekday: number;
  startTime: string;
  endTime: string;
}
export interface ScheduledGroup extends LifeGroup {
  workspaceId: string;
  channelId: string;
  scheduleStartDate: string;
}
export interface GroupOverview {
  groups: LifeGroup[];
  assignments: Assignment[];
  checkedAt: string;
}
