-- Invitation test mode: while this holds addresses (comma separated), only those
-- addresses are invited to Google Calendar events; everyone else is left out. NULL = normal.
ALTER TABLE gcal_state ADD COLUMN invite_only TEXT;
