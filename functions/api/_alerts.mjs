// "Can't make it" alerts: someone who is scheduled for a Friday marks
// themselves unavailable, and the admin has to find a replacement.
import shared from "../../public/reminder-message.js";

const { ROLE_SLOTS } = shared;

// Today in Japan (the prayer is there), whatever the server's clock says.
export function todayInJapan(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The ROLE_SLOTS labels this person holds on that Friday row.
export function rolesHeld(friday, personId) {
  return ROLE_SLOTS.filter((slot) => friday[slot.field] === personId).map((slot) => slot.label);
}

// Called when someone marks themselves unavailable. Raises an alert only if they
// really are scheduled that Friday, and it has not happened yet. Returns
// { id, created } for the alert, or null when there is nothing to alert about.
export async function recordUnavailable(env, personId, fridayId) {
  const friday = await env.DB.prepare(
    "SELECT id, date, is_history, primary_khatib_id, secondary_khatib_id, imam_id FROM fridays WHERE id = ?"
  )
    .bind(fridayId)
    .first();
  if (!friday || friday.is_history || friday.date < todayInJapan()) return null;

  const roles = rolesHeld(friday, personId);
  if (!roles.length) return null;
  const rolesText = roles.join(" + ");

  const open = await env.DB.prepare(
    "SELECT id FROM availability_alerts WHERE friday_id = ? AND person_id = ? AND resolved_at IS NULL"
  )
    .bind(fridayId, personId)
    .first();
  if (open) {
    await env.DB.prepare("UPDATE availability_alerts SET roles = ? WHERE id = ?").bind(rolesText, open.id).run();
    return { id: open.id, created: false };
  }
  const result = await env.DB.prepare("INSERT INTO availability_alerts (friday_id, person_id, roles) VALUES (?, ?, ?)")
    .bind(fridayId, personId, rolesText)
    .run();
  return { id: result.meta.last_row_id, created: true };
}

// They said they are available again (or cleared the mark): the alert is moot.
export async function resolveAlerts(env, personId, fridayId) {
  await env.DB.prepare(
    "UPDATE availability_alerts SET resolved_at = datetime('now') WHERE friday_id = ? AND person_id = ? AND resolved_at IS NULL"
  )
    .bind(fridayId, personId)
    .run();
}

// After the admin changes who is scheduled: an alert about someone who no longer
// holds any slot on that Friday is moot too.
export async function resolveStaleAlerts(env, fridayId) {
  const friday = await env.DB.prepare(
    "SELECT primary_khatib_id, secondary_khatib_id, imam_id FROM fridays WHERE id = ?"
  )
    .bind(fridayId)
    .first();
  if (!friday) return;
  const holders = [friday.primary_khatib_id, friday.secondary_khatib_id, friday.imam_id].filter((id) => id != null);
  const placeholders = holders.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE availability_alerts SET resolved_at = datetime('now')
     WHERE friday_id = ? AND resolved_at IS NULL${holders.length ? ` AND person_id NOT IN (${placeholders})` : ""}`
  )
    .bind(fridayId, ...holders)
    .run();
}
