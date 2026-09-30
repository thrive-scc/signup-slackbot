import process from 'node:process';
import { localCommand } from './local-slack.mjs';
const localDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate ?? ''))
  throw new Error(
    'Supply a future sample-group Sunday: npm run demo:signup -- YYYY-MM-DD',
  );
process.stdout.write((await localCommand('signup ' + localDate)) + '\n');
