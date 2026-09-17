-- Jumat Scheduler NAIST - initial schema

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  role TEXT NOT NULL DEFAULT 'khatib', -- 'khatib' | 'imam' | 'both'
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fridays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE, -- ISO yyyy-mm-dd, always a Friday
  venue TEXT,
  info TEXT,
  primary_khatib_id INTEGER REFERENCES people(id),
  primary_khatib_name TEXT, -- free text fallback (guest speakers, historical rows)
  secondary_khatib_id INTEGER REFERENCES people(id),
  secondary_khatib_name TEXT,
  is_history INTEGER NOT NULL DEFAULT 0, -- 1 = imported archive row, read-only in UI
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  friday_id INTEGER NOT NULL REFERENCES fridays(id),
  status TEXT NOT NULL, -- 'available' | 'unavailable'
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, friday_id)
);

CREATE INDEX IF NOT EXISTS idx_fridays_date ON fridays(date);
CREATE INDEX IF NOT EXISTS idx_availability_friday ON availability(friday_id);
CREATE INDEX IF NOT EXISTS idx_availability_person ON availability(person_id);
