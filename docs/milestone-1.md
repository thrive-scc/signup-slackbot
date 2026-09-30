# Milestone 1 — local implementation

This records the first-slice baseline. Lifecycle additions, configuration changes
and remaining decisions are now described in [Milestone 2](milestone-2.md).

## Behavior

Run `/snack signup YYYY-MM-DD` in the configured life group's Slack channel.
Anyone in that workspace can volunteer; no separate membership lookup is made.
DMs and unconfigured channels explain where to use the command. Ambiguous group
mappings fail visibly. Empty input, `help`, and unsupported syntax show guidance.

Dates must be valid, on the group's cadence, and on/after its schedule start date.
An absent class row is implicitly OPEN. Signup closes at the class start instant
in the group's timezone. These eligibility/context and cutoff policies were
accepted on 2026-09-22.

A successful command returns a private confirmation that restates the commitment's
date, time and timezone, including for late signups. It includes a signed calendar
download link and the admin-visibility notice. Taken and NO_SNACK dates return
clear explanations. The admin page displays the new assignment after Refresh.

This first slice uses a deterministic dated slash command. Selectors, availability,
own-signup views, cancellation, changing dates and NO_SNACK administration remain
Milestone 2. The confirmation explicitly explains that lifecycle commands are
not available yet.

## Persistence and boundaries

The signup application operation is independent of Slack and D1. It resolves and
validates the group, checks cadence and cutoff, then calls the atomic claim port.

One D1 batch claims an absent/OPEN class, finalizes its operation receipt and
records the outcome. A unique attempt identifier gates every write on concurrent
retries. Database constraints enforce class uniqueness and state consistency.
Conflicts never replace a volunteer. Audit failure rolls back the whole batch.

Idempotency uses a hash of the signed raw body, which includes Slack's unique
invocation trigger, scoped to the group. No raw command, response URL or signing
material is stored. Exact-body retries recover the receipt before the cutoff
check. A fresh invocation for the same user's existing assignment returns its
existing calendar link. It is a distinct operation, not another commitment.

Slack signature verification checks the raw UTF-8 body and five-minute timestamp
freshness. Workspace/channel context is checked before business operations.
Confirmation is the HTTP response itself: no outbound Slack API, bot token or
outbox is needed for this slice. A database error reports an uncertain outcome
and safe retry instructions; it never claims that a possible commit rolled back.
If Slack loses the response after D1 commits, the assignment remains authoritative.

Assignments save UTC start/end instants. Calendar generation uses these snapshots
and a stable UID, with escaped text and RFC line folding. The Temporal polyfill
handles DST; unsupported ambiguous/nonexistent times and overnight schedules fail
visibly. Schedule edits are not implemented.

Signed calendar GETs are independent of admin authentication and recorded as
activity. No bearer token, full URL, IP or inferred requester identity is stored.
A download does not establish calendar import. Missing configuration fails closed;
invalid or obsolete links return 404. Rotating the signing key invalidates links.

Production admin access remains denied. Only the explicitly selected development
and disposable browser-test entries bypass admin authentication; never deploy them.

## Reproduce the local path

Run the aggregate checks:

```sh
sh scripts/dev.sh run npm run verify
```

Stop the live development container before a full check on a small Colima VM:
running development and all test servers together exhausted the observed 2 GB VM.
The test database is disposable and separate from development state.

For an interactive local demonstration, generate local-only keys once:

```sh
sh scripts/dev.sh run npm run setup:demo
sh scripts/dev.sh start
```

The setup command creates ignored `.dev.vars` with random keys and leaves any
existing file unchanged. Restart the Worker after creating/changing that file.
With the development container running, use another terminal:

```sh
docker exec snack-signup-harness npm run demo:signup -- 2026-09-27
```

Choose a future Sunday for the sample group if that date has passed. The script
sends a signed synthetic command only to the container's loopback Worker. It uses
the sample workspace/channel/user IDs. It does not call Slack. Open the returned
calendar link, then visit <http://localhost:5173> and click Refresh. This creates
a real sample assignment in persistent development D1; repeating it recovers
that commitment. It does not insert a prebuilt assignment fixture.

Inspect useful activity in Local Explorer:

```sql
SELECT local_date, status, volunteer_user_id FROM classes;
SELECT occurred_at, kind, local_date, actor_user_id, outcome
FROM activity ORDER BY id DESC;
```

## Automated evidence and limits

On 2026-09-22, the aggregate check passed 11 unit tests, 39 local Worker/D1
integration tests and five Chromium tests, plus formatting, lint, types and the
production dry-run build. Desktop/mobile screenshots were visually reviewed.
The full run also passed after generating local demo configuration.

The full browser acceptance test submits a signed HTTP command to a bundled
Worker with a deterministic clock and real local D1. It verifies a response
within three seconds locally, downloads the confirmation's file in Chromium,
parses its times independently with ICAL.js, refreshes the real admin UI and
checks the assignment at desktop/mobile widths. Screenshots are saved under
`test-results/`. Browser servers explicitly load fixture configuration; integration tests override
the signup secret bindings.

Integration coverage includes concurrent signed requests/retries, group isolation,
NO_SNACK, off-cadence/invalid dates, unauthorized contexts, exact cutoff and retry
recovery after cutoff, safe storage failures, direct SQL invariants, and atomic
audit rollback. Calendar tests check both 2026 Chicago DST transitions. Slack's
published HMAC vector independently validates the signature implementation.

No deployed Slack invocation, real calendar import or production admin login has
been demonstrated. Local timing is not evidence of Slack's end-to-end latency,
Cloudflare CPU usage or cold starts.

## Real-service smoke test still required

The checked-in `slack-app-manifest.json` needs its placeholder URL replaced with
your HTTPS `/slack/commands` endpoint before installation in the intended test
workspace. It requests only the `commands` scope, with no channel-history access.
Configure the real group workspace/channel IDs, Slack signing secret, an
independent calendar signing key and the public HTTPS origin. Keep secrets in
Worker secrets (or ignored `.dev.vars` for a deliberate local tunnel test).
Do not expose the development admin bypass through a tunnel. Production admin
authentication must be implemented before shared admin use.

In the designated workspace/channel, invoke the command, verify private
confirmation and timing, download/import the calendar into a test calendar, and
check local date/time and title. Exercise an already-taken date and an exact
retry, verify one assignment/audit, and check its admin display once authenticated
admin access exists. Capture evidence of this separate real-service run. No
deployment or real Slack messages are sent by the local scripts.

Sources: [Slack commands](https://docs.slack.dev/interactivity/implementing-slash-commands/),
[Slack signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[Slack manifest](https://docs.slack.dev/reference/app-manifest/),
[Temporal polyfill](https://github.com/js-temporal/temporal-polyfill),
[ICAL.js](https://github.com/kewisch/ical.js).
