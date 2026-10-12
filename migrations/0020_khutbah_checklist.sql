-- The khutbah checklist: when ticked (the default), a khatib's reminders carry the five
-- rukun (pillars) of the Friday khutbah in the Shafi'i school and its main conditions.
ALTER TABLE people ADD COLUMN khutbah_checklist INTEGER NOT NULL DEFAULT 1;
