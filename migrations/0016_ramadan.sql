-- Ramadan: the dates, a weekly pattern, and one "gathering" (Isha + Tarawih, with a
-- kultum - the 7-minute talk - on chosen days) per day.
CREATE TABLE IF NOT EXISTS ramadan_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_date TEXT,                            -- first day of Ramadan (yyyy-mm-dd), NULL = not set
  end_date TEXT,                              -- last day
  default_start TEXT NOT NULL DEFAULT '19:30',   -- Isha / Tarawih start when a weekday has none
  kultum_minutes INTEGER NOT NULL DEFAULT 7,
  event_minutes INTEGER NOT NULL DEFAULT 90,     -- how long the calendar event lasts
  reminder_days TEXT NOT NULL DEFAULT '3,2,1,0'  -- days before to remind the kultum speaker (0 = the day itself)
);
INSERT OR IGNORE INTO ramadan_settings (id) VALUES (1);

-- Which weekdays (0 = Sunday ... 6 = Saturday) have a gathering, where, when, with kultum?
CREATE TABLE IF NOT EXISTS ramadan_pattern (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  active INTEGER NOT NULL DEFAULT 0,
  place TEXT,
  start_time TEXT,
  kultum INTEGER NOT NULL DEFAULT 0,
  reminders INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO ramadan_pattern (weekday) VALUES (0), (1), (2), (3), (4), (5), (6);

-- One row per day. Made from the pattern, then edited one by one.
CREATE TABLE IF NOT EXISTS gatherings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  place TEXT,                          -- a place name (like fridays.venue)
  start_time TEXT NOT NULL,
  kultum INTEGER NOT NULL DEFAULT 0,   -- is there a kultum that day?
  kultum_minutes INTEGER,              -- NULL = the setting
  speaker_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  speaker_name TEXT,                   -- a guest typed in by name
  reminders INTEGER NOT NULL DEFAULT 1,
  info TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gatherings_date ON gatherings (date);
