-- "Can't make it" alerts. When someone who is scheduled as khatib / imam marks
-- themselves unavailable for that Friday, the admin is told: on the website
-- (the planner lists open alerts) and by email.
CREATE TABLE IF NOT EXISTS availability_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  friday_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  roles TEXT NOT NULL,          -- how they were scheduled, e.g. 'Primary khatib + Imam'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  emailed_at TEXT,              -- set once the admin has been emailed
  acknowledged_at TEXT,         -- the admin dismissed it on the website
  resolved_at TEXT              -- they are available again, or no longer scheduled
);

-- One live alert per person per Friday; once resolved, a new one can be raised.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_open
  ON availability_alerts (friday_id, person_id) WHERE resolved_at IS NULL;
