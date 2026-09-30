import type { SnackEnv } from '../env';
import type { Clock } from '../domain/clock';
import type { LifecycleInput } from '../domain/lifecycle';
import { manageClass } from '../application/manage-class';
import { signupStore } from './d1/signups';
import { applyLifecycle, readOperation } from './d1/lifecycle';
import { knownError } from './slack/commands';

export interface AdminIdentity {
  id: string;
}
export async function changeClassStatus(
  request: Request,
  env: SnackEnv,
  clock: Clock,
  actor: AdminIdentity,
) {
  if (request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  if (
    request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('Content-Type')?.split(';')[0] !== 'application/json'
  )
    return Response.json(
      { error: 'Use the admin page to change class status.' },
      { status: 403 },
    );
  let input: LifecycleInput;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 4096) throw new Error();
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !body ||
      !['OPEN', 'NO_SNACK'].includes(body.operation) ||
      !['OPEN', 'ASSIGNED', 'NO_SNACK'].includes(body.expectedStatus) ||
      typeof body.groupId !== 'string' ||
      !body.groupId ||
      body.groupId.length > 100 ||
      typeof body.localDate !== 'string' ||
      typeof body.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(body.requestId) ||
      (body.expectedAssignmentId != null &&
        (typeof body.expectedAssignmentId !== 'string' ||
          !/^[0-9a-f-]{36}$/.test(body.expectedAssignmentId)))
    )
      throw new Error();
    input = {
      groupId: body.groupId,
      localDate: body.localDate,
      operation: body.operation,
      expectedStatus: body.expectedStatus,
      expectedAssignmentId: body.expectedAssignmentId ?? undefined,
      requestId: `admin:${body.requestId}`,
      actorUserId: actor.id,
    };
  } catch {
    return Response.json(
      { error: 'Invalid class update. Refresh and try again.' },
      { status: 400 },
    );
  }
  try {
    const { receipt } = await manageClass(
      input,
      { kind: 'admin' },
      {
        ...signupStore(env.DB),
        getReceipt: (g, r) => readOperation(env.DB, g, r),
        apply: (write) => applyLifecycle(env.DB, write),
      },
      clock,
      'class-start',
    );
    return Response.json(
      {
        receipt,
        notificationQueued:
          receipt.outcome === 'MARKED_NO_SNACK' &&
          !!receipt.previousVolunteerId,
      },
      {
        status: receipt.outcome === 'STALE' ? 409 : 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: knownError(error)
          ? (error as Error).message
          : 'The update may have been saved. Retry this same change to recover its result.',
      },
      { status: knownError(error) ? 400 : 503 },
    );
  }
}
