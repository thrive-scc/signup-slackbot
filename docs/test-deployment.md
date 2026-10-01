# Cloudflare and Slack test deployment

This is the current pilot deployment, separate from persistent local D1. Its
existing resource names and Wrangler environment retain `test` for continuity.
Always select `--env test` and, for D1, `--remote`. Automated tests continue to
use disposable local storage and synthetic Slack credentials.

## Resources

| Resource  | Test value                                                 |
| --------- | ---------------------------------------------------------- |
| Worker    | `snack-signup-bot-test`                                    |
| Origin    | `https://snack-signup-bot-test.adam-lindell.workers.dev`   |
| D1        | `snack-signup-test`                                        |
| Workspace | Test Thrive Slack — `thrivescc.slack.com`, `T03PJ6WU2`     |
| Channel   | `#general`, `C03PJ6X08`                                    |
| Group     | `thrive-test`, Thrive, Sundays 09:30–11:45 America/Chicago |

The installed Slack app is **Snack signup (test)**, `A0C5T9473RQ`.

The deployable entry remains `worker/index.ts`. Admin pages, assets and APIs
return 503 until personal-account authentication is implemented. Never deploy
`worker/local.ts` or enable a remote admin bypass to demonstrate the UI.

## Account access and deployment

Node tooling stays in Docker. The dedicated launcher persists Wrangler login in
the `snack-cloudflare-auth` volume, separate from the offline development harness.
It does not mount local D1 data or the Docker socket.

```sh
sh scripts/dev.sh build
sh scripts/dev.sh run npm ci
sh scripts/dev.sh run npm run verify
sh scripts/cloudflare.sh npx wrangler login --device --browser=false --scopes account:read user:read workers_scripts:write d1:write
sh scripts/cloudflare.sh npx wrangler whoami
```

Follow the device authorization instructions in the browser. These scopes worked
for the test deployment; Wrangler's warning about other expected scopes does not
mean unrelated permissions need to be added. Login automatically includes
background access. Inspect the account before creating or changing resources.

The test database has already been created and its ID is in `wrangler.jsonc`.
For a different account, create a new database and replace only the test binding.
Do not reuse the local synthetic fixture as a remote seed.

```sh
sh scripts/cloudflare.sh npx wrangler d1 migrations apply DB --env test --remote
sh scripts/cloudflare.sh npx wrangler d1 execute DB --env test --remote --file scripts/seed-test.sql
sh scripts/dev.sh run npm run build
sh scripts/cloudflare.sh npx wrangler deploy --env test
```

The seed inserts only the configured test group if absent. It does not create
class rows or overwrite an existing schedule. Read the seed before applying it.
Deployment installs the once-per-minute cron; normal Thursday/Sunday processing
uses the real clock. Local development does not automatically dispatch cron.

## GitHub deployment

`.github/workflows/check.yml` validates pushes and pull requests using the Docker
harness. Only a push to `main`, after successful verification of that revision,
runs the `deploy-pilot` job. It applies migrations and deploys with explicit
`--env test`, then checks health and the closed admin boundary. Concurrent pilot
deployments are serialized; a deployment already running is not interrupted.
It does not seed groups, rotate Worker secrets, or modify the Slack app manifest.
Manifest changes still require the Slack CLI sync/deploy workflow below.

Before activating this job, create a GitHub environment named `pilot` in
`thrive-scc/signup-slackbot` with:

| Kind                 | Name                    | Value                                                                 |
| -------------------- | ----------------------- | --------------------------------------------------------------------- |
| Environment variable | `CLOUDFLARE_ACCOUNT_ID` | `aaabb8260543ace8321b5b25d389ec09`                                    |
| Environment secret   | `CLOUDFLARE_API_TOKEN`  | An account-scoped token permitting Worker deployment and D1 migration |

Restrict the environment to `main`. Keep Slack tokens, signing secrets and the
calendar key in Worker secrets; GitHub does not need them for ordinary deploys.
Do not copy the container's personal OAuth credentials into GitHub. Follow
Cloudflare's [GitHub deployment guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
for API-token authentication and GitHub's [environment controls](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Acceptance requires a real main push: see verification succeed, see deployment
succeed for the same commit, and confirm a visible pilot change. A failing check
must leave deployment skipped. This has not yet been demonstrated on GitHub.
The workflow cannot deploy until those environment settings are configured and
the repository change is pushed.

Future `test` and `production` GitHub environments must target separate Wrangler
environments, Workers, D1 databases and secrets. Do not repurpose the pilot's
database as production. Production requires an explicit rollout policy and
working admin authentication before release. Environment protections depend on
the repository's GitHub plan; verify approval availability when provisioning it.

## Slack installation and credentials

Generate a manifest using the actual deployed HTTPS origin:

```sh
sh scripts/dev.sh run node scripts/slack-manifest.mjs https://snack-signup-bot-test.adam-lindell.workers.dev
```

The user-configured native Slack CLI is authorized for Test Thrive Slack. The
checked-in `.slack/hooks.json` provides the manifest through Docker without
installing a host Node runtime or adding a Slack SDK. CLI-created app links and
cache files are ignored. The two bot scopes are `commands` and `chat:write`;
there are no channel-history scopes. The manifest sets `/snack` and interactivity
to the deployed Worker endpoints.

```sh
slack auth list
slack manifest info --source local --team T03PJ6WU2
slack app install --team T03PJ6WU2 --environment deployed
slack app list --team T03PJ6WU2
```

The app is already installed; do not create another copy. In a fresh checkout,
link `A0C5T9473RQ` using `slack app link` before installing. Invite
**Snack signup (test)** to `#general` using Slack's channel controls.

If the private credentials file does not exist, initialize it once. This refuses
to overwrite existing credentials or rotate a calendar key unintentionally:

```sh
sh scripts/dev.sh run node --input-type=module -e '
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const values = {
  SLACK_SIGNING_SECRET: "PASTE_SIGNING_SECRET_HERE",
  SLACK_BOT_TOKEN: "SUPPLIED_BY_SLACK_CLI",
  SLACK_BOT_WORKSPACE_ID: "T03PJ6WU2",
  PUBLIC_ORIGIN: "https://snack-signup-bot-test.adam-lindell.workers.dev",
  CALENDAR_SIGNING_KEY: randomBytes(32).toString("base64url")
};
await writeFile(".env.test-secrets.json", JSON.stringify(values, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
'
```

Copy the app's signing secret from Basic Information into the ignored, private
`.env.test-secrets.json` file. The existing-app manifest API does not return this
secret. The Slack CLI supplies the bot token directly to the deployment hook;
there is no need to copy it manually.
Do not paste tokens into chat, commit them, or use synthetic demo keys. Required
keys are `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_BOT_WORKSPACE_ID`,
`PUBLIC_ORIGIN`, and a fresh random `CALENDAR_SIGNING_KEY`. Workspace and origin
must match the values above. The deployment hook verifies the bot's workspace,
builds the Worker, saves private credentials, uploads Worker secrets and deploys
only the `test` environment. Run it through the Slack CLI:

```sh
slack deploy --app A0C5T9473RQ --team T03PJ6WU2
sh scripts/cloudflare.sh npx wrangler secret list --env test
```

The list reports names, not values. Worker secrets persist across normal deploys.
Keep the local file private; losing a calendar signing key invalidates old links.
To remove stored Cloudflare account authorization, log out and remove its volume
when no launcher container uses it:

```sh
sh scripts/cloudflare.sh npx wrangler logout
docker volume rm snack-cloudflare-auth
```

## Deliberate real-service smoke test

Use only this test workspace/channel. The workflow sends actual Slack messages
and stores test activity; it is not part of offline automated verification.

1. Check `/health` returns 200 and unauthenticated admin access returns 503.
2. Run `/snack` in `#general`; upcoming weekly dates should be OPEN.
3. Sign up through a button for a future date; verify confirmation, `/snack mine`,
   and exactly one D1 assignment. Download the calendar and inspect its event.
4. Cancel only the test signup made for this check, then sign up for another date
   through the availability list. Verify cancelled dates are OPEN. An off-cadence
   signup must fail visibly. Legacy direct change commands can be checked separately.
5. Inspect only bot-related D1 activity and delivery outcomes. Confirm scheduled
   reminder/class-start behavior separately when a real trigger is due; deployment
   of a cron schedule alone does not prove message delivery.

```sh
sh scripts/cloudflare.sh npx wrangler d1 execute DB --env test --remote --command "SELECT life_group_id, local_date, status, volunteer_user_id FROM classes;"
sh scripts/cloudflare.sh npx wrangler d1 execute DB --env test --remote --command "SELECT kind, status, attempts, last_error FROM deliveries ORDER BY id DESC LIMIT 20;"
```

Calendar download links are bearer credentials. Keep full URLs/tokens out of
diagnostic output; the structured download activity supplies useful evidence.
A successful download does not demonstrate import into a real calendar client.

## Evidence as of 2026-09-30

- Cloudflare account authorization completed inside the deployment container.
- Isolated D1 created; all four migrations applied and the test group seeded.
- Worker and once-per-minute cron deployed using the normal entry.
- Deployed HTTP checks: `/health` 200; admin endpoint 503.
- Slack CLI created/installed app `A0C5T9473RQ`; bot authentication independently
  confirmed workspace `T03PJ6WU2`.
- All required Worker secrets are configured; the bot is installed in the test
  workspace. `/snack list` and a button signup have been exercised against Slack
  and D1. An initial reply failed because the bot had not joined `#general`;
  subsequent user screenshots show delivered signup and own-signup messages.
- UX changes deployed as Worker version `e551b681-5099-482e-95de-ab564a5c33f5`.
  Live Slack verification confirmed the command listing, readable dates,
  confirmation replacing the original private message, cancellation-only own
  signups and **Add to your calendar**. A temporary Oct 18 signup was cancelled;
  existing user assignments were preserved. Its live `.ics` download was parsed
  independently and its SERVED activity recorded. Native-mobile behavior, real
  calendar import and deployed scheduled delivery remain unverified.
- GitHub automatic deployment is prepared in the workflow, pending environment
  credentials, pushing the change and a successful observed pipeline run.
- Latest pilot redeployment: `317ab08d-8707-4ac1-a29a-a6cdfe36b26e`.
  Slack CLI confirmed the manifest update and installation. Live checks returned
  health 200 and protected admin 503; signed, read-only `/snack list` and
  `/snack mine` responses confirmed readable dates, the calendar label and
  cancellation-only controls. This redeployment did not change any signups.
