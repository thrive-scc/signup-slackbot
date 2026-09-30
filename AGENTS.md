# Snack signup bot — agent instructions

## Purpose and current scope

Build a small, deterministic Slack snack-signup bot, initially for Thrive,
using TypeScript, Cloudflare Workers, D1, and a lightweight SvelteKit admin UI.
Use `/snack` as the slash command. Prefer guided buttons/selectors; do not use an
LLM or sophisticated natural-language parsing.

Model life groups explicitly so scheduling and wording are not tied to Thrive
or Sundays. Start with one configured group. Do not build group onboarding,
billing, or a general multi-tenant platform without an actual requirement.

Maintainability, conceptual integrity, small validated increments, and evidence
beyond agent-written tests take priority over code volume.

## Repository state and implementation boundary

Milestones 0 and 1 are complete for local validation. Milestone 2 adds availability,
own-signup views, atomic lifecycle operations, guided Slack controls, NO_SNACK/OPEN
admin writes and durable delivery with retry/lease handling. Cancellation/date
changes are tested with a class-start cutoff in disposable tests but are NOT
enabled in the normal local/deployable entries yet: the product cutoff decision
is pending. Do not claim M2 complete until that decision is selected and wired.
See docs/milestone-2.md for current behavior, setup, and evidence limits.
Local verification and real-service evidence must be reported separately.
Inspect current code before every task. README.md is the setup guide;
docs/architecture.md and docs/acceptance.md describe current implementation and
the limits of its evidence. The product rules below also cover future milestones.

From the repository root, use `sh scripts/dev.sh build`, then
`sh scripts/dev.sh run npm ci`. Validate with
`sh scripts/dev.sh run npm run verify`; start with `sh scripts/dev.sh start` and
open http://localhost:5173. Run all Node tooling inside this container; do not
install dependencies on the host. Formatting is `sh scripts/dev.sh run npm run format`.
The aggregate check includes lint, types, unit tests, build, actual local D1 tests,
and Chromium tests. Build before running integration tests alone on a fresh tree.

Production authentication is not implemented: the normal Worker entry denies
admin access, while development explicitly selects `worker/local.ts`. Do not
deploy that local entry or add a production authentication bypass. The scheduled
handler only recovers pending M2 deliveries; it does not generate reminders or
class-start messages. The once-per-minute cron is manual in local Wrangler.

## Product model and invariants

### Life groups and classes

- A life group owns its name, Slack workspace/channel mapping, IANA timezone,
  weekly meeting weekday, local start/end times, schedule start date, and reminder
  configuration. Use stable group IDs throughout persistence and operations.
- Use `classes` for dated class occurrences, not `sundays`. Each occurrence is
  identified by life group ID and the group's local calendar date.
- Thrive initially meets Sundays, 09:30–11:45, America/Chicago.
- The weekly schedule defines valid class dates. A valid class date with no
  database row is OPEN. Do not require pre-created rows or insert empty rows just
  to list upcoming classes.
- A date outside the group's weekly schedule is not implicitly available. Reject
  nonexistent groups, invalid dates, and off-cadence dates.
- Persist assignments and explicit exceptions such as NO_SNACK. An OPEN row may
  remain after a cancellation; it has the same effective state as an absent row.
- Effective states are exactly OPEN, ASSIGNED, and NO_SNACK. ASSIGNED has exactly
  one volunteer; OPEN and NO_SNACK have none.
- Enforce one class row per `(life_group_id, local_date)` and one assignment on
  that row with database constraints, including under concurrent first signups
  when the class row does not yet exist.
- A volunteer can hold multiple future assignments. Use Slack IDs for identity,
  scoped to the workspace; never use display names as identity.
- No recurring-event engine is needed: a weekly group schedule and dated
  exceptions are sufficient for the initial scope.

These rules intentionally supersede the original specification's requirement
that unconfigured dates must not become available. Only dates on a configured
group's cadence are implicitly OPEN.

### Volunteer and administrator operations

- Expose explicit operations such as `signupForClass`, `cancelSignup`,
  `changeSignup`, `markNoSnack`, `openClass`, and `getUpcomingStatus`.
- Support availability, own assignments, signup, own cancellation, and changing
  dates through deterministic Slack interactions.
- Signup must atomically claim an effective OPEN class, including creating its
  row when absent. A conflict must never overwrite another volunteer.
- Changing dates is atomic: failure to claim the destination preserves the
  original assignment.
- An administrator marking an assigned class NO_SNACK removes the assignment,
  invalidates future reminders, records the actor/change, and durably requests
  notification of the affected volunteer where practical.
- Reopening NO_SNACK does not restore the former volunteer.
- Keep authentication and transport concerns outside business rules.
- Accepted on 2026-09-22: anyone in the configured Slack workspace may sign up
  through the group's configured channel. DMs and unconfigured channels direct
  the user to that channel. Ambiguous channel mappings fail visibly instead of
  choosing a group. No separate membership lookup is required.
- Signup closes at the class start instant. Replaying an already-committed
  request after that cutoff returns its original outcome, without a new signup.
- M2 cancellation/change cutoff remains pending. Test entries explicitly exercise
  a class-start policy; normal entries must not silently choose it. A change
  destination must be a future class. Admin status controls compare the displayed
  state and assignment ID; stale updates must not cancel a newer commitment.

### Scheduling

- Reminder configuration belongs to the life group. Proposed initial semantics:
  `days_before = 3` and `local_time = 15:00`, producing Thursday 15:00 for Thrive's
  Sunday class. Use local calendar-day subtraction, not a fixed UTC duration.
  This interpretation must be confirmed before implementing scheduled behavior.
- Store/compare execution instants in UTC; interpret class dates and configured
  wall-clock times in the group's IANA timezone. Never assume a permanent offset.
- Remind only the current volunteer for an ASSIGNED class. Recheck assignment
  identity before delivery; cancellation or NO_SNACK invalidates stale work.
- A signup after its normal reminder time must clearly restate the upcoming
  commitment in the signup confirmation.
- At each scheduled class start, post to the group's channel, including when the
  class has no database row. Thank the current volunteer if assigned without
  asserting that food was actually brought.
- Always report the following weekly class's effective state: assigned volunteer,
  volunteer needed for OPEN (including absent rows), or no snack needed.
- Preserve the original requirement to post even for an explicit NO_SNACK class;
  avoid implying that a meeting is taking place when it may not be.
- Cron repetition must not create duplicate logical jobs. Define catch-up expiry
  before implementing scheduling; do not send indefinitely stale messages.

### Calendar downloads

- After signup, provide a downloadable `.ics` event; no Google Calendar integration.
- Thrive's title is `Bring snacks for Thrive`; derive the group name for other
  groups. Use the class's configured local start/end times and timezone.
- Explain that the event represents a snack commitment, changes are managed in
  Slack, and already-imported calendar events will not update automatically.
- Use a stable event UID per assignment and correct DST-aware conversion.
- Record calendar-download requests as useful admin activity: timestamp, group,
  class, assignment reference, and outcome. Record the actual requester identity
  only when authenticated; a bearer link identifies an assignment, not necessarily
  the person clicking it. A download does not prove calendar import.
- If signed download links are used, retain this activity without storing the raw
  bearer token or full credential-bearing URL. Token values are not needed to
  establish when downloads were requested.

## Architecture and persistence

- D1 is authoritative. Slack delivery success must not determine signup state.
- Prefer one Worker, one D1 database, and one package/lockfile. Serve a static
  SvelteKit admin UI from the same deployment with same-origin admin endpoints.
- Keep domain rules, application operations, and D1/Slack/calendar/auth adapters
  separate. Avoid generic frameworks or abstractions without a concrete use.
- Initial schema direction: `life_groups`, `classes`, durable operation receipts,
  structured activity, and a small outbox when asynchronous delivery is needed.
- Enforce state/volunteer consistency and composite class uniqueness in D1.
  Assign each new commitment a fresh assignment ID to distinguish old jobs.
- Commit mutations, idempotency receipts, audit entries, and required delivery
  intent atomically. Test D1 transaction behavior rather than assuming ordinary
  interactive SQL transactions are available.
- Scope idempotency to the source request and group. Do not deduplicate solely by
  user/date: later legitimate operations may have the same values.
- Outbox work uses unique logical delivery keys, bounded retries, expiring claims,
  and sanitized failure information. Respect Slack rate-limit retry guidance.
- Do not claim exactly-once external delivery; a timeout or crash after Slack
  accepts a message can leave an ambiguous outcome or eventual duplicate.
- M2 delivery uses one configured bot installation/workspace, private interactive
  confirmations and historical admin cancellation notices. No response URLs are
  stored. Jobs have 60-second leases, five attempts, 30-minute reply/24-hour notice
  expiry, sanitized errors and Slack Retry-After handling. These lifetimes do not
  settle M3 scheduled catch-up expiry. Missing bot credentials retain pending work
  until expiry; tests inject a fake sender and never contact Slack.
- Do not add Redis, queues, microservices, or additional databases speculatively.

## Development environment and harness

- Docker is the preferred development-isolation boundary, independent of the
  production Worker deployment. Keep runtime/tool installation inside the dev
  container and dependencies and local D1 state in named volumes where practical.
- Bind-mount source for editing. Ensure ordinary container work does not install
  Node packages or toolchains globally on the host. Document volume cleanup and
  the distinction between disposable test storage and persistent development data.
- Milestone 0 must prove file watching, browser access, local Worker execution,
  local D1 migrations, and browser testing in this setup before adding features.
- Provide formatting, linting, TypeScript/Svelte checks, unit tests, integration
  tests, browser tests, production build, and one aggregate validation command.
- Pin the runtime and dependencies. CI executes the same underlying checks.
- Use a tiny injected clock; no direct wall-clock calls in domain/application
  logic. Use fixed instants in tests and synthetic Slack users/payloads.
- Keep local tests offline with respect to Slack. Real-service smoke tests must
  be deliberate, clearly identified, and use the intended test workspace/channel.
- Commit secret-free configuration examples. Ignore local secrets, dependencies,
  generated builds, and local D1 state. Use Worker secrets for deployed credentials.
- Fail closed on invalid production authentication configuration. Never allow a
  local authentication shortcut in a deployed environment.

Proposed layout: `src/` for SvelteKit UI; `worker/domain/`,
`worker/application/`, and `worker/adapters/` for backend code; `migrations/`;
`tests/unit/`, `tests/integration/`, `tests/e2e/`, and `tests/fixtures/slack/`;
`docs/`; and a checked-in Slack app manifest. Create folders only when used.

## Security and privacy boundaries

- Verify Slack signatures over the original body and check timestamp freshness.
  Validate workspace and resolve the intended group before business operations.
- Acknowledge Slack within its supported deadline; avoid outbound API calls in
  the acknowledgment's critical path.
- Protect admin pages and APIs with personal-account authentication, isolated in
  an adapter. Cloudflare Access is the proposed approach, not yet implemented.
- Retain only bot-related structured activity useful for administration, including
  calendar requests. Show that direct bot interactions may be visible to admins.
- Do not ingest general Slack history, store unnecessary raw conversations, or
  request church-system credentials. Define retention before production release.

## Required feedback and working method

Before each milestone/story:

1. Read repository instructions and the current product documentation; inspect code.
2. State the observable behavior changing and its acceptance criteria.
3. Surface conflicting requirements before implementing the affected portion.
4. Make the smallest coherent change; avoid unrelated redesign.
5. Run relevant automated checks and inspect the diff for conceptual integrity.
6. Document setup/behavior changes and provide a reproducible demonstration.
7. Report failures and uncertainty; distinguish mocked, local-runtime, deployed,
   and real-service evidence.

Tests must establish business behavior, not copy implementation logic. Include
direct database-constraint tests, independent calendar parsing, and actual
rendered UI checks. Passing agent-generated tests alone is insufficient evidence.

Required acceptance coverage as the relevant features arrive:

- Two simultaneous first signups for an absent class: exactly one winner.
- Slack retry: one mutation and no duplicate logical side effects.
- Group isolation, off-cadence rejection, implicit OPEN, and NO_SNACK rejection.
- Ownership checks and atomic failed date changes.
- Cancellation before reminder and assigned-to-NO_SNACK transitions.
- Repeated cron, late signup, and stale assignment delivery suppression.
- Next-class output for all three effective states, including no database row.
- DST boundaries, including a reminder and class on different UTC offsets.
- Slack rejection, rate limiting, timeout, and recoverable delivery state.
- Calendar download activity, independently parsed times, and real import smoke test.

## Milestones and unresolved decisions

0. Development harness: container workflow, project structure, local D1,
   configuration, clock, fixtures, checks, CI, and discoverable instructions.
1. First slice: `/snack` signup → cadence validation → atomic D1 assignment →
   confirmation/calendar download → read-only admin assignment display.
   Concurrency, idempotency, and minimal audit capture belong in this slice.
2. Lifecycle: availability, own assignments, cancellation, change, NO_SNACK admin.
3. Scheduling: group-configured reminder and class-start messages, retries.
4. Operations: history and delivery UI, deployment/smoke docs, retention/cleanup.

Before affected implementation, resolve: cancellation/date-change cutoff; reminder
calendar-days/local-time interpretation; schedule-edit behavior for existing
assignments; DST ambiguous/nonexistent local times for future group schedules;
and scheduled catch-up expiry. None blocks the basic harness. Do not silently
invent these policies or build general solutions before they are needed.

Keep future possibilities in the external backlog, with planning buckets separate
from delivery status. LLM conversation, Google Calendar synchronization, advanced
recurrence, and broader group coordination remain deferred.
