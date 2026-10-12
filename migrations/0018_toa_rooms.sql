-- The TOA app rooms that the TOA account is an admin of (id and name). The daily job
-- refreshes this list, so the Places card can offer the rooms by name instead of
-- making the admin type each long room id.
CREATE TABLE IF NOT EXISTS toa_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
