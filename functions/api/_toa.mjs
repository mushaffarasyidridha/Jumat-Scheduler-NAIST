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
import { gatheringWindowUtc } from "./_ics.mjs";

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
