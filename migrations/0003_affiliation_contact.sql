-- Broaden the roster beyond NAIST khatib/imam students (outside community
-- members, sensei), and add a contact field that the API only returns to
-- callers with the access code.

ALTER TABLE people ADD COLUMN affiliation TEXT NOT NULL DEFAULT 'naist'; -- 'naist' | 'outside'
ALTER TABLE people ADD COLUMN contact TEXT;
