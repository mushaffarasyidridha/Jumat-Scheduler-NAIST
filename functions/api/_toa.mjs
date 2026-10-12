// Adds the Ramadan evenings (Isha + Tarawih, with the kultum speaker) to the TOA
// app's room queues, so TOA's room board and phones show them.
//
// How it talks to TOA: through TOA's own API for schedulers (/api/v1). A person
// makes a secret key in the TOA app (Settings, Integration keys); the key acts as
// that person on the rooms they administer, and nothing else. The job sends each
// evening with an "externalId" of ours, so sending it again updates the same entry
// instead of adding another, and with notify=false so the people nearby are not
// told about every evening of Ramadan. Pure functions plus a small REST client
// with an injectable fetch, so the whole thing is unit-tested.
import shared from "../../public/reminder-message.js";
import { gatheringWindowUtc } from "./_ics.mjs";

const { prayerWindowUtc } = shared;

export const API_URL = "https://toa-rooms.pages.dev/api/v1";
export const EXTERNAL_PREFIX = "naist-ramadan-";
// The first version wrote entries straight into TOA's database under keys like
// "sched_2027-02-08_isha_tarawih". They are replaced by the API's entries.
export const LEGACY_PREFIX = "sched_";
const TARAWIH_LABEL = "Isha + Tarawih";

// A TOA room id, typed bare ("room_1789796426461") or pasted as a link
// (toa://room/ID or https://toa-rooms.pages.dev/r/ID). null when it is neither.
export function parseToaRoomId(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  const link = text.match(/^(?:toa:\/\/room\/|https:\/\/[^\s/]+\/r\/)([A-Za-z0-9_-]{3,64})\/?(?:[?#].*)?$/);
  const id = link ? link[1] : text;
  return /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null;
}

export function toaExternalId(date) {
  return `${EXTERNAL_PREFIX}${date}`;
}

// 2027-02-08T19:30:00+09:00 for a UTC millisecond value (Japan time, as TOA reads it).
function jstIso(ms) {
  return `${new Date(ms + 9 * 3600e3).toISOString().slice(0, 19)}+09:00`;
}

// What one evening should look like in TOA: the request to send and what the queue
// should then show (to tell whether the entry already matches). `custom` on purpose:
// a "prayer" entry would get an iqomah countdown that means nothing for Tarawih.
export function desiredToaEntry(g, { settings = {} } = {}) {
  const { startMs, endMs } = gatheringWindowUtc(g, settings.event_minutes || 90);
  const minutes = g.kultum_minutes ?? settings.kultum_minutes ?? 7;
  const speaker = g.kultum ? (g.speaker || "").trim().slice(0, 60) : "";
  const place = (g.place || "").trim();
  const label = g.kultum ? `${TARAWIH_LABEL} · Kultum ${minutes} min` : TARAWIH_LABEL;
  const note = place ? `Place: ${place}`.slice(0, 200) : "";
  return {
    startMs,
    body: {
      type: "custom",
      label,
      time: jstIso(startMs),
      end: jstIso(endMs),
      speaker,
      note,
      repeat: "once",
      notify: false,
      externalId: toaExternalId(g.date),
    },
    expect: { label, leader: speaker, time: startMs, end: endMs, note },
  };
}

// Does a queue item (as the API lists it) already match what we want?
export function matches(item, expect) {
  return item.label === expect.label && (item.leader || "") === expect.leader && item.time === expect.time && item.end === expect.end && (item.note || "") === expect.note;
}

// gatherings (from the database) + places (with toa_room_id) -> what should exist, per room.
export function desiredByRoom({ gatherings, places, settings, today, nowMs }) {
  const roomOf = new Map(places.filter((p) => p.toa_room_id).map((p) => [String(p.name).trim().toLowerCase(), p.toa_room_id]));
  const rooms = new Map([...new Set(roomOf.values())].map((r) => [r, new Map()]));
  let withoutRoom = 0;
  let past = 0;
  for (const g of gatherings) {
    if (g.date < today) continue;
    const room = roomOf.get(String(g.place || "").trim().toLowerCase());
    if (!room) {
      withoutRoom++;
      continue;
    }
    const want = desiredToaEntry(g, { settings });
    // TOA refuses a one-off that began more than an hour ago: leave it as history.
    if (want.startMs < nowMs - 50 * 60000) {
      past++;
      continue;
    }
    rooms.get(room).set(want.body.externalId, want);
  }
  return { rooms, withoutRoom, past };
}

// What has to change in one room: add, update, or remove our own future entries that
// are no longer wanted (and the first version's entries, which the API's replace).
export function planRoom({ wanted, queue, nowMs }) {
  const plan = { create: [], update: [], remove: [], same: 0 };
  const byExternal = new Map(queue.filter((q) => q.externalId).map((q) => [q.externalId, q]));
  for (const [externalId, want] of wanted) {
    const have = byExternal.get(externalId);
    if (!have) plan.create.push(want);
    else if (!matches(have, want.expect)) plan.update.push(want);
    else plan.same++;
  }
  for (const item of queue) {
    if (!(item.time > nowMs)) continue;
    const ours = item.externalId && item.externalId.startsWith(EXTERNAL_PREFIX) && !wanted.has(item.externalId);
    const legacy = !item.externalId && String(item.id).startsWith(LEGACY_PREFIX) && String(item.label).startsWith(TARAWIH_LABEL);
    if (ours || legacy) plan.remove.push({ id: item.id });
  }
  return plan;
}

// ---------- bookings (rooms that are open only when booked) ----------
//
// A TOA room set to "only open when booked" is closed to the public outside its
// bookings. For a linked place whose room is like that, every Friday prayer and
// Ramadan evening held there becomes a booking at exactly the scheduled time, kept
// in step with the schedule (moved, changed or removed with it).

export const BOOKING_PREFIX = "naist-";
export const fridayExternalId = (date) => `naist-friday-${date}`;

// fridays ({date, venue}) + gatherings + places -> the bookings that should exist, per room.
export function desiredBookingsByRoom({ fridays, gatherings, places, settings, today, nowMs }) {
  const roomOf = new Map(places.filter((p) => p.toa_room_id).map((p) => [String(p.name).trim().toLowerCase(), p.toa_room_id]));
  const rooms = new Map([...new Set(roomOf.values())].map((r) => [r, new Map()]));
  const add = (placeName, externalId, startMs, endMs, note) => {
    const room = roomOf.get(String(placeName || "").trim().toLowerCase());
    if (!room || endMs <= nowMs) return;
    rooms.get(room).set(externalId, {
      startMs,
      endMs,
      body: { start: jstIso(startMs), end: jstIso(endMs), note, externalId },
    });
  };
  for (const f of fridays) {
    if (f.date < today) continue;
    const { startMs, endMs } = prayerWindowUtc(f.date);
    add(f.venue, fridayExternalId(f.date), startMs, endMs, "Friday prayer");
  }
  for (const g of gatherings) {
    if (g.date < today) continue;
    const { startMs, endMs } = gatheringWindowUtc(g, settings.event_minutes || 90);
    add(g.place, toaExternalId(g.date), startMs, endMs, TARAWIH_LABEL);
  }
  return rooms;
}

// What has to change in one room's bookings. `replaceOthers` (only when asked for by
// hand) also removes someone else's one-off booking that overlaps one of ours, so a
// hand-made booking for the same prayer is replaced by the scheduled one.
export function planBookings({ wanted, bookings, nowMs, replaceOthers = false }) {
  const plan = { create: [], update: [], remove: [], replace: [], same: 0, left: 0 };
  const ours = (b) => b.externalId && b.externalId.startsWith(BOOKING_PREFIX);
  const byExternal = new Map(bookings.filter(ours).map((b) => [b.externalId, b]));
  for (const [externalId, want] of wanted) {
    const have = byExternal.get(externalId);
    if (!have) plan.create.push(want);
    else if (have.start !== want.startMs || have.end !== want.endMs || (have.note || "") !== want.body.note) plan.update.push(want);
    else plan.same++;
  }
  for (const b of bookings) {
    if (!(b.end > nowMs)) continue;
    if (ours(b)) {
      if (!wanted.has(b.externalId)) plan.remove.push({ id: b.id });
      continue;
    }
    const overlaps = [...wanted.values()].some((w) => b.start < w.endMs && b.end > w.startMs);
    if (!overlaps) continue;
    if (replaceOthers && b.repeat !== "weekly") plan.replace.push({ id: b.id });
    else plan.left++;
  }
  return plan;
}

// ---------- the REST client ----------

export function createToaClient({ key, baseUrl = API_URL, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-timezone": "Asia/Tokyo" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) {
      const why = data?.message ? `: ${String(data.message).split(key).join("***")}` : "";
      throw new Error(`TOA ${method} ${path.replace(/\/rooms\/[^/]+/, "/rooms/...").replace(/\/queue\/.+/, "/queue/...")} failed (HTTP ${res.status})${why}`);
    }
    return data;
  }
  const room = (id) => `/rooms/${encodeURIComponent(id)}`;
  return {
    // The rooms the key's owner administers: [{ id, name, role, ... }]. Also proves the key works.
    async rooms() {
      return (await call("GET", "/rooms")).rooms || [];
    },
    // One room's settings and bookings (availability, bookings with local times, queue size).
    async room(roomId) {
      const data = await call("GET", room(roomId));
      delete data.ok;
      return data;
    },
    // Bookings: one-off or weekly windows during which a book-only room is open.
    addBooking: (roomId, body) => call("POST", `${room(roomId)}/bookings`, body),
    removeBooking: (roomId, id) => call("DELETE", `${room(roomId)}/bookings/${encodeURIComponent(id)}`),
    async queue(roomId) {
      return (await call("GET", `${room(roomId)}/queue`)).queue || [];
    },
    // Adds the entry, or updates the one with the same externalId.
    add: (roomId, body) => call("POST", `${room(roomId)}/queue`, body),
    remove: (roomId, id) => call("DELETE", `${room(roomId)}/queue/${encodeURIComponent(id)}`),
  };
}

// Brings every linked room in step with the schedule. Counts only: nothing here is
// meant to put names, rooms or addresses in a public log.
export async function syncToa({ client, gatherings, places, settings, today, nowMs = Date.now(), dryRun = false, adminRooms = null }) {
  const { rooms, withoutRoom, past } = desiredByRoom({ gatherings, places, settings, today, nowMs });
  const result = { rooms: rooms.size, created: 0, updated: 0, removed: 0, same: 0, notAdmin: 0, withoutRoom, past, failed: 0, errors: [] };
  const allowed = adminRooms ? new Set(adminRooms.map((r) => r.id)) : null;
  for (const [room, wanted] of rooms) {
    if (allowed && !allowed.has(room)) {
      result.notAdmin++;
      continue;
    }
    try {
      const plan = planRoom({ wanted, queue: await client.queue(room), nowMs });
      result.same += plan.same;
      if (dryRun) {
        result.created += plan.create.length;
        result.updated += plan.update.length;
        result.removed += plan.remove.length;
        continue;
      }
      for (const want of plan.create) await attempt(result, () => client.add(room, want.body), "created");
      for (const want of plan.update) await attempt(result, () => client.add(room, want.body), "updated");
      for (const { id } of plan.remove) await attempt(result, () => client.remove(room, id), "removed");
    } catch (e) {
      result.failed++;
      result.errors.push(e.message);
    }
  }
  return result;
}

async function attempt(result, action, counter) {
  try {
    await action();
    result[counter]++;
  } catch (e) {
    result.failed++;
    result.errors.push(e.message);
  }
}

// Brings the bookings of every linked book-only room in step with the schedule.
// Rooms that are open all the time need no bookings and are skipped.
export async function syncToaBookings({ client, fridays, gatherings, places, settings, today, nowMs = Date.now(), dryRun = false, adminRooms, replaceOthers = false }) {
  const rooms = desiredBookingsByRoom({ fridays, gatherings, places, settings, today, nowMs });
  const result = { rooms: 0, created: 0, updated: 0, removed: 0, replaced: 0, same: 0, left: 0, alwaysOpen: 0, notAdmin: 0, failed: 0, errors: [] };
  const info = new Map(adminRooms.map((r) => [r.id, r]));
  for (const [room, wanted] of rooms) {
    const meta = info.get(room);
    if (!meta) {
      result.notAdmin++;
      continue;
    }
    if (meta.availability !== "booked") {
      result.alwaysOpen++;
      continue;
    }
    result.rooms++;
    try {
      const data = await client.room(room);
      const plan = planBookings({ wanted, bookings: data.bookings || [], nowMs, replaceOthers });
      result.same += plan.same;
      result.left += plan.left;
      if (dryRun) {
        result.created += plan.create.length;
        result.updated += plan.update.length;
        result.removed += plan.remove.length;
        continue;
      }
      for (const want of plan.create) await attempt(result, () => client.addBooking(room, want.body), "created");
      for (const want of plan.update) await attempt(result, () => client.addBooking(room, want.body), "updated");
      for (const { id } of plan.remove) await attempt(result, () => client.removeBooking(room, id), "removed");
      for (const { id } of plan.replace) await attempt(result, () => client.removeBooking(room, id), "replaced");
    } catch (e) {
      result.failed++;
      result.errors.push(e.message);
    }
  }
  return result;
}

// ---- a room's location, as a Google Maps link ----
// TOA shows each room's public view (name, address, the pin the room's admin dropped)
// without a key, at /api/room/{id}. A members-only room, or one with no pin or address,
// has no location there. The pin wins over the address: it is exact.
export const WEB_URL = "https://toa-rooms.pages.dev";

export function mapsUrlFromView(view) {
  const lat = Number(view?.latitude);
  const lng = Number(view?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const address = String(view?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
}

// { maps_url, address } for one room; maps_url is "" when TOA has no location for it,
// and null when TOA could not be reached (so the caller can tell the two apart).
export async function fetchRoomLocation(roomId, { fetchImpl = fetch, baseUrl = WEB_URL } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/api/room/${encodeURIComponent(roomId)}`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return { maps_url: "", address: "" };
    if (!res.ok) return null;
    const view = await res.json();
    return { maps_url: mapsUrlFromView(view), address: String(view?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 300) };
  } catch {
    return null;
  }
}
