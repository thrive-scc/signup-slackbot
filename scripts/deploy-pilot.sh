#!/bin/sh
set -eu
# GitHub's pilot environment supplies deploy credentials, never Slack credentials.
# The existing pilot retains its historical Wrangler environment name: test.
: "${CLOUDFLARE_API_TOKEN:?Set the pilot environment's CLOUDFLARE_API_TOKEN secret}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set the pilot environment's CLOUDFLARE_ACCOUNT_ID variable}"
npm run build
npx wrangler d1 migrations apply DB --env test --remote
npx wrangler deploy --env test
node --input-type=module -e '
const origin = "https://snack-signup-bot-test.adam-lindell.workers.dev";
for (const [path, expected] of [["/health", 200], ["/api/admin/classes", 503]]) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(10000), redirect: "manual" });
  if (response.status !== expected) throw new Error(`Pilot smoke check failed for ${path}: ${response.status}`);
}
console.log("Pilot HTTP smoke checks passed. Slack delivery must be checked separately.");
'
