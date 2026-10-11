import { ensureUpcomingRows, FRIDAY_SELECT } from "../_fridays.js";
import { buildCalendar } from "../_ics.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// /api/calendar/jumat.ics - the Friday schedule as a subscribable calendar. Public,
// like the schedule page itself: every NAIST student and staff member with a
// Google account can add it once and then see the khatib and imam for every
// Friday in their own calendar, without opening this site.
export async function onRequestGet({ request, env }) {
  await ensureUpcomingRows(env);

  // From last Friday on, so a subscriber still sees the week that just passed.
  const todayInJapan = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const from = new Date(Date.parse(todayInJapan) - 7 * DAY_MS).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`${FRIDAY_SELECT} WHERE f.is_history = 0 AND f.date >= ? ORDER BY f.date ASC`)
    .bind(from)
    .all();

  const { results: places } = await env.DB.prepare("SELECT name, details, maps_url FROM places").all();
  // Ramadan: the Isha + Tarawih days join the feed (a week back, like the Fridays).
  const settings = (await env.DB.prepare("SELECT kultum_minutes, event_minutes FROM ramadan_settings WHERE id = 1").first()) || {};
  const { results: gatherings } = await env.DB.prepare(
    `SELECT g.id, g.date, g.place, g.start_time, g.kultum, g.kultum_minutes, COALESCE(p.name, g.speaker_name) AS speaker, g.info, g.updated_at
     FROM gatherings g LEFT JOIN people p ON p.id = g.speaker_id WHERE g.date >= ? ORDER BY g.date ASC`
  )
    .bind(from)
    .all();
  return new Response(buildCalendar({ fridays: results, siteUrl: new URL(request.url).origin, places, gatherings, settings }), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Calendar apps poll on their own schedule; a short shared cache keeps
      // a burst of subscribers from each hitting the database.
      "cache-control": "public, max-age=600",
      "content-disposition": 'inline; filename="jumat-schedule.ics"',
    },
  });
}
