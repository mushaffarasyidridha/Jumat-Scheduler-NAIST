import { json } from "../_utils.js";
import { hashDeviceToken } from "../_devices.mjs";

// Public: does this browser's lock still stand? The page asks when it opens, so a lock
// the admin has reset is released on that device (it can choose a name again).
export async function onRequestGet({ request, env }) {
  const token = request.headers.get("x-device-token") || "";
  if (!token) return json({ valid: false });
  const hash = await hashDeviceToken(token);
  const row = await env.DB.prepare("SELECT id, person_id FROM device_locks WHERE token_hash = ?").bind(hash).first();
  if (!row) return json({ valid: false });
  await env.DB.prepare("UPDATE device_locks SET last_seen_at = datetime('now') WHERE id = ? AND last_seen_at < datetime('now', '-6 hours')").bind(row.id).run();
  return json({ valid: true, person_id: row.person_id });
}
