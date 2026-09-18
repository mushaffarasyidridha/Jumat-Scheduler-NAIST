import { json, upcomingFridays } from "../_utils.js";

const WEEKS_AHEAD = 16;
const DEFAULT_VENUE = "Assembly Room - SENTAN";

async function ensureUpcomingRows(env) {
  const dates = upcomingFridays(new Date(), WEEKS_AHEAD);
  const stmt = env.DB.prepare(
    `INSERT INTO fridays (date, venue, is_history) VALUES (?, ?, 0)
     ON CONFLICT(date) DO NOTHING`
  );
  await env.DB.batch(dates.map((d) => stmt.bind(d, DEFAULT_VENUE)));
}

const SELECT = `
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

export async function onRequestGet({ request, env }) {
  await ensureUpcomingRows(env);

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope"); // "history" | "upcoming" | omitted = both

  let where = "";
  if (scope === "history") where = "WHERE f.is_history = 1";
  if (scope === "upcoming") where = "WHERE f.is_history = 0";

  const { results } = await env.DB.prepare(`${SELECT} ${where} ORDER BY f.date ASC`).all();
  return json(results);
}
