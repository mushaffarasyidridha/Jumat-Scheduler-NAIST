-- Who is the admin this period. Admins get a to-do reminder before each Friday:
-- send the reminder by hand to whoever is not reached automatically (WhatsApp /
-- Facebook), and post the announcement in the WhatsApp and Facebook groups.
-- A flag on the roster (not a fixed address in code) so it can change hands.
ALTER TABLE people ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
