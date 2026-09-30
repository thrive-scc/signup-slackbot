import process from 'node:process';
import { localCommand } from './local-slack.mjs';
const text = process.argv.slice(2).join(' ');
if (!text)
  throw new Error('Supply a command, e.g. npm run demo:command -- list');
process.stdout.write((await localCommand(text)) + '\n');
