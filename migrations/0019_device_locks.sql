-- The name lock, remembered on the server: each browser that has chosen a name is one
-- row, so a person can use several devices and the admin can reset any one of them (or
-- all of a person's). Only a hash of the device's secret token is stored.
CREATE TABLE IF NOT EXISTS device_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,                                    -- "iPhone, Safari": how the admin tells devices apart
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_locks_person ON device_locks (person_id);
