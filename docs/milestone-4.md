# Milestone 4 — operations and pilot usability

This milestone is in progress, not complete. Slack usability and the prepared
pilot deployment workflow are checked into main. The next slice adds a read-only
admin view of bot activity and message delivery. Deployed admin authentication,
workspace-specific installations, retention and cleanup remain outstanding.

## Admin activity and message delivery

Each life group's **View activity and messages** control opens a read-only view
of existing D1 records. It shows signup/cancellation/date-change and admin status
activity, including the authenticated actor and previous volunteer where recorded.
Rejected changes show the volunteer at the request without implying cancellation.
Calendar requests show their time and outcome; an unauthenticated calendar link
does not identify its actual requester or establish that an event was imported.
No general Slack channel history is read.

Messages default to pending, sending and failed work; **All messages** also shows
sent and skipped deliveries. Cards identify message type, class date, recipient
where recorded, attempt count, sanitized failure reason, retry eligibility and
delivery deadline. Counts cover the whole group. The view does not send messages
or reset failed jobs; existing cron processing owns delivery and retry behavior.
Sent means Slack accepted a request, not that a volunteer read it. A timeout can
still have an ambiguous delivery outcome.

The same-origin `GET /api/admin/operations?groupId=...&messages=attention|all`
endpoint lives behind the existing admin authorization boundary. It reads only
the requested group and returns at most 50 recent activities and 50 matching
deliveries, with explicit flags when older records exist. Failed/pending filtering
happens before the limit so newer successful deliveries do not hide older pending
work. Query parameters are validated, failures remain visible, and responses are
not cached. Raw request bodies, bearer links and opaque claim IDs are not returned.
This uses existing tables and requires no migration. Records with no identifiable
group (for example a wholly invalid calendar link) are outside this group view.
Refresh obtains another snapshot; the view does not claim to be a live feed.

The deployable entry still denies admin access. This slice uses the explicit local
entry for demonstrations and a synthetic admin identity in browser tests; neither
is production authentication. Do not deploy the local entry to expose this view.

### Reproduce the local view

1. Follow the README quick start and the [local signup demonstration](milestone-1.md#reproduce-the-local-path)
   to create a synthetic commitment. Open its calendar link to record a download.
2. Open <http://localhost:5173>. Mark that assigned class **No snack needed** and
   confirm the change. Local notification delivery remains pending when no bot
   credentials are configured.
3. Open **View activity and messages** for the group. Check the signup, download
   request, admin change/previous volunteer and pending cancellation notice.
4. Switch to **All messages**, then **Refresh activity**. Neither control changes
   assignments or sends a message. Inspect at desktop and phone widths.
5. Run `sh scripts/dev.sh run npm run verify` with the development server stopped.
   Browser screenshots are saved as `test-results/operations-mobile.png` and
   `test-results/operations-desktop.png`.

Acceptance covers actual local D1 records and failures, group isolation, bounded
history, older pending work, scheduled recipients, authenticated actor capture,
rate-limit recovery state, read-only behavior and the closed deployment boundary.
Chromium exercises real signup/calendar/admin-change records and the rendered
view, including filter changes, narrow-screen layout and retry after an explicitly
stubbed read failure. Fake Slack responses establish delivery display data; this
slice does not send to real Slack or establish deployed admin access.

On 2026-09-30, the aggregate check passed with 23 unit, 110 local Worker/D1 and
10 Chromium tests, alongside formatting, lint, type checking and the production
dry-run build. Desktop and 375px browser views were visually inspected. The first
aggregate run exposed a test that compared query-duration metadata rather than
the saved records; it was corrected to compare the records. Visual review also
prompted a distinction between the previous volunteer after a successful change
and the volunteer still assigned after a rejected change.

## Remaining slices

- Configure and observe GitHub's pilot deployment workflow; the Cloudflare GitHub
  environment credentials remain an activation requirement.
- Authenticate personal admin accounts before enabling the deployed UI/API.
- Add isolated installation credentials/routing/delivery for multiple workspaces,
  with one explicitly configured group per workspace.
- Agree and implement retention/cleanup without breaking active assignments,
  delivery dependencies or the documented retry window.
- Complete deployed cron and calendar-import smoke evidence and document recovery.

## Slack usability

- Autocomplete lists `/snack`, described as “volunteer to bring snacks.”
- Public guidance offers `/snack list` and `/snack mine`. Existing text mutation
  commands and previously issued controls remain compatible.
- Signup replaces the private availability message with confirmation. A durable
  private reply remains the fallback if that source message cannot be updated.
- Dates appear as `Jun 5`; confirmation shows only the start time.
- Own-signup lists offer cancellation, without a move selector.
- Calendar links say **Add to your calendar**; `.ics` content is unchanged.

Acceptance includes signed interaction retries, no persisted response URL,
slow/failed source updates, recoverable delivery and unchanged assignment state.
Offline tests cannot establish behavior in the native Slack mobile app; confirm
that on a phone after the deliberate pilot deployment.

On 2026-09-30, formatting, lint, types, production build, 23 unit tests,
98 local Worker/D1 integration tests and eight Chromium tests passed. Updated
confirmation expectations initially failed, then were corrected to the accepted
wording. One preview test timed out during page loading, passed in isolation,
and the subsequent full browser run passed; this transient harness timeout
remains an observation rather than proof of a product defect.

The pilot was deployed through the configured Slack CLI. Real Slack evidence:
autocomplete wording, month/day availability, source-message replacement (same
message ID), cancellation-only own-signup controls and the calendar label were
visually verified. A temporary Oct 18 signup was committed, downloaded and then
cancelled; existing commitments were preserved. The downloaded event was parsed
independently with `ical.js`, including the original start/end instants. D1
recorded the calendar request as SERVED. This does not prove calendar import or
native-mobile behavior.

## Deployment and group configuration

Main pushes must pass the full harness before deploying the current pilot.
See [deployment setup](test-deployment.md) for GitHub environment configuration.
Future test and production environments need independent Workers, D1 databases,
Slack credentials and calendar keys. Production rollout policy is not implemented.

The pilot's `Thrive` name was explicitly seeded from the original specification
by `scripts/seed-test.sql`; it was not discovered from Slack. Reapplying that seed
does not rename an existing group. Deployment must not reseed or overwrite group
configuration. The database owns the group's name, schedule and workspace/channel
mapping independently of Slack's workspace display name.

Accepted direction: one backend supports many workspaces, with one life group per
workspace. The current schema scopes operations and assignments by group, but
credentials and delivery still support only one workspace per deployment. A
separate slice must add workspace-specific installation credentials, enforce
the one-group-per-workspace rule, route only verified requests to that workspace,
and deliver/retry without leaking messages or rate limits between workspaces.
Group configuration should be explicit and reviewed; automatic naming, broad
Slack-history access and a general tenant platform are not required.
