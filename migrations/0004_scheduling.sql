ALTER TABLE life_groups ADD COLUMN reminder_days_before INTEGER NOT NULL DEFAULT 3
  CHECK (reminder_days_before >= 0);
ALTER TABLE life_groups ADD COLUMN reminder_time TEXT NOT NULL DEFAULT '15:00'
  CHECK (reminder_time GLOB '[0-2][0-9]:[0-5][0-9]' AND reminder_time < '24:00');

-- Scheduled work has its own identity, not a manufactured operation receipt.
CREATE TABLE deliveries_replacement (
  id INTEGER PRIMARY KEY,
  life_group_id TEXT NOT NULL REFERENCES life_groups(id),
  request_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('INTERACTION_REPLY', 'CANCELLATION_NOTICE', 'REMINDER', 'CLASS_START')),
  channel_id TEXT,
  local_date TEXT,
  assignment_id TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_id TEXT,
  lease_until TEXT,
  last_error TEXT,
  retry_after_until TEXT,
  UNIQUE (life_group_id, request_id, kind),
  FOREIGN KEY (life_group_id, request_id) REFERENCES operation_receipts(life_group_id, request_id),
  CHECK ((status = 'SENDING' AND lease_id IS NOT NULL AND lease_until IS NOT NULL)
    OR (status != 'SENDING' AND lease_id IS NULL AND lease_until IS NULL)),
  CHECK (
    (kind IN ('INTERACTION_REPLY', 'CANCELLATION_NOTICE') AND request_id IS NOT NULL
      AND local_date IS NULL AND assignment_id IS NULL AND scheduled_at IS NULL)
    OR
    (kind IN ('REMINDER', 'CLASS_START') AND request_id IS NULL
      AND local_date IS NOT NULL AND scheduled_at IS NOT NULL AND expires_at > scheduled_at
      AND local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(local_date, '+0 days') IS local_date
      AND ((kind = 'REMINDER' AND assignment_id IS NOT NULL)
        OR (kind = 'CLASS_START' AND assignment_id IS NULL)))
  )
) STRICT;
INSERT INTO deliveries_replacement
  (id, life_group_id, request_id, kind, channel_id, status, attempts,
    available_at, expires_at, lease_id, lease_until, last_error)
SELECT id, life_group_id, request_id, kind, channel_id, status, attempts,
  available_at, expires_at, lease_id, lease_until, last_error FROM deliveries;
DROP TABLE deliveries;
ALTER TABLE deliveries_replacement RENAME TO deliveries;
CREATE INDEX deliveries_due ON deliveries(status, available_at);
CREATE UNIQUE INDEX delivery_class_start ON deliveries(life_group_id, local_date)
  WHERE kind = 'CLASS_START';
CREATE UNIQUE INDEX delivery_reminder ON deliveries(life_group_id, assignment_id)
  WHERE kind = 'REMINDER';
