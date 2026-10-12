import { json, requireAccess } from "../_utils.js";
import { fetchRoomLocation } from "../_toa.mjs";
import { shapePlace, PLACE_COLUMNS } from "../_places.mjs";

// Admin: for every place linked to a TOA room and still without a map link, take the
// location from the TOA room (its pin, else its address). A link typed by hand is never
// replaced. Reports how many were filled and how many rooms have no location in TOA.
export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const { results: todo } = await env.DB.prepare(
    "SELECT id, toa_room_id, details FROM places WHERE toa_room_id IS NOT NULL AND toa_room_id <> '' AND (maps_url IS NULL OR trim(maps_url) = '')",
  ).all();
  const found = await Promise.all(todo.map((p) => fetchRoomLocation(p.toa_room_id, { baseUrl: env.TOA_WEB_URL || undefined })));
  const updates = [];
  let noLocation = 0;
  let unreachable = 0;
  todo.forEach((p, i) => {
    const loc = found[i];
    if (!loc) unreachable += 1;
    else if (!loc.maps_url) noLocation += 1;
    else updates.push(env.DB.prepare("UPDATE places SET maps_url = ?, details = COALESCE(NULLIF(trim(details), ''), ?) WHERE id = ?").bind(loc.maps_url, loc.address ? loc.address.slice(0, 300) : null, p.id));
  });
  if (updates.length) await env.DB.batch(updates);
  const all = (await env.DB.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY sort_order ASC, name COLLATE NOCASE ASC`).all()).results;
  return json({ filled: updates.length, noLocation, unreachable, checked: todo.length, places: all.map(shapePlace) });
}
