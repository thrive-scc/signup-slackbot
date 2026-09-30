# Milestone 0 architecture

This describes the completed harness baseline. Current additions and remaining
work are documented in [Milestone 2](milestone-2.md) and [Milestone 1](milestone-1.md); statements below about
features not yet implemented refer to that earlier baseline.

One root package, one Worker deployment shape, one D1 binding. SvelteKit produces
static assets; the Worker owns HTTP and scheduled entry points. In development,
Vite proxies `/api` to Wrangler for live editing. Browser acceptance checks use
the actual static build served by Wrangler, not Vite's development server.

```text
Browser → Vite (development) → local Worker → D1
Browser → Worker + SvelteKit static assets (built preview) → D1
```

`src/` owns the UI. `worker/domain/` contains plain types and the Clock contract.
`worker/application/` coordinates a read using an injected clock/data reader.
`worker/adapters/` implements D1 reads and the real clock. `worker/http.ts` maps
requests/results and receives an authorization policy. No Slack SDK or business
state transitions are present yet.

## Deliberately small database

`0001_life_groups.sql` introduces group identity, workspace/channel mapping,
timezone, weekday, times, and schedule start date. D1 directly enforces primary
key uniqueness and basic name/weekday/time constraints. The first migration does
not purport to validate all future group-edit policies: timezone existence, date
semantics, overnight classes, and schedule changes need operation-level rules
when editing is implemented. There is no configuration write endpoint in M0.

Fixtures are separate from migrations. Reapplying the fixture preserves existing
edits rather than resetting configuration. Group-specific reminder fields,
classes, operation receipts, history, and outbox tables arrive with the features
that need them. No milestone silently adopts unresolved scheduling policies.

M1 must preserve the accepted rule that a class date on a group's configured
cadence is OPEN when no class row exists. Concurrent first signups must atomically
create/claim one row. The harness's real D1 batch rollback test is preparation
for that work, not proof that signup concurrency has been implemented.

## Time and external boundaries

The clock supplies the overview timestamp. It is injected into application code
and fixed in unit tests. Group timezone is data, not a global environment setting.
DST-aware scheduling/calendar conversion is not implemented or claimed yet.

The scheduled handler is a `SELECT 1` runtime probe, with no writes or messages.
It has no deployed cron trigger. The fake Slack transport can record requests
and simulate results/errors without network access; no real Slack integration
exists yet.

The local entry is selected explicitly in development/test commands. The normal
entry denies admin access before serving assets. Authentication is deliberately
not simulated by trusting a request header. A real identity adapter is needed
before production use.

## Dependency choices

Node 24.21.0, image digest, direct package versions, lockfile, and Worker
compatibility date are pinned. Vitest 4.1.11 matches the Cloudflare plugin's peer
range; TypeScript 6.0.3 matches SvelteKit and typescript-eslint. Newer majors were
available but incompatible with those integrations at setup time.

The pinned plugin exports `readD1Migrations` from its package root. Some Cloudflare
documentation still names a `/config` export that this installed version lacks.
Prefer the installed API/type declarations when checking this detail.

`npm audit` currently reports three low-severity entries tracing to one
`cookie <0.7.0` dependency in SvelteKit ([advisory](https://github.com/advisories/GHSA-pxg6-pf52-xh8x)).
The suggested automated fix downgrades SvelteKit to an incompatible early version.
We retain the supported pinned toolchain: this build emits static assets and
does not deploy SvelteKit's server cookie serializer. Reassess when upgrading
SvelteKit or introducing server-side cookie handling. This is a recorded
dependency limitation, not a suppressed automated test failure.
