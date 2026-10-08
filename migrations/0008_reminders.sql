-- Automatic reminders: where to reach each person, plus a log so nobody gets
-- the same reminder twice and a heartbeat so the admin can see the job runs.

ALTER TABLE people ADD COLUMN email TEXT;

-- 1 = send reminders, 0 = opted out (admin switch, or the unsubscribe link in
-- every email).
ALTER TABLE people ADD COLUMN reminders INTEGER NOT NULL DEFAULT 1;

-- LINE can only push to someone who added the bot, and needs their internal
-- userId (not the LINE ID they type in the app). The webhook fills line_user_id
-- when the person sends the one-time link code the admin generated for them.
ALTER TABLE people ADD COLUMN line_user_id TEXT;
ALTER TABLE people ADD COLUMN line_link_code TEXT;
ALTER TABLE people ADD COLUMN line_link_expires TEXT;

-- Secret carried by the unsubscribe link in each email. Never returned by the API.
ALTER TABLE people ADD COLUMN reminder_token TEXT;
UPDATE people SET reminder_token = lower(hex(randomblob(16))) WHERE reminder_token IS NULL;

-- One row per reminder actually delivered. The UNIQUE key is what makes the
-- daily job safe to re-run: a reminder already logged is never sent again.
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  friday_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  kind TEXT NOT NULL,    -- '7d' | '1d'
  channel TEXT NOT NULL, -- 'email' | 'line'
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (friday_id, person_id, kind, channel)
);

-- One row per real (non dry-run) job run. The planner reads the latest one to
-- warn if the schedule has silently stopped.
CREATE TABLE IF NOT EXISTS reminder_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  mode TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
