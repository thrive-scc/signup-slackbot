import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const origin = new URL(process.argv[2]);
if (
  origin.protocol !== 'https:' ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== '/'
)
  throw new Error(
    'Supply the test Worker HTTPS origin with no path or credentials.',
  );
const manifest = JSON.parse(await readFile('slack-app-manifest.json', 'utf8'));
manifest.display_information.name = 'Snack signup (test)';
manifest.features.bot_user.display_name = 'Snack signup (test)';
manifest.features.slash_commands[0].url = `${origin.origin}/slack/commands`;
manifest.settings.interactivity.request_url = `${origin.origin}/slack/interactions`;
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
