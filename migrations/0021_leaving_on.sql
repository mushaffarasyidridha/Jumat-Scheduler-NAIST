-- Expected leaving date (NAIST or Nara), YYYY-MM-DD. The daily job moves a person who is still
-- active to "left NAIST" (status inactive) once this date has passed.
ALTER TABLE people ADD COLUMN leaving_on TEXT;
