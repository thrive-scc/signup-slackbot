import type { ScheduledGroup } from '../../domain/life-group';
import { groupColumns } from './signups';
export async function readLifeGroups(
  db: D1Database,
): Promise<ScheduledGroup[]> {
  const result = await db
    .prepare(
      `
    SELECT ${groupColumns}
    FROM life_groups ORDER BY name, id
  `,
    )
    .all<ScheduledGroup>();
  return result.results;
}
