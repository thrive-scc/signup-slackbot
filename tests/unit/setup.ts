import { vi } from 'vitest';

vi.stubGlobal('fetch', () => {
  throw new Error('Unit tests must use an injected fake, not the network.');
});
