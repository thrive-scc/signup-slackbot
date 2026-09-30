-- Preserve M1 receipts and activity while extending their vocabulary.
CREATE TABLE operation_receipts_v2 (
  life_group_id TEXT NOT NULL REFERENCES life_groups(id),
  request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'SIGNUP'
    CHECK (operation IN ('SIGNUP', 'CANCEL', 'CHANGE', 'NO_SNACK', 'OPEN')),
  target_date TEXT,
  expected_assignment_id TEXT,
  expected_status TEXT CHECK (expected_status IN ('OPEN', 'ASSIGNED', 'NO_SNACK')),
  previous_assignment_id TEXT,
  previous_volunteer_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'PENDING', 'SIGNED_UP', 'ALREADY_SIGNED_UP', 'TAKEN', 'NO_SNACK',
    'CANCELLED', 'CHANGED', 'MARKED_NO_SNACK', 'OPENED', 'UNCHANGED',
    'NOT_OWNER', 'STALE', 'CLOSED'
  )),
  assignment_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (life_group_id, request_id)
) STRICT;
INSERT INTO operation_receipts_v2
  (life_group_id, request_id, attempt_id, actor_user_id, local_date, outcome, assignment_id, created_at)
SELECT life_group_id, request_id, attempt_id, actor_user_id, local_date, outcome, assignment_id, created_at
FROM operation_receipts;
DROP TABLE operation_receipts;
ALTER TABLE operation_receipts_v2 RENAME TO operation_receipts;

CREATE TABLE activity_v2 (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  life_group_id TEXT REFERENCES life_groups(id),
  local_date TEXT,
  assignment_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('SIGNUP', 'CALENDAR_DOWNLOAD', 'CANCEL', 'CHANGE', 'NO_SNACK', 'OPEN')),
  outcome TEXT NOT NULL,
  target_date TEXT,
  previous_assignment_id TEXT,
  previous_volunteer_id TEXT
) STRICT;
INSERT INTO activity_v2 (id, occurred_at, life_group_id, local_date, assignment_id, actor_user_id, kind, outcome)
SELECT id, occurred_at, life_group_id, local_date, assignment_id, actor_user_id, kind, outcome FROM activity;
DROP TABLE activity;
ALTER TABLE activity_v2 RENAME TO activity;
CREATE INDEX activity_group_time ON activity(life_group_id, occurred_at);

-- Only identifiers are retained; no tokens, response URLs, or raw Slack payloads.
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  life_group_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('INTERACTION_REPLY', 'CANCELLATION_NOTICE')),
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_id TEXT,
  lease_until TEXT,
  last_error TEXT,
  UNIQUE (life_group_id, request_id, kind),
  FOREIGN KEY (life_group_id, request_id) REFERENCES operation_receipts(life_group_id, request_id),
  CHECK ((status = 'SENDING' AND lease_id IS NOT NULL AND lease_until IS NOT NULL)
    OR (status != 'SENDING' AND lease_id IS NULL AND lease_until IS NULL))
) STRICT;
CREATE INDEX deliveries_due ON deliveries(status, available_at);
