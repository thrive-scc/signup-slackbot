import type { Clock } from '../domain/clock';
import type { GroupOverview, LifeGroup } from '../domain/life-group';
import type { Assignment } from '../domain/signup';
export async function getGroupOverview(
  readGroups: () => Promise<LifeGroup[]>,
  clock: Clock,
  readAssignments: (now: string) => Promise<Assignment[]>,
): Promise<GroupOverview> {
  const checkedAt = clock.now().toISOString();
  const [groups, assignments] = await Promise.all([
    readGroups(),
    readAssignments(checkedAt),
  ]);
  return { groups, assignments, checkedAt };
}
