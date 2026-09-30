import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
try {
  await writeFile(
    '.dev.vars',
    [
      '# Generated local-only demonstration keys. Not real Slack credentials.',
      'SLACK_SIGNING_SECRET=' + randomBytes(32).toString('hex'),
      'CALENDAR_SIGNING_KEY=' + randomBytes(32).toString('hex'),
      'PUBLIC_ORIGIN=http://localhost:8787',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    'Created ignored .dev.vars with local-only keys. Restart the development Worker before running demo:signup.\n',
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  process.stdout.write('.dev.vars already exists; it was left unchanged.\n');
}
