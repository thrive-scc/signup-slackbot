import { getGroupOverview } from './application/get-group-overview';
import { systemClock } from './adapters/clock';
import { readLifeGroups } from './adapters/d1/life-groups';
import { readAssignments } from './adapters/d1/signups';
import type { SnackEnv } from './env';
import type { Clock } from './domain/clock';
import { downloadCalendar } from './adapters/calendar-download';
import { handleSnackCommand } from './adapters/slack/commands';
import type { VolunteerCutoff } from './adapters/slack/commands';
import { handleInteraction } from './adapters/slack/interactions';
import { getUpcomingStatus } from './application/get-upcoming-status';
import { readClasses } from './adapters/d1/classes';
import { changeClassStatus, type AdminIdentity } from './adapters/admin';
import { deliverPending } from './delivery';
import { enqueueScheduled } from './scheduling';
export function createWorker(
  authorizeAdmin: (request: Request) => AdminIdentity | false,
  clock: Clock = systemClock,
  volunteerCutoff?: VolunteerCutoff,
) {
  return {
    async fetch(
      request: Request,
      env: SnackEnv,
      context?: Pick<ExecutionContext, 'waitUntil'>,
    ): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === '/health' && request.method === 'GET') {
        return Response.json({ status: 'ok' });
      }
      if (pathname === '/slack/commands')
        return handleSnackCommand(request, env, clock, volunteerCutoff);
      if (pathname === '/slack/interactions') {
        if (!context)
          return new Response('Interaction runtime unavailable.', {
            status: 503,
          });
        return handleInteraction(request, env, clock, context, volunteerCutoff);
      }
      if (pathname.startsWith('/calendar/')) {
        if (request.method !== 'GET')
          return new Response('Method not allowed', {
            status: 405,
            headers: { Allow: 'GET' },
          });
        if (!env.CALENDAR_SIGNING_KEY)
          return new Response('Calendar downloads are not configured.', {
            status: 503,
          });
        try {
          return await downloadCalendar(
            request,
            env.DB,
            env.CALENDAR_SIGNING_KEY,
            clock,
          );
        } catch {
          return new Response(
            'Calendar temporarily unavailable. Please retry this link.',
            { status: 503, headers: { 'Cache-Control': 'no-store' } },
          );
        }
      }
      const admin = authorizeAdmin(request);
      if (!admin) {
        return new Response('Admin access is not configured.', { status: 503 });
      }
      if (pathname === '/api/admin/groups' && request.method === 'GET') {
        try {
          const groups = await readLifeGroups(env.DB);
          const overview = await getGroupOverview(
            async () => groups,
            clock,
            (now) => readAssignments(env.DB, now),
          );
          const classes = (
            await Promise.all(
              groups.map((group) =>
                getUpcomingStatus(
                  group,
                  (g, a, b) => readClasses(env.DB, g, a, b),
                  clock,
                ),
              ),
            )
          ).flat();
          return Response.json(
            { ...overview, classes },
            {
              headers: { 'Cache-Control': 'no-store' },
            },
          );
        } catch {
          return Response.json(
            { error: 'Life groups are temporarily unavailable.' },
            { status: 503 },
          );
        }
      }
      if (pathname === '/api/admin/classes') {
        const response = await changeClassStatus(request, env, clock, admin);
        if (response.ok && context)
          context.waitUntil(deliverPending(env, clock));
        return response;
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/slack/')) {
        return new Response('Not found', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    },
    async scheduled(
      _controller: ScheduledController,
      env: SnackEnv,
    ): Promise<void> {
      // Use the actual clock for catch-up, not a possibly delayed trigger timestamp.
      try {
        await enqueueScheduled(env.DB, clock);
      } finally {
        await deliverPending(env, clock);
      }
    },
  } satisfies ExportedHandler<Env>;
}
