import { createWorker } from './http';
// Authentication is not implemented in M0. The deployable entry fails closed.
export default createWorker(() => false, undefined, 'class-start');
