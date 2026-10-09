import { json, badRequest, notFound, requireAccess } from "../_utils.js";

// The admin has seen it (and dealt with it): take it off the list.
export async function onRequestPatch({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const body = await request.json().catch(() => null);
  if (body?.acknowledged !== true) return badRequest("acknowledged: true is the only supported change");

  const result = await env.DB.prepare(
    "UPDATE availability_alerts SET acknowledged_at = datetime('now') WHERE id = ? AND acknowledged_at IS NULL"
  )
    .bind(id)
    .run();
  if (result.meta.changes === 0) {
    const exists = await env.DB.prepare("SELECT id FROM availability_alerts WHERE id = ?").bind(id).first();
    if (!exists) return notFound("alert not found");
  }
  return json({ id, acknowledged: true });
}
