-- Split the "naist" affiliation into its actual categories: students and
-- staff aren't the same thing for roster purposes, and a dependent (e.g. a
-- student's spouse) is neither, while still living at/around NAIST.
-- Existing "naist" rows came from the original student khatib roster, so
-- they map to naist_student; "outside" is unaffected.

UPDATE people SET affiliation = 'naist_student' WHERE affiliation = 'naist';
