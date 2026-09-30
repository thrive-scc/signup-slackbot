-- Read-only harness configuration. Classes/assignments arrive in M1.
CREATE TABLE life_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slack_workspace_id TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  timezone TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time < '24:00'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time < '24:00'),
  schedule_start_date TEXT NOT NULL
) STRICT;
