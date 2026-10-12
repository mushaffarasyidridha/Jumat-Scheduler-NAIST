// Places: parsing what the admin typed, and the shape sent to the page.
import { parseToaRoomId } from "./_toa.mjs";

export const PLACE_COLUMNS = "id, name, details, maps_url, kultum_usual, toa_room_id, sort_order";

export function shapePlace(row) {
  return { id: row.id, name: row.name, details: row.details || "", maps_url: row.maps_url || "", kultum_usual: !!row.kultum_usual, toa_room_id: row.toa_room_id || "", sort_order: row.sort_order };
}

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// `given` says which fields were present (a PATCH only changes those).
export function parsePlace(body, { requireName }) {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const given = {};
  const out = { given };
  if ("name" in body || requireName) {
    const name = clean(body.name, 60);
    if (name.length < 2) return { error: "the place needs a name (at least 2 letters)" };
    out.name = name;
    given.name = true;
  }
  if ("details" in body) {
    out.details = clean(body.details, 300) || null;
    given.details = true;
  }
  if ("maps_url" in body) {
    const url = String(body.maps_url ?? "").trim();
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) return { error: "the map link must start with https://" };
    if (url.length > 300) return { error: "the map link is too long" };
    out.maps_url = url || null;
    given.maps_url = true;
  }
  if ("kultum_usual" in body) {
    out.kultum_usual = body.kultum_usual === true || body.kultum_usual === 1 ? 1 : 0;
    given.kultum_usual = true;
  }
  if ("toa_room_id" in body) {
    const id = parseToaRoomId(body.toa_room_id);
    if (id === null) return { error: "the TOA room id looks wrong: paste the room id (room_...) or the room link from the TOA app" };
    out.toa_room_id = id || null;
    given.toa_room_id = true;
  }
  if (requireName) {
    out.toa_room_id ??= null;
    out.details ??= null;
    out.maps_url ??= null;
    out.kultum_usual ??= 0;
  }
  return out;
}

// name (any case) -> place, for the announcement and the calendar text.
export function placeLookup(places) {
  const map = new Map((places || []).map((p) => [String(p.name).trim().toLowerCase(), p]));
  return (venue) => map.get(String(venue || "").trim().toLowerCase()) || null;
}
