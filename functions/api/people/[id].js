import { json, badRequest, notFound, requireAccess } from "../_utils.js";

export async function onRequestDelete({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  // Clean up references rather than leaving dangling ids behind: past
  // availability for this person is no longer meaningful, and any Friday
  // they were assigned to just reopens rather than pointing at a ghost.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM availability WHERE person_id = ?").bind(id),
    env.DB.prepare("UPDATE fridays SET primary_khatib_id = NULL WHERE primary_khatib_id = ?").bind(id),
    env.DB.prepare("UPDATE fridays SET secondary_khatib_id = NULL WHERE secondary_khatib_id = ?").bind(id),
  ]);

  const result = await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return notFound("person not found");

  return json({ id });
}

export async function onRequestPatch({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");

  const fields = [];
  const values = [];

  if (typeof body.country === "string" || body.country === null) {
    fields.push("country = ?");
    values.push(body.country ? body.country.trim() : null);
  }
  if (["khatib", "imam", "both"].includes(body.role)) {
    fields.push("role = ?");
    values.push(body.role);
  }
  if (["active", "inactive"].includes(body.status)) {
    fields.push("status = ?");
    values.push(body.status);
  }
  if (typeof body.note === "string" || body.note === null) {
    fields.push("note = ?");
    values.push(body.note ? body.note.trim() : null);
  }

  if (fields.length === 0) return badRequest("nothing to update");

  fields.push("updated_at = datetime('now')");
  values.push(id);

  const result = await env.DB.prepare(`UPDATE people SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  if (result.meta.changes === 0) return notFound("person not found");

  const person = await env.DB.prepare(
    "SELECT id, name, country, role, status, note FROM people WHERE id = ?"
  )
    .bind(id)
    .first();
  return json(person);
}
