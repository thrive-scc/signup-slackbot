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
- `/snack` shows availability by default. The `list` and `help` aliases remain
  functional, but responses do not advertise them or repeat availability-command
  instructions in other actions. Existing text mutation commands remain compatible.
- Signup replaces the private availability message with confirmation. A durable
  private reply remains the fallback if that source message cannot be updated.
- Dates appear as `Jun 5`; confirmations and reminders omit meeting times.
- Own-signup lists offer cancellation, without a move selector or command guide.
  Longer lists have **Previous**/**Next** buttons. These read the clicking user's
  signups outside the acknowledgment and replace only private source messages;
  the fallback is a private reply. They do not write receipts, activity or jobs.
- Confirmation shows the commitment and **Add to your calendar**, with no command
  guide or calendar-update explanation. The `.ics` description is:
  “Reminder to bring snacks for {life group name}. If you need to change your sign up,
  please do that through slack - changing this invite won't update anything but your calendar :)”
  Full calendar dates, start/end instants, UID, DST handling and download activity
  remain unchanged. Previously imported events will retain their old description.

Acceptance includes signed interaction retries, no persisted response URL,
slow/failed source updates, recoverable delivery and unchanged assignment state.
Offline tests cannot establish behavior in the native Slack mobile app; confirm
that on a phone after the deliberate pilot deployment.

The 2026-09-30 wording follow-up passed the aggregate check: 23 unit, 117 actual
local Worker/D1 and 10 Chromium tests, plus formatting, lint, types and build.
Calendar descriptions were independently parsed, including escaped group names
and DST boundary events. Signed pagination checks prove private reads, navigation
in both directions, harmless repeats, early acknowledgment, no database writes,
and clear read failures without command guidance. One older reminder expectation
still included the meeting time and was updated to the requested date-only copy.
This follow-up was deployed through the Slack CLI as pilot Worker version
`f8e6fad1-4f83-4398-8069-2afa2a048588`, from commit `726b87e`. The existing app's
manifest update and installation succeeded. Public health returned 200 and the
admin operations endpoint remained protected with 503. No signups were changed.
The new wording has not yet been visually verified in Slack or downloaded from
the live calendar endpoint. The live interaction evidence below describes the
previous deployed wording.

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
