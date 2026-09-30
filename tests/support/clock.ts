import type { Clock } from '../../worker/domain/clock';

export function fixedClock(instant: string): Clock {
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds))
    throw new Error('Invalid fixture instant');
  return { now: () => new Date(milliseconds) };
}
