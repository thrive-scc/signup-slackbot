# Milestone 2 — signup lifecycle

## Status and remaining decision

Availability, own-signup lists, guided Slack controls, lifecycle transactions,
NO_SNACK administration, audit records, and durable notifications are implemented.
Cancellation and date changes are exercised with a class-start cutoff in the
disposable test entry. **The normal local and deployable entries do not yet enable
volunteer cancellation/date changes:** the product cutoff decision is still pending.
This is not a completed release until that policy is selected and the entry points
are wired to it. The proposed policy closes both operations at the original class's
start; a move's destination must always be a future class.

Production admin authentication and real Slack/calendar-import verification remain
outstanding. No deployment is performed by the development commands.

## Behavior

| Command                                | Result                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `/snack`, `/snack list`, `/snack help` | Next eight weekly classes, including OPEN, ASSIGNED and NO_SNACK    |
| `/snack signup YYYY-MM-DD`             | Existing atomic signup with calendar download                       |
| `/snack mine`                          | Your current/future commitments for this group, with calendar links |
| `/snack mine 2`                        | Next page when you have more than eight commitments                 |
| `/snack cancel YYYY-MM-DD`             | Cancel your own commitment, once the cutoff policy is enabled       |
| `/snack change YYYY-MM-DD YYYY-MM-DD`  | Atomically move your own commitment, once enabled                   |

Eight classes is a display window, not a signup horizon. Dated commands can claim
any valid future class. Own-signup pages include assignments through their saved
class end instant. Availability excludes a class at/after its start instant.
Listings do not create database rows; a missing occurrence on the configured
cadence remains implicitly OPEN. Different groups can meet on different weekdays.

With a bot token configured for the group's workspace, availability includes
**Bring snacks** buttons. The own-signup view includes cancellation buttons and
date selectors when the cutoff policy is enabled. Controls carry assignment IDs,
so a stale control cannot remove a replacement commitment. Buttons/selectors still
revalidate ownership, cadence, time, and availability on the server. Unsupported
or ambiguous workspace/channel mappings never select a group implicitly.

The admin page shows the next eight classes and all three effective states.
**Mark no snack** asks for confirmation and explains when it will cancel an
assignment. **Open signup** reopens an exception without restoring the former
volunteer. Writes compare the displayed state/assignment with current D1 state;
a conflict refreshes the page for review. An uncertain response retains the same
request ID for retry, including if the server committed before the response was
lost. Admin actor identity comes from the server authentication boundary.
Local development uses the explicit identity `development:local-admin`.

Calendar downloads for cancelled/replaced assignments return 404. Imported calendar
events remain fire-and-forget and require manual deletion or replacement.

## Persistence and delivery

`0003_lifecycle.sql` preserves existing class data, receipts and activity while
extending the receipt/activity vocabularies and adding `deliveries`. No new database,
queue service, or runtime dependency is introduced.

Each lifecycle write uses one D1 batch. The operation receipt gates all writes to
the winning attempt. Moves claim the destination and release the original in that
same batch; a taken/NO_SNACK destination leaves the original unchanged. Mutation,
audit, and required notification/reply intent commit or roll back together.
Receipts preserve original outcomes on exact retry, even after the cutoff or a
later legitimate signup. Actor, operation, dates and expected state must match.
Activity retains both source/destination dates and prior assignment/volunteer IDs.

Slash commands return private HTTP confirmations directly. Slack Block Kit actions
require a separate message: an empty acknowledgment alone does not display text.
Accepted interactive mutations atomically enqueue a private confirmation, then
`waitUntil` starts delivery outside the acknowledgment path. Replies use
`chat.postEphemeral`; admin cancellation notices use `chat.postMessage` to the
affected user's app conversation. Transient validation guidance is best effort
and does not create a durable mutation record. A volunteer can always inspect
`/snack mine` if a private reply is missing. Slack ephemeral delivery is inherently
session dependent, so a successful API response does not prove the person saw it.

The same Worker has a once-per-minute cron for **delivery recovery only**. It
does not generate Thursday reminders or class-start messages. Each pass attempts
at most four jobs, using atomic claims, 60-second expiring leases and a five-second
HTTP timeout. There are at most five attempts, with exponential backoff starting
at 30 seconds and Slack's `Retry-After` respected. Interactive replies expire after
30 minutes; cancellation notices after 24 hours. Expired/exhausted work remains
FAILED for inspection. These are M2 delivery lifetimes, not the still-unresolved
M3 scheduled catch-up policy. Permanent errors stop retries; missing configuration
retains pending work until expiry. Error categories contain no raw response bodies,
tokens, response URLs, or exception details.

A crash or timeout after Slack accepts a message can still produce a duplicate
on retry. SENT means Slack accepted the API call, not that a human saw it.
Cancellation notices describe the historical cancellation and direct the recipient
to their current signups, even if the class has since reopened.

## Local demonstration

Stop the development server before the aggregate check on the small Colima VM:

```sh
sh scripts/dev.sh stop
sh scripts/dev.sh run npm run verify
sh scripts/dev.sh run npm run setup:demo
sh scripts/dev.sh start
```

In another terminal, use the synthetic workspace/channel/user against the local
Worker. These commands never contact Slack:

```sh
docker exec snack-signup-harness npm run demo:command -- list
docker exec snack-signup-harness npm run demo:command -- signup 2026-09-27
docker exec snack-signup-harness npm run demo:command -- mine
```

Choose future sample-group Sundays if the example dates have passed. Open
<http://localhost:5173>, mark a class NO_SNACK, confirm its status, then reopen it.
An assigned class loses its volunteer; a notification stays pending without bot
credentials. Existing imported calendar events are not changed.

After the cutoff decision is enabled, the volunteer portion can also be exercised:

```sh
docker exec snack-signup-harness npm run demo:command -- change 2026-09-27 2026-10-04
docker exec snack-signup-harness npm run demo:command -- cancel 2026-10-04
```

Inspect local records at <http://localhost:8787/cdn-cgi/local/explorer>:

```sql
SELECT local_date, status, volunteer_user_id, assignment_id FROM classes;
SELECT occurred_at, kind, local_date, target_date, actor_user_id,
       previous_volunteer_id, outcome FROM activity ORDER BY id DESC;
SELECT id, kind, status, attempts, available_at, expires_at, last_error
FROM deliveries ORDER BY id DESC;
```

Wrangler does not fire cron automatically in development. A deliberate local pass
is `curl http://localhost:8787/__scheduled`. With no bot token this only marks pending
work as unconfigured; it does not send anything. Failed-delivery management UI and
retention/cleanup remain M4 work.

## Slack configuration and live evidence

Slack's free plan permits up to ten third-party or custom app installations.
This project uses one modern custom Slack app, hosted on Cloudflare. It does not
require Workflow Builder or Slack-hosted app deployment. Before a live smoke test,
verify that the intended workspace has an available app slot and that its owner
permits installation. This is a workspace prerequisite, not evidence that our app
has already been installed or tested there. See Slack's
[free-workspace limits](https://slack.com/help/articles/115002422943-Usage-limits-for-free-workspaces)
and [plan feature matrix](https://slack.com/help/articles/115003205446-Slack-plans-and-features).

On 2026-09-25, `npm run verify` passed 14 unit tests, 66 real local Worker/D1
integration tests and seven Chromium tests, as well as formatting, lint, Svelte/TS
checks and the production dry-run build. Desktop/mobile lifecycle screenshots were
visually reviewed. Coverage includes concurrent moves, source preservation on
conflict, ownership/stale controls, exact retries, audit/outbox rollback, signed
actions, delayed outbound API responses, rate limits, timeouts, lease recovery,
permanent failures, local cadence/DST dates and the rendered admin flow.

The browser recovery check commits an actual admin mutation and deliberately drops
its HTTP response, then retries through the UI. It also races a loaded admin page
against a separate signup. Those checks use a real local Worker/D1, while outbound
Slack delivery uses a fake transport. A one-time upgrade check applied migration
0003 to the persistent local database and compared the original columns before
and after: one group, one class, two receipts and three activity records survived
unchanged. Test databases remain separate from that development data.

On 2026-09-30, the full check passed again with 14 unit, 66 integration and eight
Chromium tests. The added test exercises actual admin writes through Vite's
development proxy and rejects cross-origin requests. The proxy now preserves the
browser's Host header so the Worker's existing same-origin check works in both
development and the built preview. Production authentication behavior is unchanged.

The manifest now requests `commands` and `chat:write` and declares
`/slack/interactions`. Replace both placeholder HTTPS URLs in the intended test
installation, reinstall for the added scope, and invite the bot to the group
channel. Configure `SLACK_BOT_TOKEN` and `SLACK_BOT_WORKSPACE_ID` in addition to
the signing secret, calendar key, and public origin. There is one bot installation
per deployment; multiple groups in that workspace remain possible. Multi-workspace
OAuth/token management is deliberately absent. No channel-history scope is requested.

Keep the development admin bypass off public tunnels. The production entry still
denies admin assets and APIs; this change does not implement personal-account auth.

In a deliberate real-service smoke test, exercise private command responses,
buttons/selectors and their confirmations, competing claims, admin cancellation
notices, and calendar import across a DST boundary. Measure Slack's real ACK
latency and inspect delivery results. Local fake-transport and Chromium checks
do not establish those real-service outcomes.

Sources: [Slack interaction acknowledgments](https://docs.slack.dev/interactivity/handling-user-interaction/),
[private message delivery](https://docs.slack.dev/reference/methods/chat.postEphemeral/),
[posting to a user's app conversation](https://docs.slack.dev/reference/methods/chat.postMessage/),
[Slack rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).
