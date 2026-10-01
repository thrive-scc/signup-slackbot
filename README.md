# Snack signup bot

A deterministic Slack snack coordinator, initially for Thrive. Signup, availability,
own-signup lists, calendar downloads and NO_SNACK administration use one Worker/D1
database. Volunteers can cancel or change their signups until class starts.
Milestone 3 adds reminder DMs and class-start channel posts, with DST-aware group
times and bounded retries. See [Milestone 3](docs/milestone-3.md) for the timing
rules and local demonstration, and [Milestone 2](docs/milestone-2.md) for lifecycle
behavior. Initial Slack signup/list interactions have been exercised in the pilot;
calendar import, deployed cron and production authentication remain unverified.
Milestone 4 adds Slack usability and deployment work; see
[current scope](docs/milestone-4.md). The isolated Cloudflare pilot is deployed; see
[test deployment setup and evidence](docs/test-deployment.md).
Product rules live in [AGENTS.md](AGENTS.md).

## Quick start

Prerequisite: Docker Engine running on your machine (Docker Desktop or Colima).
Compose, host Node/npm, Slack credentials, and a Cloudflare account are not required.
The initial image/dependency downloads require internet access and several GB of
Docker storage. With Colima, start it using your existing `colima start` workflow.

From the repository root:

```sh
sh scripts/dev.sh build
sh scripts/dev.sh run npm ci
sh scripts/dev.sh run npm run verify
sh scripts/dev.sh start
```

Open <http://localhost:5173>. You should see **Thrive (sample)**, Sunday,
09:30–11:45, and America/Chicago. Refresh reads the data again through the local
Worker and D1. Source edits reload the UI; Worker edits restart Wrangler.

Startup builds the static assets, applies migrations, and inserts the synthetic
group if absent. It does not overwrite existing group edits. Stop with Ctrl-C or,
from another terminal:

```sh
sh scripts/dev.sh stop
```

Ports 5173 (admin preview) and 8787 (Worker and Local Explorer) are published only
on host loopback. The prior Python starter on port 8080 is independent of this
harness. No container or toolchain is deployed to production by any command above.

## Browse and query the local database

With `sh scripts/dev.sh start` running, open
<http://localhost:8787/cdn-cgi/local/explorer>. Select the D1 binding **DB** and
use the table browser or SQL editor. For example:

```sql
SELECT * FROM life_groups;
```

This is the same persistent development database used by the app. Edits here
change local development data. No Cloudflare login is required.

If you started the container before port 8787 was added, stop it with
`sh scripts/dev.sh stop` and start it again to apply the port mapping. The named
database volume is preserved.

## Commands

Run project commands inside Docker using `sh scripts/dev.sh run ...`. Stop the
live development container before a full check on a 2 GB Colima VM to avoid
running development servers and browser-test servers together.

| Command after `run`        | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `npm ci`                   | Install exactly the lockfile; stop development before reinstalling            |
| `npm run verify`           | Formatting, lint, UI/Worker types, unit tests, build, D1 tests, browser tests |
| `npm run format`           | Format repository files                                                       |
| `npm run lint`             | Lint code and check domain dependency/clock boundaries                        |
| `npm run check`            | Generate runtime types and check TypeScript/Svelte                            |
| `npm run test:unit`        | Deterministic application and synthetic Slack-fixture tests                   |
| `npm run build`            | Static SvelteKit build and Worker dry-run bundle; never deploys               |
| `npm run test:integration` | Worker-runtime/D1 tests; run `npm run build` first on a fresh checkout        |
| `npm run test:e2e`         | Build and run Chromium against locally bundled Workers                        |
| `npm run db:migrate:local` | Apply SQL migrations to persistent development D1                             |
| `npm run db:seed:local`    | Insert the synthetic group if absent                                          |

The aggregate check executes a build before integration/browser tests so no stale
or missing asset output is assumed. CI uses the same Docker launcher and commands.
Failed browser tests retain traces/screenshots under `test-results/`; successful
browser checks also save desktop/mobile previews there.

## Storage and isolation

Source is bind-mounted for editing. Node, npm, Wrangler, Chromium, and their
system libraries run inside the development image. The container uses root for
local tooling and Chromium tests against our own app; this is not a production
container or a browser for untrusted sites. It does not mount the Docker socket.

| Docker volume           | Contents                              |
| ----------------------- | ------------------------------------- |
| `snack-harness-modules` | Project dependencies (`node_modules`) |
| `snack-harness-state`   | Persistent local D1 at `/state/dev`   |
| `snack-harness-npm`     | Download cache                        |

An empty `node_modules` mount-point directory may appear on the host; package
contents are in Docker. Generated builds, type declarations, and test reports are
ignored workspace files so editors and reviewers can inspect them.

Integration tests use temporary test storage. Browser tests create a unique
temporary D1 directory inside their disposable container. Neither uses `/state/dev`.
Do not point automated tests at the development or a remote database.

To remove cached dependencies, stop containers using them and explicitly run:

```sh
docker volume rm snack-harness-modules snack-harness-npm
```

To **erase local development data**, stop the harness and explicitly run:

```sh
docker volume rm snack-harness-state
```

The next startup recreates/migrates/seeds it. Do not use broad Docker pruning to
clean up this project. The image can be removed separately with
`docker image rm snack-signup-harness:dev`.

## Configuration and secrets

The admin preview needs no secrets. `wrangler.jsonc` holds nonsecret binding declarations
and a deliberately invalid remote database ID; every database command specifies
`--local`. A once-per-minute cron discovers due reminders/class-start posts and
recovers pending deliveries. Local cron dispatch is manual; no development
command deploys the app.

`.env.example` describes the UI boundary. `.dev.vars.example` documents
Worker configuration; real values go in ignored `.dev.vars` locally and
Cloudflare Worker secrets when deployed. Never put credentials into public Vite
variables, fixtures, source, or logs. CI needs no account tokens.

Signup requires `SLACK_SIGNING_SECRET`, `CALENDAR_SIGNING_KEY`, and `PUBLIC_ORIGIN`.
The public origin is explicit (never inferred from incoming request headers):
HTTPS for real use, or HTTP loopback for local development. Missing/invalid
configuration returns 503 before any signup. Slash commands need no bot token.
Guided controls, admin cancellation notices and scheduled messages additionally require
`SLACK_BOT_TOKEN` and `SLACK_BOT_WORKSPACE_ID`; invite the bot to its group channel.
Missing credentials leave durable notification work pending until its expiry.
See [the local signup demonstration](docs/milestone-1.md#reproduce-the-local-path)
for generating ignored local-only keys and submitting a signed sample command.
Tests explicitly inject synthetic keys and use disposable storage.

`worker/local.ts` is an explicit local-only entry point with admin access enabled.
The deployable `worker/index.ts` denies the UI, assets, and admin API with 503 until
authentication is implemented. There is no environment flag or Host-header
shortcut that enables admin access in that entry. Production authentication remains
future work. The [test deployment](docs/test-deployment.md) uses this protected
entry and separate remote D1; its admin UI is consequently unavailable.

## More context

- [Cloudflare/Slack test deployment](docs/test-deployment.md)
- [Milestone 3 scheduling, timing policies and demonstration](docs/milestone-3.md)
- [Milestone 2 behavior and demonstration](docs/milestone-2.md)
- [Milestone 1 behavior and demonstration](docs/milestone-1.md)
- [Architecture and scope](docs/architecture.md)
- [Acceptance evidence and manual validation](docs/acceptance.md)

The development image pulls the pinned official Node image from Docker Hub.
Node prefers IPv4 DNS results to avoid the Docker Hub/IPv6 connection problems
observed during initial setup.
