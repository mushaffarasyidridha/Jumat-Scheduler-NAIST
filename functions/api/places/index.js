import { json, badRequest, requireAccess } from "../_utils.js";
import { parsePlace, shapePlace, PLACE_COLUMNS } from "../_places.mjs";

// Public: the places (a Friday's venue is public anyway). The admin manages them.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY sort_order ASC, name COLLATE NOCASE ASC`).all();
  return json(results.map(shapePlace));
}

export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const place = parsePlace(body, { requireName: true });
  if (place.error) return badRequest(place.error);

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM places").first();
  if (count.n >= 30) return badRequest("that is a lot of places (30): delete one you no longer use first");
  const same = await env.DB.prepare("SELECT id FROM places WHERE name = ? COLLATE NOCASE").bind(place.name).first();
  if (same) return json({ error: "a place with that name already exists" }, { status: 409 });

  const result = await env.DB.prepare("INSERT INTO places (name, details, maps_url, kultum_usual, sort_order) VALUES (?, ?, ?, ?, ?)")
    .bind(place.name, place.details, place.maps_url, place.kultum_usual, 3)
    .run();
  const row = await env.DB.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?`).bind(result.meta.last_row_id).first();
  return json(shapePlace(row), { status: 201 });
}
