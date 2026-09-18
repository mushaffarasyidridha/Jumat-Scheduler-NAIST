-- "sensei" was added to the role field (prayer-duty capability), but role
-- should only ever be khatib/imam/both - sensei is a title, not a duty, and
-- didn't even qualify anyone for either assignment dropdown once those got
-- role-scoped. Fold any existing sensei rows back to khatib as a default.
UPDATE people SET role = 'khatib' WHERE role = 'sensei';
