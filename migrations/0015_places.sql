-- Places (dorm lounges, the Sentan assembly room, ...) the admin can add, edit and
-- delete, and pick from a dropdown instead of typing the venue every time.
-- Fridays keep the place NAME as text (fridays.venue), so deleting a place never
-- breaks an old Friday; renaming a place renames it on the coming Fridays.
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  details TEXT,                      -- how to find it, floor, notes (shown in the announcement)
  maps_url TEXT,                     -- optional Google Maps link
  kultum_usual INTEGER NOT NULL DEFAULT 0,  -- a 7-minute talk (kultum) is usually given here
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO places (name, maps_url, kultum_usual, sort_order)
VALUES ('Assembly Room - SENTAN', 'https://maps.app.goo.gl/Dd44PcXYVqFm7KDA6', 1, 1);

-- Every other place already used on a Friday becomes a place too.
INSERT OR IGNORE INTO places (name, sort_order)
SELECT DISTINCT trim(venue), 2 FROM fridays WHERE venue IS NOT NULL AND trim(venue) <> '';
