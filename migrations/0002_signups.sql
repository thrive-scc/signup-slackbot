CREATE TABLE classes (
  life_group_id TEXT NOT NULL REFERENCES life_groups(id),
  local_date TEXT NOT NULL CHECK (
    local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(local_date, '+0 days') IS local_date
  ),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ASSIGNED', 'NO_SNACK')),
  volunteer_user_id TEXT,
  assignment_id TEXT UNIQUE,
  assigned_at TEXT,
  starts_at TEXT,
  ends_at TEXT,
  PRIMARY KEY (life_group_id, local_date),
  CHECK (
    (status = 'ASSIGNED' AND volunteer_user_id IS NOT NULL
      AND length(volunteer_user_id) > 0 AND assignment_id IS NOT NULL
      AND assigned_at IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND ends_at > starts_at)
    OR
    (status IN ('OPEN', 'NO_SNACK') AND volunteer_user_id IS NULL
      AND assignment_id IS NULL AND assigned_at IS NULL
      AND starts_at IS NULL AND ends_at IS NULL)
  )
) STRICT;

-- A batch inserts a receipt, conditionally claims the class, finalizes the
-- outcome and records activity together. Its attempt ID gates concurrent retries.
CREATE TABLE operation_receipts (
  life_group_id TEXT NOT NULL REFERENCES life_groups(id),
  request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'PENDING', 'SIGNED_UP', 'ALREADY_SIGNED_UP', 'TAKEN', 'NO_SNACK'
  )),
  assignment_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (life_group_id, request_id)
) STRICT;

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  life_group_id TEXT REFERENCES life_groups(id),
  local_date TEXT,
  assignment_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('SIGNUP', 'CALENDAR_DOWNLOAD')),
  outcome TEXT NOT NULL
) STRICT;
CREATE INDEX activity_group_time ON activity(life_group_id, occurred_at);
