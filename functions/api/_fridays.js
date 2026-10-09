import { upcomingFridays } from "./_utils.js";

export const WEEKS_AHEAD = 16;
export const DEFAULT_VENUE = "Assembly Room - SENTAN";

// Upcoming Fridays are created on demand rather than by a scheduled job, so
// anything that lists them (the schedule page, the calendar feed) calls this
// first - otherwise it would come back empty until someone opened the page.
export async function ensureUpcomingRows(env) {
  const dates = upcomingFridays(new Date(), WEEKS_AHEAD);
  const stmt = env.DB.prepare(
    `INSERT INTO fridays (date, venue, is_history) VALUES (?, ?, 0)
     ON CONFLICT(date) DO NOTHING`
  );
  await env.DB.batch(dates.map((d) => stmt.bind(d, DEFAULT_VENUE)));
}

// A Friday with the names of whoever is assigned (the roster name, or the
// free text typed for a guest).
export const FRIDAY_SELECT = `
  SELECT
    f.id, f.date, f.venue, f.info, f.is_history, f.updated_by, f.updated_at,
    f.primary_khatib_id, COALESCE(pp.name, f.primary_khatib_name) AS primary_name,
    f.secondary_khatib_id, COALESCE(sp.name, f.secondary_khatib_name) AS secondary_name,
    f.imam_id, COALESCE(ip.name, f.imam_name) AS imam_name
  FROM fridays f
  LEFT JOIN people pp ON pp.id = f.primary_khatib_id
  LEFT JOIN people sp ON sp.id = f.secondary_khatib_id
  LEFT JOIN people ip ON ip.id = f.imam_id
`;
