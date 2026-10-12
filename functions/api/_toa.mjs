// Pushes the Ramadan evenings (Isha + Tarawih, with the kultum speaker) into the
// TOA app's room queue, so TOA's room board and phones show them.
//
// How it talks to TOA: TOA keeps its rooms in a Firebase Realtime Database that
// anyone can read. Writing needs a signed-in account, so the job signs in as one
// dedicated TOA account (email + password, kept as GitHub secrets) and writes
// only entries it created itself (keys start with "sched_"). It never touches
// the room, its admins, or other people's entries. Pure functions plus a small
// REST client with an injectable fetch, so the whole thing is unit-tested.
import { gatheringWindowUtc } from "./_ics.mjs";

export const ENTRY_PREFIX = "sched_";
export const DEFAULT_WEB_CONFIG_URL = "https://toa-rooms.pages.dev/api/web-config";

// A TOA room id, typed bare ("room_1789796426461") or pasted as a link
// (toa://room/ID or https://toa-rooms.pages.dev/r/ID). null when it is neither.
export function parseToaRoomId(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  const link = text.match(/^(?:toa:\/\/room\/|https:\/\/[^\s/]+\/r\/)([A-Za-z0-9_-]{3,64})\/?(?:[?#].*)?$/);
  const id = link ? link[1] : text;
  return /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null;
}

export function toaEntryKey(date) {
  return `${ENTRY_PREFIX}${date}_isha_tarawih`;
}

// The queue entry for one evening. `custom` on purpose: a "prayer" entry would get
// an iqomah countdown that means nothing for Tarawih. The speaker goes in
// speakerName (the board shows that, not khatibName) and the topic stays empty
// (a topic replaces the label on the board). Times are epoch milliseconds.
export function desiredToaEntry(g, { settings = {} } = {}) {
  const { startMs, endMs } = gatheringWindowUtc(g, settings.event_minutes || 90);
  const minutes = g.kultum_minutes ?? settings.kultum_minutes ?? 7;
  const speaker = g.kultum ? (g.speaker || "").trim() : "";
  const place = (g.place || "").trim();
  return {
    entryType: "custom",
    customLabel: g.kultum ? `Isha + Tarawih · Kultum ${minutes} min` : "Isha + Tarawih",
    speakerName: speaker,
    khatibName: speaker,
    durationMinutes: g.kultum ? Number(minutes) || 0 : 0,
    scheduledTime: startMs,
    endTime: endMs,
    recurrence: "once",
    notes: place ? `Place: ${place}` : "",
  };
}

// Fields an update may change. Everything else (status, attendees, addedBy, ...)
// belongs to TOA and the people using it, so an update never overwrites it.
export const OWNED_FIELDS = ["entryType", "customLabel", "speakerName", "khatibName", "durationMinutes", "scheduledTime", "endTime", "recurrence", "notes"];

export function changedFields(existing, wanted) {
  const out = {};
  for (const f of OWNED_FIELDS) {
    const a = existing[f] ?? (typeof wanted[f] === "number" ? 0 : "");
    if (a !== wanted[f]) out[f] = wanted[f];
  }
  return out;
}

// gatherings (from the database) + places (with toa_room_id) -> what should exist.
export function desiredByRoom({ gatherings, places, settings, today }) {
  const roomOf = new Map(places.filter((p) => p.toa_room_id).map((p) => [String(p.name).trim().toLowerCase(), p.toa_room_id]));
  const rooms = new Map([...new Set(roomOf.values())].map((r) => [r, new Map()]));
  let withoutRoom = 0;
  for (const g of gatherings) {
    if (g.date < today) continue;
    const room = roomOf.get(String(g.place || "").trim().toLowerCase());
    if (!room) {
      withoutRoom++;
      continue;
    }
    rooms.get(room).set(toaEntryKey(g.date), desiredToaEntry(g, { settings }));
  }
  return { rooms, withoutRoom };
}

// What has to change in one room: create, update (only the fields that differ) or
// remove (our own future entries that are no longer wanted).
export function planRoom({ wanted, existing, uid, nowMs }) {
  const plan = { create: [], update: [], remove: [], same: 0, foreign: 0 };
  for (const [key, entry] of wanted) {
    const have = existing[key];
    if (!have) plan.create.push({ key, entry });
    else if (have.addedBy !== uid) plan.foreign++;
    else {
      const diff = changedFields(have, entry);
      if (Object.keys(diff).length) plan.update.push({ key, diff });
      else plan.same++;
    }
  }
  for (const [key, have] of Object.entries(existing)) {
    if (wanted.has(key) || !key.startsWith(ENTRY_PREFIX)) continue;
    if (have.addedBy === uid && Number(have.scheduledTime) > nowMs) plan.remove.push({ key });
  }
  return plan;
}

// ---------- the REST client ----------

const redactSecrets = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.split(s).join("***"), String(text));

export function createToaClient({ email, password, webConfigUrl = DEFAULT_WEB_CONFIG_URL, apiKey, dbUrl, fetchImpl = fetch }) {
  let session = null;
  const fail = (what, res, body) => new Error(`TOA ${what} failed (HTTP ${res.status})${body?.error?.message ? `: ${redactSecrets(body.error.message, [email, password])}` : ""}`);

  async function connect() {
    if (session) return session;
    let key = apiKey;
    let db = dbUrl;
    if (!key || !db) {
      const res = await fetchImpl(webConfigUrl);
      const cfg = await res.json().catch(() => null);
      if (!res.ok || !cfg?.config?.apiKey) throw new Error("TOA web config has no apiKey (is the TOA site configured?)");
      key = key || cfg.config.apiKey;
      db = db || cfg.config.databaseURL;
    }
    const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.idToken) throw fail("sign-in", res, body);
    session = { token: body.idToken, uid: body.localId, db: db.replace(/\/$/, "") };
    return session;
  }

  async function call(method, path, payload, query = "") {
    const s = await connect();
    const res = await fetchImpl(`${s.db}/${path}.json?auth=${encodeURIComponent(s.token)}${query}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw fail(`${method} ${path.split("/")[0]}`, res, { error: { message: body?.error } });
    return body;
  }

  return {
    uid: async () => (await connect()).uid,
    // Only the entries this job owns (keys starting with "sched_").
    async listOwn(room) {
      const q = `&orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent(`"${ENTRY_PREFIX}"`)}&endAt=${encodeURIComponent(`"${ENTRY_PREFIX}"`)}`;
      return (await call("GET", `prayerRooms/${room}/prayerQueue`, undefined, q)) || {};
    },
    async create(room, key, entry, uid, nowMs) {
      await call("PUT", `prayerRooms/${room}/prayerQueue/${key}`, { ...entry, topic: "", status: "pending", addedBy: uid, addedAt: nowMs, attendeeCount: 0 });
    },
    async update(room, key, diff) {
      await call("PATCH", `prayerRooms/${room}/prayerQueue/${key}`, diff);
    },
    async remove(room, key) {
      await call("DELETE", `prayerRooms/${room}/prayerQueue/${key}`);
    },
  };
}

// Brings every mapped room in step with the schedule. Counts only: nothing here
// is meant to put names, rooms or addresses in a public log.
export async function syncToa({ client, gatherings, places, settings, today, nowMs = Date.now(), dryRun = false }) {
  const { rooms, withoutRoom } = desiredByRoom({ gatherings, places, settings, today });
  const result = { rooms: rooms.size, created: 0, updated: 0, removed: 0, same: 0, foreign: 0, withoutRoom, failed: 0, errors: [] };
  if (!rooms.size) return result;
  const uid = await client.uid();
  for (const [room, wanted] of rooms) {
    try {
      const plan = planRoom({ wanted, existing: await client.listOwn(room), uid, nowMs });
      result.same += plan.same;
      result.foreign += plan.foreign;
      if (dryRun) {
        result.created += plan.create.length;
        result.updated += plan.update.length;
        result.removed += plan.remove.length;
        continue;
      }
      for (const { key, entry } of plan.create) {
        await attempt(result, () => client.create(room, key, entry, uid, nowMs), "created");
      }
      for (const { key, diff } of plan.update) {
        await attempt(result, () => client.update(room, key, diff), "updated");
      }
      for (const { key } of plan.remove) {
        await attempt(result, () => client.remove(room, key), "removed");
      }
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
