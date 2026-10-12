-- The TOA app room (its id) that a place corresponds to. When set, the daily job
-- adds each Ramadan evening held at this place to that room's TOA queue.
ALTER TABLE places ADD COLUMN toa_room_id TEXT;
