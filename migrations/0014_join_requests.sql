-- "My name isn't listed": someone who is not on the roster types their name and
-- details; the admin is told (planner box + email) and adds them by hand.
CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  affiliation TEXT,              -- naist_student | naist_staff | dependent | outside
  country TEXT,
  role TEXT,                     -- khatib | imam | both (what they offer)
  email TEXT,
  whatsapp TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  emailed_at TEXT,               -- set once an admin has been emailed
  resolved_at TEXT,              -- added to the roster, or dismissed
  resolution TEXT                -- 'added' | 'dismissed'
);
