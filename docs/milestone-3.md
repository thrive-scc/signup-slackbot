# Milestone 3 — scheduled messages

## Behavior and accepted policies

On 2026-09-30 the user accepted these timing rules:

- Reminders run three **calendar days** before class at 15:00 in the group's
  timezone. Thrive's Sunday class produces Thursday 15:00, even when DST changes
  the offset before Sunday. `life_groups.reminder_days_before` and `reminder_time`
  hold the configuration; no group-edit UI is introduced.
- Missed reminders may catch up until class starts. Class-start channel posts may
  catch up for one hour. Both stop after five attempts; the expiry boundary is
  exclusive, so a reminder cannot start sending exactly at class start.
- Volunteer cancellation/date changes close at the original class start. Both
  normal entry points now enable this M2 behavior. A move's destination must
  always be a future class; a committed request can still replay after the cutoff.

The existing once-per-minute Worker cron discovers due work and recovers pending
messages. It uses the injected current clock, not the trigger's timestamp, so an
old trigger does not send expired messages. Local Wrangler requires manual cron
invocation. No message is sent before its due time.

A reminder DM names the group, date, start time and timezone and directs the
volunteer to `/snack mine` in the group's channel. Only an assignment made before
its reminder instant is eligible. A signup or date change at/after that instant
gets an explicit reminder in its confirmation instead of another cron DM.
This includes retrying a successful signup confirmation.

Every class-start post includes the following weekly class's status. It thanks
an assigned volunteer for their commitment, says when today has no volunteer,
or states that no snacks are needed. It never asserts that food was brought or
that an explicitly NO_SNACK class is meeting. Next week's ASSIGNED, OPEN and
NO_SNACK are all reported. A missing class row on the weekly cadence is OPEN;
listing or posting does not create an empty row.

## Persistence and delivery

Migration `0004_scheduling.sql` adds group reminder fields and rebuilds
`deliveries`, preserving existing IDs, receipts, statuses, retry counts and leases.
The replacement table is renamed back to `deliveries`. There are no new production
services, databases, runtime dependencies or permanent replacement-table names.

Scheduled jobs have no operation receipt. Partial unique indexes enforce one
CLASS_START job per group/date and one REMINDER per group/assignment. Producers
use conditional inserts; repeated or competing passes cannot create a second
logical job. Reminder insertion rechecks the assignment in D1. Enqueuing does not
change signup state or create synthetic user activity.

Before delivery, a reminder's assignment ID must still match the current class.
Cancellation, a move, or NO_SNACK makes its work SKIPPED with STALE_ASSIGNMENT;
even the same person signing up again has a new assignment ID. Channel messages
read today's and next week's effective states during preparation. A mismatched
saved schedule is not silently moved to a new time.

All messages share the existing four-attempts-per-pass budget, 60-second leases,
five-second HTTP timeout and maximum of five attempts per job. Backoff starts at
30 seconds and honors Slack Retry-After. A durable wait deadline also applies to
newly enqueued workspace jobs, even after the originally limited job expires or
is skipped. Missing credentials retain pending work until expiry without using
attempts. Permanent rejection stops retries. Expired/exhausted jobs remain FAILED;
SENT means Slack accepted the API call, not that a person saw it.

There is no exactly-once guarantee across D1 and Slack. A crash after Slack accepts
an API call can cause a duplicate on retry. A cancellation racing with an external
send cannot recall a message already accepted by Slack. Status is checked as late
as practical, without holding a database transaction open across network calls.

Class-start discovery covers the current and previous local date, allowing the
one-hour window to cross midnight. Reminder discovery reads current/future
assignments and derives each due instant. There is no indefinite backfill: if the
service is down for the whole expiry window, the missed message is not created
later. A job already created retains its failed/expired delivery record.

Ambiguous or nonexistent local times fail visibly; they are never shifted to a
chosen DST offset. Reminder instants must precede class start. New signup/move
operations validate this before mutation. Invalid group configuration or a D1
failure emits a sanitized SCHEDULE_PROCESSING_FAILED group identifier, makes the
cron invocation fail, and still permits other groups and pending deliveries to
be processed. Group schedule editing remains unsupported; do not edit a schedule
behind active commitments. A deliberate schedule-edit workflow belongs in a later
story with explicit treatment of existing assignments.

## Reproducible local validation

With Docker running, stop any live development container before the full check:

```sh
sh scripts/dev.sh run npm run verify
```

For the scheduling acceptance scenarios alone (after a build on a fresh checkout):

```sh
sh scripts/dev.sh run npm run test:integration -- tests/integration/scheduling.test.ts tests/integration/scheduling-migration.test.ts
```

These execute actual local Worker/D1 operations using fixed clocks and a fake Slack
transport that cannot fall back to the network. Scenarios include:

- Thursday exact-time and competing/repeated cron passes.
- OPEN/NO_SNACK and cancellation before Thursday; cancellation, move and NO_SNACK
  after enqueue; cancellation followed by another signup by the same person.
- Late signed signup and late move confirmations without another reminder DM.
- Class-start posts for all effective states, including no database row, and
  next-class updates made between enqueue and send.
- Missed runs, exact expiry boundaries, five-attempt exhaustion, lease recovery,
  timeouts, rate limits and a newly enqueued job during Retry-After.
- Another group's weekday, reminder settings and channel; visible isolated group
  configuration failures; database constraints exercised directly.
- Actual pre-M3 schema migration with an existing leased job, signup receipt,
  class and activity record; values and foreign keys checked afterward.
- Normal local and production entry points accepting own cancellation before start.

Unit tests specify independent UTC expectations across both Chicago DST changes:
March 5 at 21:00Z → March 8 at 14:30Z, and October 29 at 20:00Z → November 1 at
15:30Z. They also cover midnight catch-up and ambiguous/nonexistent reminder times.

For inspection of persistent development data, start the app, which applies the
migration while preserving the existing sample group:

```sh
sh scripts/dev.sh start
```

Open <http://localhost:8787/cdn-cgi/local/explorer> and inspect:

```sql
SELECT id, timezone, weekday, start_time, reminder_days_before, reminder_time
FROM life_groups;
SELECT id, kind, local_date, assignment_id, status, attempts, scheduled_at,
       available_at, expires_at, retry_after_until, last_error
FROM deliveries ORDER BY id DESC;
```

A deliberate local tick is `curl http://localhost:8787/__scheduled`. It uses the
actual current time. Without a bot token it can enqueue due work and record missing
configuration, but cannot send to Slack. Do not supply a fake timestamp expecting
to override the application clock or send an old reminder.

## Evidence limits and production follow-up

On 2026-09-30 the full local validation passed: formatting, lint, Svelte/TypeScript
checks, the production dry-run build, 23 unit tests, 88 Worker/D1 integration
tests and eight Chromium tests. This establishes completion of the M3 local
implementation, including the accepted M2 cutoff wiring.

A separate Wrangler HTTP smoke check used disposable D1, a fixed class-start
clock and empty Slack credentials. Two calls to its actual local scheduled URL
produced one pending CLASS_START job for an implicit OPEN class, zero class rows,
and SLACK_NOT_CONFIGURED with no delivery attempts. The temporary database/server
were removed afterward; persistent development data was not changed.

The local suite exercises actual D1 and Worker execution; outbound Slack is fake.
No production deployment, live Slack reminder/channel post, real calendar import,
or hosted cron timing has been verified. Personal-account admin authentication,
retention, delivery/history UI and deployment/smoke instructions remain M4 work.
Production admin pages and APIs still fail closed.

Before live use, configure the intended workspace's bot token, invite it to the
configured channel, and deliberately verify a reminder DM and class-start post
in that test channel. Confirm mentions, next-class status, real HTTP latency,
cron timing and the visible delivery result. Do not expose the local admin entry
through a public tunnel.

Integration references: [Cloudflare cron documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [Slack message API](https://docs.slack.dev/reference/methods/chat.postMessage/).
