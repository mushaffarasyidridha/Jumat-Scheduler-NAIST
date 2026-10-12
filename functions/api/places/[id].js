import { json, badRequest, notFound, requireAccess } from "../_utils.js";
import { parsePlace, shapePlace, PLACE_COLUMNS } from "../_places.mjs";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

export async function onRequestPatch({ request, env, params, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const old = await env.DB.prepare("SELECT name FROM places WHERE id = ?").bind(id).first();
  if (!old) return notFound("place not found");

  const body = await request.json().catch(() => null);
  const place = parsePlace(body, { requireName: false });
  if (place.error) return badRequest(place.error);

  const fields = [];
  const values = [];
  for (const key of ["name", "details", "maps_url", "kultum_usual", "toa_room_id"]) {
    if (key in place.given) {
      fields.push(`${key} = ?`);
      values.push(place[key]);
    }
  }
  if (!fields.length) return badRequest("nothing to update");
  if (place.given.name) {
    const same = await env.DB.prepare("SELECT id FROM places WHERE name = ? COLLATE NOCASE AND id <> ?").bind(place.name, id).first();
    if (same) return json({ error: "a place with that name already exists" }, { status: 409 });
  }
  await env.DB.prepare(`UPDATE places SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();
  // Renamed: the coming Fridays that used the old name follow it (past ones stay as they were).
  if (place.given.name && place.name !== old.name) {
    await env.DB.prepare("UPDATE fridays SET venue = ?, updated_at = datetime('now') WHERE is_history = 0 AND venue = ? COLLATE NOCASE")
      .bind(place.name, old.name)
      .run();
  }
  waitUntil(syncAfterEdit(env)); // the event's place and map link may have changed
  const row = await env.DB.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?`).bind(id).first();
  return json(shapePlace(row));
}

// Deleting a place only takes it off the dropdown: Fridays that used it keep the name as text.
export async function onRequestDelete({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const row = await env.DB.prepare("SELECT name FROM places WHERE id = ?").bind(id).first();
  if (!row) return notFound("place not found");
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM fridays WHERE is_history = 0 AND venue = ? COLLATE NOCASE").bind(row.name).first();
  await env.DB.prepare("DELETE FROM places WHERE id = ?").bind(id).run();
  return json({ ok: true, still_used_on: used.n });
}
