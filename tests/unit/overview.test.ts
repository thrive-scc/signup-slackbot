import { expect, it } from 'vitest';
import { getGroupOverview } from '../../worker/application/get-group-overview';
import { fixedClock } from '../support/clock';

it('reports an empty configuration at the supplied instant, without manufacturing classes', async () => {
  const result = await getGroupOverview(
    async () => [],
    fixedClock('2026-03-08T14:30:00Z'),
    async () => [],
  );
  expect(result).toEqual({
    groups: [],
    assignments: [],
    checkedAt: '2026-03-08T14:30:00.000Z',
  });
});

it('does not turn a failed read into a misleading empty configuration', async () => {
  await expect(
    getGroupOverview(
      async () => {
        throw new Error('database unavailable');
      },
      fixedClock('2026-11-01T15:30:00Z'),
      async () => [],
    ),
  ).rejects.toThrow('database unavailable');
});
