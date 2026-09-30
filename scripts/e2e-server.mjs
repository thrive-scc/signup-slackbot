import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import process from 'node:process';

const state = await mkdtemp(join(tmpdir(), 'snack-e2e-'));
const wrangler = './node_modules/.bin/wrangler';
function run(args) {
  const result = spawnSync(wrangler, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('E2E database setup failed');
}
run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
run([
  'd1',
  'execute',
  'DB',
  '--local',
  '--persist-to',
  state,
  '--file',
  'tests/fixtures/life-groups.sql',
]);
const child = spawn(
  wrangler,
  [
    'dev',
    'tests/support/browser-worker.ts',
    '--local',
    '--port',
    '8788',
    '--persist-to',
    state,
    '--test-scheduled',
    '--env-file',
    'tests/fixtures/worker.env',
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.on('exit', async (code) => {
  await rm(state, { recursive: true, force: true });
  process.exit(code ?? 0);
});
