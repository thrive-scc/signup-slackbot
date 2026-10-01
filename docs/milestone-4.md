# Milestone 4 — operations and pilot usability

This milestone is in progress, not complete. The current slice simplifies Slack
interaction and prepares automatic pilot deployment. History/delivery UI,
authentication, retention and cleanup remain outstanding.

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
