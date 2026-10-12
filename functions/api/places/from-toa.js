import { json, badRequest, requireAccess } from "../_utils.js";
import { planPlacesFromRooms, shapePlace, PLACE_COLUMNS } from "../_places.mjs";

// Admin: turn ticked TOA rooms (from the list the daily job keeps) into places, each
// already linked to its room. Body: { room_ids: ["room_...", ...] }.
export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.room_ids) ? body.room_ids.filter((id) => typeof id === "string").slice(0, 60) : null;
  if (!ids || !ids.length) return badRequest("tick at least one TOA room");

  const rooms = (await env.DB.prepare("SELECT id, name FROM toa_rooms").all()).results;
  const places = (await env.DB.prepare("SELECT name, toa_room_id FROM places").all()).results;
  const { create, skipped } = planPlacesFromRooms({ rooms, places, ids });

  if (create.length) {
    await env.DB.batch(
      create.map((r) =>
        env.DB.prepare("INSERT INTO places (name, toa_room_id, sort_order) VALUES (?, ?, 3)").bind(r.name, r.id),
      ),
    );
  }
  const all = (await env.DB.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY sort_order ASC, name COLLATE NOCASE ASC`).all()).results;
  return json({ created: create.length, skipped, places: all.map(shapePlace) });
}
