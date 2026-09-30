import { createWorker } from '../../worker/http';
import { fixedClock } from './clock';
// Disposable browser server only. Never deploy this entry.
export default createWorker(
  () => ({ id: 'admin:browser-fixture' }),
  fixedClock('2026-10-31T20:00:00Z'),
  'class-start',
);
