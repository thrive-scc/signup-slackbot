// A class date is a local calendar date, not an instant to convert between zones.
export function dateLabel(localDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));
}

export function startTimeLabel(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}
