import { json, badRequest, notFound, requireAccess } from "../_utils.js";

export async function onRequestPatch({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  const existing = await env.DB.prepare("SELECT is_history FROM fridays WHERE id = ?").bind(id).first();
  if (!existing) return notFound("friday not found");
  if (existing.is_history) return badRequest("historical rows are read-only");

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");

  const fields = [];
  const values = [];

  // A slot is filled either by picking a roster person (id) or typing a guest name.
  // Setting one clears the other so the UI's COALESCE(person name, free text) stays unambiguous.
  if ("primary_khatib_id" in body) {
    fields.push("primary_khatib_id = ?", "primary_khatib_name = ?");
    values.push(body.primary_khatib_id || null, body.primary_khatib_id ? null : body.primary_khatib_name || null);
  } else if ("primary_khatib_name" in body) {
    fields.push("primary_khatib_id = ?", "primary_khatib_name = ?");
    values.push(null, body.primary_khatib_name ? String(body.primary_khatib_name).trim() : null);
  }

  if ("secondary_khatib_id" in body) {
    fields.push("secondary_khatib_id = ?", "secondary_khatib_name = ?");
    values.push(body.secondary_khatib_id || null, body.secondary_khatib_id ? null : body.secondary_khatib_name || null);
  } else if ("secondary_khatib_name" in body) {
    fields.push("secondary_khatib_id = ?", "secondary_khatib_name = ?");
    values.push(null, body.secondary_khatib_name ? String(body.secondary_khatib_name).trim() : null);
  }

  if (typeof body.venue === "string" || body.venue === null) {
    fields.push("venue = ?");
    values.push(body.venue ? body.venue.trim() : null);
  }
  if (typeof body.info === "string" || body.info === null) {
    fields.push("info = ?");
    values.push(body.info ? body.info.trim() : null);
  }
  if (typeof body.updated_by === "string") {
    fields.push("updated_by = ?");
    values.push(body.updated_by.trim() || null);
  }

  if (fields.length === 0) return badRequest("nothing to update");

  fields.push("updated_at = datetime('now')");
  values.push(id);

  await env.DB.prepare(`UPDATE fridays SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await env.DB.prepare(
    `SELECT f.id, f.date, f.venue, f.info, f.is_history, f.updated_by, f.updated_at,
            f.primary_khatib_id, COALESCE(pp.name, f.primary_khatib_name) AS primary_name,
            f.secondary_khatib_id, COALESCE(sp.name, f.secondary_khatib_name) AS secondary_name
     FROM fridays f
     LEFT JOIN people pp ON pp.id = f.primary_khatib_id
     LEFT JOIN people sp ON sp.id = f.secondary_khatib_id
     WHERE f.id = ?`
  )
    .bind(id)
    .first();

  return json(row);
}
