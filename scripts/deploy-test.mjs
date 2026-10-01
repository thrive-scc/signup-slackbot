import { chmod, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const { fetch, AbortSignal } = globalThis;

// Slack CLI supplies this token to the deployment hook, never as a shell argument.
// This hook targets only the named test environment, not Slack-hosted execution.
const secretsPath = '.env.test-secrets.json';
const secrets = JSON.parse(await readFile(secretsPath, 'utf8'));
const botToken = process.env.SLACK_BOT_TOKEN;
if (!botToken || !botToken.startsWith('xoxb-'))
  throw new Error(
    'Run this hook through slack deploy to supply the bot token.',
  );
if (
  !/^[a-f0-9]{32}$/.test(secrets.SLACK_SIGNING_SECRET ?? '') ||
  typeof secrets.CALENDAR_SIGNING_KEY !== 'string' ||
  secrets.CALENDAR_SIGNING_KEY.length < 32
)
  throw new Error(
    'Fill the private test signing secret and calendar key first.',
  );
if (
  secrets.SLACK_BOT_WORKSPACE_ID !== 'T03PJ6WU2' ||
  secrets.PUBLIC_ORIGIN !==
    'https://snack-signup-bot-test.adam-lindell.workers.dev'
)
  throw new Error(
    'The private configuration must target the known test deployment.',
  );

const response = await fetch('https://slack.com/api/auth.test', {
  method: 'POST',
  headers: { Authorization: `Bearer ${botToken}` },
  signal: AbortSignal.timeout(10_000),
});
const identity = await response.json();
if (
  !response.ok ||
  !identity.ok ||
  identity.team_id !== 'T03PJ6WU2' ||
  identity.user_id !== 'U0C6MQDG8BA' ||
  identity.bot_id !== 'B0C5REZHJ1L'
)
  throw new Error(
    'Bot authentication did not match the intended test workspace.',
  );

const values = {
  SLACK_SIGNING_SECRET: secrets.SLACK_SIGNING_SECRET,
  SLACK_BOT_TOKEN: botToken,
  SLACK_BOT_WORKSPACE_ID: secrets.SLACK_BOT_WORKSPACE_ID,
  PUBLIC_ORIGIN: secrets.PUBLIC_ORIGIN,
  CALENDAR_SIGNING_KEY: secrets.CALENDAR_SIGNING_KEY,
};
await writeFile(secretsPath, `${JSON.stringify(values, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(secretsPath, 0o600);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(
      `Test deployment step failed: ${command} ${args.join(' ')}`,
    );
}
run('npm', ['run', 'build']);
run('npx', ['wrangler', 'secret', 'bulk', secretsPath, '--env', 'test']);
run('npx', ['wrangler', 'deploy', '--env', 'test']);
console.log(
  'Test Worker deployed with the verified test bot; no credentials printed.',
);
