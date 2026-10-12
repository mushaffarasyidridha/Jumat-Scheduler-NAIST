import { json, requireAccess } from "./_utils.js";

// The TOA rooms the TOA account administers (kept fresh by the daily job), for the
// Places card's TOA room dropdown. Admin only.
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const { results } = await env.DB.prepare("SELECT id, name FROM toa_rooms ORDER BY name COLLATE NOCASE ASC").all();
  return json(results);
}
