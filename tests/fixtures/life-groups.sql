-- Synthetic only. Deliberately no production Slack identifiers.
INSERT INTO life_groups (
  id, name, slack_workspace_id, slack_channel_id, timezone,
  weekday, start_time, end_time, schedule_start_date
) VALUES (
  'thrive-fixture', 'Thrive (sample)', 'T_FIXTURE', 'C_FIXTURE', 'America/Chicago',
  0, '09:30', '11:45', '2026-01-01'
) ON CONFLICT(id) DO NOTHING;
