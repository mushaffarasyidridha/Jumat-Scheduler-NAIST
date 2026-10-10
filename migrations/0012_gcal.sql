-- Google Calendar: one event per Friday on a shared (public) calendar, kept up to
-- date by a small Google Apps Script "bridge" running in the community account.

-- The NAIST (Google) account to invite to the Friday they are scheduled for.
-- Optional, and only for people who hold the access code to see; never public.
ALTER TABLE people ADD COLUMN calendar_email TEXT;

-- What was last sent to Google for each Friday (a hash, plus the content so the
-- next change can tell whether guests are notified or the edit is quiet).
CREATE TABLE IF NOT EXISTS gcal_sync (
  friday_id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row: which calendar the bridge writes to (learned from its first answer, so
-- the home page can link to the public calendar) and how the last sync went.
CREATE TABLE IF NOT EXISTS gcal_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calendar_id TEXT,
  last_ok_at TEXT,
  last_error TEXT,
  last_error_at TEXT
);
INSERT OR IGNORE INTO gcal_state (id) VALUES (1);
