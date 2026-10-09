-- WhatsApp number for the planner's one-tap "send reminder" link. Stored as
-- "+<country code><number>" (digits only), which is what wa.me needs. Contact
-- info: only returned to people who hold the access code.
ALTER TABLE people ADD COLUMN whatsapp TEXT;
