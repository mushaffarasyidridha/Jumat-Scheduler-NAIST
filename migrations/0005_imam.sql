-- The original spreadsheet only ever tracked Primary/Secondary khatib per
-- week (imam was just a separate "who's willing" list, not a weekly
-- assignment), so that's all the schedule form carried over. Add a real
-- per-week imam slot, same shape as the khatib ones.

ALTER TABLE fridays ADD COLUMN imam_id INTEGER REFERENCES people(id);
ALTER TABLE fridays ADD COLUMN imam_name TEXT;
