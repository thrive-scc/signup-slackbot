import { createWorker } from './http';
// Explicitly selected by local commands only, never wrangler.main.
export default createWorker(
  () => ({ id: 'development:local-admin' }),
  undefined,
  'class-start',
);
