<script lang="ts">
  import type { LifeGroup } from '../../worker/domain/life-group';
  import type {
    DeliveryFilter,
    GroupOperations,
  } from '../../worker/domain/operations';

  let { group }: { group: LifeGroup } = $props();
  let open = $state(false);
  let loading = $state(false);
  let error = $state('');
  let snapshot = $state<GroupOperations | null>(null);
  let filter = $state<DeliveryFilter>('attention');
  let retry = $state(0);

  const activityNames = {
    SIGNUP: 'Snack signup',
    CANCEL: 'Signup cancellation',
    CHANGE: 'Signup date change',
    NO_SNACK: 'Mark no snack',
    OPEN: 'Open signup',
    CALENDAR_DOWNLOAD: 'Calendar download request',
  };
  const messageNames = {
    INTERACTION_REPLY: 'Private confirmation',
    CANCELLATION_NOTICE: 'Cancellation notice',
    REMINDER: 'Volunteer reminder',
    CLASS_START: 'Class-start channel message',
  };
  const outcomes: Record<string, string> = {
    SIGNED_UP: 'Signed up',
    ALREADY_SIGNED_UP: 'Already signed up',
    TAKEN: 'Date already taken',
    NO_SNACK: 'No snack needed',
    CANCELLED: 'Cancelled',
    CHANGED: 'Date changed',
    MARKED_NO_SNACK: 'No snack needed',
    OPENED: 'Opened',
    UNCHANGED: 'No change',
    NOT_OWNER: 'Not the volunteer',
    STALE: 'Class had changed',
    CLOSED: 'Class had started',
    SERVED: 'Download served',
    INVALID_LINK: 'Invalid calendar link',
    NOT_FOUND: 'Assignment unavailable',
  };
  const states = {
    PENDING: 'Pending',
    SENDING: 'Sending',
    SENT: 'Sent',
    FAILED: 'Failed',
    SKIPPED: 'Skipped',
  };
  const errors: Record<string, string> = {
    SLACK_NOT_CONFIGURED: 'Slack credentials are not configured.',
    RATE_LIMITED: 'Slack asked the bot to wait before retrying.',
    SLACK_TEMPORARY_ERROR: 'Slack reported a temporary error.',
    NETWORK_OR_RESPONSE_ERROR: 'Slack delivery could not be confirmed.',
    SLACK_UNAVAILABLE: 'Slack is temporarily unavailable.',
    SLACK_HTTP_REJECTED: 'Slack rejected the request.',
    SLACK_REJECTED: 'Slack rejected the message.',
    SOURCE_UPDATE_REJECTED: 'The original Slack message could not be updated.',
    DELIVERY_PREPARATION_FAILED: 'The message could not be prepared.',
    WORKSPACE_OR_RECEIPT_MISMATCH:
      'The message does not match the configured workspace.',
    EXPIRED_OR_EXHAUSTED: 'Delivery expired or reached its attempt limit.',
    STALE_ASSIGNMENT: 'The original snack commitment is no longer active.',
    SCHEDULE_CHANGED: 'The class schedule no longer matches this message.',
  };
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: group.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const profile = (userId: string) =>
    `team=${encodeURIComponent(snapshot!.workspaceId)}&id=${encodeURIComponent(userId)}`;

  async function load(
    groupId: string,
    messages: DeliveryFilter,
    signal: globalThis.AbortSignal,
  ) {
    loading = true;
    error = '';
    try {
      const response = await globalThis.fetch(
        `/api/admin/operations?${new globalThis.URLSearchParams({ groupId, messages })}`,
        { signal },
      );
      if (!response.ok) throw new Error('unavailable');
      const result: GroupOperations = await response.json();
      if (result.groupId !== groupId) throw new Error('wrong group');
      if (!signal.aborted) snapshot = result;
    } catch {
      if (!signal.aborted)
        error = 'Unable to load activity and messages. Please try again.';
    } finally {
      if (!signal.aborted) loading = false;
    }
  }
  $effect(() => {
    // Re-read on group refresh, filter changes and explicit retry. Cleanup prevents
    // a slower previous response from replacing the newly selected view.
    const inputs = { group, filter, retry };
    if (!open) return;
    const controller = new globalThis.AbortController();
    void load(inputs.group.id, inputs.filter, controller.signal);
    return () => controller.abort();
  });
</script>

<button
  class="toggle"
  aria-expanded={open}
  aria-controls={`operations-${group.id}`}
  onclick={() => (open = !open)}
>
  {open ? 'Hide activity and messages' : 'View activity and messages'}
</button>
{#if open}
  <section
    id={`operations-${group.id}`}
    aria-label={`Activity and messages for ${group.name}`}
    aria-busy={loading}
  >
    <div class="heading">
      <h3>Activity and messages</h3>
      <button onclick={() => retry++} disabled={loading}
        >{error ? 'Try again' : 'Refresh activity'}</button
      >
    </div>
    <label
      >Messages to show
      <select bind:value={filter}>
        <option value="attention">Pending and failed</option>
        <option value="all">All messages</option>
      </select>
    </label>
    {#if error}
      <p role="alert">{error}</p>
    {:else if loading}
      <p role="status">Loading activity and messages…</p>
    {:else if snapshot}
      <p class="detail">
        Checked {timestamp(snapshot.checkedAt)} · {group.timezone}
      </p>
      <p class="counts" aria-label="Message counts">
        {snapshot.deliveryCounts.PENDING} pending · {snapshot.deliveryCounts
          .SENDING} sending · {snapshot.deliveryCounts.FAILED} failed
      </p>
      <h4>Messages</h4>
      {#if snapshot.deliveries.length}
        <ul aria-label="Message deliveries">
          {#each snapshot.deliveries as message (message.id)}
            <li aria-label={`Message ${message.id}`}>
              <div class="row">
                <strong>{messageNames[message.kind]}</strong><span
                  class="state"
                  class:failed={message.status === 'FAILED'}
                  >{states[message.status]}</span
                >
              </div>
              <p>
                {message.localDate ??
                  'Class date unavailable'}{message.targetDate
                  ? ` → ${message.targetDate}`
                  : ''}
              </p>
              {#if message.recipientUserId}
                <p>
                  To <a
                    href={`slack://user?${profile(message.recipientUserId)}`}
                    >{message.recipientUserId}</a
                  >
                </p>
              {:else if message.kind === 'CLASS_START'}<p>
                  To the group channel
                </p>{/if}
              <p class="detail">
                {message.attempts}
                {message.attempts === 1 ? 'attempt' : 'attempts'}
              </p>
              {#if message.lastError}<p>
                  {errors[message.lastError] ?? 'Delivery needs review.'}
                </p>{/if}
              {#if message.status === 'PENDING'}
                <p class="detail">
                  Next attempt from {timestamp(message.availableAt)}
                </p>
              {:else if message.status === 'SENDING' && message.leaseUntil}
                <p class="detail">
                  Delivery may be retried after {timestamp(message.leaseUntil)}
                </p>
              {/if}
              <p class="detail">
                Delivery deadline {timestamp(message.expiresAt)}
              </p>
            </li>
          {/each}
        </ul>
      {:else}<p>
          {filter === 'attention'
            ? 'No pending or failed messages.'
            : 'No messages recorded.'}
        </p>{/if}
      {#if snapshot.moreDeliveries}<p class="detail">
          Showing the latest 50 matching messages. Older messages are not shown.
        </p>{/if}
      <p class="detail">
        Sent means Slack accepted the message, not that someone read it. A
        timeout can leave delivery uncertain.
      </p>
      <h4>Recent activity</h4>
      {#if snapshot.activity.length}
        <ul aria-label="Bot activity">
          {#each snapshot.activity as entry (entry.id)}
            <li aria-label={`Activity ${entry.id}`}>
              <div class="row">
                <strong>{activityNames[entry.kind]}</strong><span
                  >{outcomes[entry.outcome] ?? 'Outcome needs review'}</span
                >
              </div>
              {#if entry.localDate}<p>
                  {entry.localDate}{entry.targetDate
                    ? ` → ${entry.targetDate}`
                    : ''}
                </p>{/if}
              <p>
                {#if entry.actorUserId?.startsWith('U')}
                  By <a href={`slack://user?${profile(entry.actorUserId)}`}
                    >{entry.actorUserId}</a
                  >
                {:else if entry.actorUserId}By {entry.actorUserId}
                {:else if entry.kind === 'CALENDAR_DOWNLOAD'}Requester unknown
                  (calendar link)
                {:else}Actor not recorded{/if}
              </p>
              {#if entry.previousVolunteerId}<p>
                  {['CANCELLED', 'CHANGED', 'MARKED_NO_SNACK'].includes(
                    entry.outcome,
                  )
                    ? 'Previous volunteer'
                    : 'Volunteer at request'}
                  <a href={`slack://user?${profile(entry.previousVolunteerId)}`}
                    >{entry.previousVolunteerId}</a
                  >
                </p>{/if}
              <time class="detail" datetime={entry.occurredAt}
                >{timestamp(entry.occurredAt)}</time
              >
              {#if entry.kind === 'CALENDAR_DOWNLOAD'}<p class="detail">
                  A download request does not confirm calendar import.
                </p>{/if}
            </li>
          {/each}
        </ul>
      {:else}<p>No bot activity recorded.</p>{/if}
      {#if snapshot.moreActivity}<p class="detail">
          Showing the latest 50 activities. Older activity is not shown.
        </p>{/if}
    {/if}
  </section>
{/if}

<style>
  section {
    border-top: 1px solid #dddeda;
    margin-top: 20px;
    padding-top: 16px;
  }
  .heading,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    justify-content: space-between;
  }
  h3,
  h4 {
    margin: 12px 0;
  }
  h4 {
    margin-top: 24px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    border-top: 1px solid #e5e9e3;
    padding: 14px 0;
    overflow-wrap: anywhere;
  }
  p {
    line-height: 1.5;
    margin: 6px 0;
  }
  .detail {
    color: #56635c;
    font-size: 13px;
  }
  .counts {
    font-weight: 600;
  }
  .state {
    border-radius: 20px;
    background: #e8eee2;
    padding: 4px 10px;
    font-size: 12px;
  }
  .state.failed {
    background: #f8e5dd;
    color: #7b3525;
  }
  a {
    color: #2d5743;
    overflow-wrap: anywhere;
  }
  button,
  select {
    font: inherit;
    border: 1px solid #b8c6b7;
    background: #e8eee2;
    color: #263f35;
    border-radius: 7px;
    padding: 8px 12px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.65;
    cursor: wait;
  }
  .toggle {
    margin-top: 20px;
  }
  label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
  }
  button:focus-visible,
  select:focus-visible {
    outline: 3px solid #477763;
    outline-offset: 3px;
  }
</style>
