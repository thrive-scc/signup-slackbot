<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { GroupOverview } from '../../worker/domain/life-group';
  import type { ClassOccurrence } from '../../worker/domain/classes';
  let overview = $state<
    (GroupOverview & { classes: ClassOccurrence[] }) | null
  >(null);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let saving = $state(false);
  let confirmButton = $state<globalThis.HTMLButtonElement>();
  let change = $state<{
    class: ClassOccurrence;
    operation: 'NO_SNACK' | 'OPEN';
    requestId: string;
  } | null>(null);
  async function propose(occurrence: ClassOccurrence) {
    notice = '';
    change = {
      class: occurrence,
      operation: occurrence.status === 'NO_SNACK' ? 'OPEN' : 'NO_SNACK',
      requestId: globalThis.crypto.randomUUID(),
    };
    await tick();
    confirmButton?.focus();
  }
  async function saveChange() {
    if (!change) return;
    saving = true;
    notice = '';
    try {
      const response = await globalThis.fetch('/api/admin/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: change.class.groupId,
          localDate: change.class.localDate,
          operation: change.operation,
          expectedStatus: change.class.status,
          expectedAssignmentId: change.class.assignmentId,
          requestId: change.requestId,
        }),
      });
      if (response.status === 409) {
        notice =
          'This class changed while you were viewing it. Review its current status before trying again.';
        change = null;
        await refresh();
      } else if (response.ok) {
        const result = await response.json();
        notice = result.notificationQueued
          ? 'Class updated. A cancellation notice is queued for the former volunteer.'
          : 'Class updated.';
        change = null;
        await refresh();
      } else {
        notice =
          'We could not confirm the update. Retry this same change to recover its result.';
      }
    } catch {
      notice =
        'We could not confirm the update. Retry this same change to recover its result.';
    } finally {
      saving = false;
    }
  }
  const weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  async function refresh() {
    loading = true;
    error = '';
    try {
      const response = await globalThis.fetch('/api/admin/groups');
      if (!response.ok) throw new Error('unavailable');
      overview = await response.json();
    } catch {
      error = 'Unable to load life groups. Please try again.';
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void refresh();
  });
</script>

<svelte:head><title>Snack signup · Local preview</title></svelte:head>

<main>
  <p class="eyebrow">SNACK SIGNUP</p>
  <header>
    <div>
      <h1>Life groups</h1>
      <p>A little planning. A shared table.</p>
    </div>
    <span class="badge">Local preview</span>
  </header>
  <p class="notice">
    Use <code>/snack</code> in your life group’s Slack channel to volunteer, or
    <code>/snack mine</code> to manage your signups. Signup closes when class starts.
    The next eight classes follow each group’s weekly schedule.
  </p>
  {#if notice}<p role="status" aria-label="Class update" class="notice">
      {notice}
    </p>{/if}
  {#if change}
    <div class="confirmation" role="group" aria-label="Confirm class change">
      <h2>
        {change.operation === 'NO_SNACK'
          ? 'Mark no snack needed?'
          : 'Open snack signup?'}
      </h2>
      <p>{change.class.localDate}</p>
      {#if change.class.status === 'ASSIGNED'}
        <p>
          This cancels {change.class.volunteerUserId}’s assignment and queues a
          notification. Their imported calendar event will need to be removed
          manually.
        </p>
      {:else if change.operation === 'OPEN'}
        <p>
          Anyone in the configured Slack channel can volunteer. Previous
          volunteers are not restored.
        </p>
      {/if}
      <div class="controls">
        <button bind:this={confirmButton} onclick={saveChange} disabled={saving}
          >{saving ? 'Saving…' : 'Confirm change'}</button
        >
        <button
          class="secondary"
          onclick={() => (change = null)}
          disabled={saving}>Keep current status</button
        >
      </div>
    </div>
  {/if}
  <section aria-label="Life groups" aria-busy={loading}>
    {#if error}
      <p role="alert">{error}</p>
    {:else if loading}
      <p role="status">Loading life groups…</p>
    {:else if overview?.groups.length}
      {#each overview.groups as group (group.id)}
        <article>
          <h2>{group.name}</h2>
          <p>{weekdays[group.weekday]} · {group.startTime}–{group.endTime}</p>
          <p class="timezone">{group.timezone}</p>
          <h3>Upcoming classes</h3>
          {#if !overview.assignments.some((assignment) => assignment.groupId === group.id)}
            <p>No upcoming snack assignments.</p>
          {/if}
          <ul>
            {#each overview.classes.filter((occurrence) => occurrence.groupId === group.id) as occurrence (occurrence.localDate)}
              {@const assignment = overview.assignments.find(
                (a) => a.assignmentId === occurrence.assignmentId,
              )}
              <li aria-label={`Class ${occurrence.localDate}`}>
                <div>
                  <time datetime={occurrence.localDate}
                    >{occurrence.localDate}</time
                  >
                  <span class="status" class:open={occurrence.status === 'OPEN'}
                    >{occurrence.status === 'ASSIGNED'
                      ? 'Assigned'
                      : occurrence.status === 'NO_SNACK'
                        ? 'No snack needed'
                        : 'Open'}</span
                  >
                </div>
                {#if assignment}
                  <a
                    href={`slack://user?team=${encodeURIComponent(assignment.workspaceId)}&id=${encodeURIComponent(assignment.volunteerUserId)}`}
                  >
                    {assignment.volunteerUserId}
                  </a>
                {:else if occurrence.status === 'OPEN'}
                  <p class="detail">A volunteer is needed.</p>
                {/if}
                <button
                  class="class-action secondary"
                  onclick={() => propose(occurrence)}
                  disabled={saving || !!change}
                  aria-label={`${occurrence.status === 'NO_SNACK' ? 'Open signup' : 'Mark no snack'} for ${occurrence.localDate}`}
                >
                  {occurrence.status === 'NO_SNACK'
                    ? 'Open signup'
                    : 'Mark no snack'}
                </button>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    {:else}
      <p>No life groups configured.</p>
    {/if}
  </section>
  <button onclick={refresh} disabled={loading || saving}
    >{error ? 'Try again' : 'Refresh'}</button
  >
  <footer>
    Direct interactions with the bot may be visible to group administrators.
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f4ee;
    color: #263f35;
    font-family: system-ui, sans-serif;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 64px 24px;
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 750;
    letter-spacing: 0.16em;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    font-size: 38px;
    letter-spacing: -0.04em;
    margin: 12px 0 0;
  }
  header p {
    color: #56635c;
  }
  .badge {
    border: 1px solid #b8c6b7;
    border-radius: 20px;
    padding: 7px 12px;
    font-size: 12px;
    white-space: nowrap;
  }
  .notice {
    margin: 28px 0;
    padding: 16px;
    background: #e8eee2;
    border-radius: 8px;
    line-height: 1.5;
  }
  section {
    min-height: 145px;
  }
  article {
    background: #fff;
    border: 1px solid #dddeda;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 16px;
  }
  h3 {
    font-size: 16px;
    margin: 24px 0 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-top: 1px solid #e5e9e3;
    padding: 14px 0;
  }
  li > div {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  a {
    color: #2d5743;
    overflow-wrap: anywhere;
  }
  .status {
    background: #e8eee2;
    border-radius: 20px;
    font-size: 12px;
    padding: 4px 10px;
  }
  .status.open {
    background: #fff0cf;
    color: #624b16;
  }
  .confirmation {
    padding: 24px;
    margin-bottom: 24px;
    border: 2px solid #477763;
    border-radius: 12px;
    background: white;
  }
  .confirmation p {
    line-height: 1.5;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .secondary {
    background: #e8eee2;
    color: #263f35;
  }
  .class-action {
    display: block;
    margin-top: 12px;
    padding: 8px 12px;
    font-size: 14px;
  }
  .detail {
    font-size: 14px;
    color: #56635c;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 24px;
  }
  article p {
    margin: 8px 0 0;
  }
  .timezone {
    font-size: 14px;
    color: #56635c;
  }
  button {
    margin-top: 20px;
    border: 0;
    border-radius: 7px;
    background: #2d5743;
    color: white;
    padding: 12px 20px;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.65;
    cursor: wait;
  }
  button:focus-visible {
    outline: 3px solid #477763;
    outline-offset: 3px;
  }
  footer {
    margin-top: 56px;
    font-size: 13px;
    line-height: 1.6;
    color: #56635c;
  }
  @media (max-width: 480px) {
    main {
      padding-top: 32px;
    }
    header {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
