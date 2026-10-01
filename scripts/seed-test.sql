-- Deliberate remote seed for thrivescc.slack.com / #general.
-- Upcoming dates on this weekly cadence are implicitly OPEN.
INSERT INTO life_groups
  (id, name, slack_workspace_id, slack_channel_id, timezone, weekday,
   start_time, end_time, schedule_start_date, reminder_days_before, reminder_time)
VALUES
  ('thrive-test', 'Thrive', 'T03PJ6WU2', 'C03PJ6X08', 'America/Chicago', 0,
   '09:30', '11:45', '2026-09-27', 3, '15:00')
ON CONFLICT(id) DO NOTHING;
