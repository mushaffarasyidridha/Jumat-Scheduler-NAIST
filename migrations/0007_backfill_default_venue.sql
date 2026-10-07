-- Upcoming Fridays created before the default-venue change were stored with
-- no venue (the default only applies to rows created after it), so their
-- announcements read "at TBA". Give them the same default new rows get.
-- Archived rows are left alone: they're a record of what the spreadsheet said.
UPDATE fridays
SET venue = 'Assembly Room - SENTAN'
WHERE is_history = 0 AND (venue IS NULL OR trim(venue) = '');
