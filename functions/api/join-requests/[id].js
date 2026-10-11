import { json, badRequest, notFound, requireAccess } from "../_utils.js";

// Admin: close a request, because they were added to the roster or the admin
// dismissed it (spam, duplicate, not a member).
export async function onRequestPatch({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const body = await request.json().catch(() => null);
  if (!body || !["added", "dismissed"].includes(body.resolution)) return badRequest('resolution must be "added" or "dismissed"');

  const result = await env.DB.prepare("UPDATE join_requests SET resolved_at = datetime('now'), resolution = ? WHERE id = ? AND resolved_at IS NULL")
    .bind(body.resolution, id)
    .run();
  if (!result.meta.changes) return notFound("request not found or already closed");
  return json({ ok: true });
}
