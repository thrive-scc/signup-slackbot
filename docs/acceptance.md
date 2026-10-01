# Milestone 0 acceptance and evidence

Current operations, scheduling and lifecycle behavior, reproduction steps and evidence limits
are in [Milestone 4](milestone-4.md), [Milestone 3](milestone-3.md) and [Milestone 2](milestone-2.md); the first
slice is in [Milestone 1](milestone-1.md).
The harness evidence below is preserved as the Milestone 0 baseline.

## Automated acceptance

Run `sh scripts/dev.sh run npm run verify` from the repository root.

| Requirement                                                    | Check                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| UI and Worker compile independently                            | `npm run check` and `npm run build`                               |
| Domain code avoids adapters and wall-clock access              | ESLint boundary rules                                             |
| Clock can be fixed without changing global time                | `tests/unit/overview.test.ts`                                     |
| Fixtures cannot send real Slack messages                       | `tests/unit/slack-fixtures.test.ts`; fake has no network fallback |
| Actual local D1 migration/read/constraint/rollback behavior    | `tests/integration/harness.test.ts`                               |
| Replayed migrations/seeds preserve existing edits              | D1 integration acceptance                                         |
| Missing/broken database does not look like empty configuration | D1 integration acceptance                                         |
| Built UI reads a seeded database and refreshes                 | `tests/e2e/admin.test.ts`                                         |
| Empty/error/retry UI is understandable                         | Browser tests with explicitly stubbed API responses               |
| Narrow viewport is usable                                      | Chromium at 375px, screenshot and overflow check                  |
| Deployable entry fails closed before auth exists               | Integration and bundled-Worker HTTP checks                        |
| Scheduled entry is callable with D1                            | Integration and Wrangler scheduled dispatch; no reminder claim    |

Test databases are disposable and separate from persistent development D1. No test
uses a remote database or a real Slack workspace. Passing fixture tests does not
establish Slack signature verification, delivery, or signup correctness.

## Manual demonstration

1. Follow the README quick start, then open <http://localhost:5173>.
2. Confirm the sample group, weekday, time range, and timezone are visible.
3. Click Refresh and check the browser's `/api/admin/groups` response.
4. Temporarily edit the page heading in `src/routes/+page.svelte`; observe it
   change without restarting the container, then restore the file.
5. Stop/start the harness and confirm the group still exists. Reapplying seed data
   must not overwrite a deliberate development-only edit to its name.
6. Inspect desktop/mobile images in `test-results/` after browser tests; do not
   substitute assertions alone for visual review.

## Scope of evidence

During initial validation on 2026-09-10, three unit tests, eight local D1/Worker
integration tests, and five Chromium checks passed. Desktop/mobile screenshots
were visually reviewed. A host edit and its restoration were observed in a live
Chromium page through the Docker bind mount. Type checking and the production
dry-run build passed. A clean `npm ci` followed by the complete `npm run verify`
command passed. A temporary change to the synthetic group's name survived the
test run, container replacement, and reseeding; its original name was then
restored. Worker source edits and restoration also reloaded successfully.
The aggregate command remains the reproducible current check; this historical
record does not replace rerunning it after changes.

This milestone validates the Docker/local Workers development environment and
the built local application path. CI configuration is supplied, but a hosted CI
run must be observed after pushing the repository. Nothing has been deployed;
no real Slack interaction, calendar import, authentication, signup concurrency,
or DST scheduling behavior has been demonstrated. Those belong to later slices.
