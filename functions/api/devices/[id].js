import { json, badRequest, notFound, requireAccess } from "../_utils.js";

// Admin: reset one device (it can choose a name again the next time it opens the page).
export async function onRequestDelete({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const result = await env.DB.prepare("DELETE FROM device_locks WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return notFound("device not found");
  return json({ id });
}
