import { json, requireAccess, sqliteUtcToIso } from "../_utils.js";
import { todayInJapan } from "../_alerts.mjs";

// The "can't make it" alerts still waiting for the admin: someone scheduled for
// an upcoming Friday said they can't come, and nobody has dismissed it yet.
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.friday_id, f.date, a.person_id, p.name AS person_name, a.roles, a.created_at
     FROM availability_alerts a
     JOIN fridays f ON f.id = a.friday_id
     JOIN people p ON p.id = a.person_id
     WHERE a.resolved_at IS NULL AND a.acknowledged_at IS NULL AND f.date >= ?
     ORDER BY f.date ASC, a.id ASC`
  )
    .bind(todayInJapan())
    .all();
  return json(results.map((row) => ({ ...row, created_at: sqliteUtcToIso(row.created_at) })));
}
