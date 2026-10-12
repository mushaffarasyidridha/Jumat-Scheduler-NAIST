import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToaRoomId, toaEntryKey, desiredToaEntry, planRoom, syncToa, createToaClient, changedFields } from "../functions/api/_toa.mjs";
import { parsePlace } from "../functions/api/_places.mjs";

const DB = "https://toa.test";
const NOW = Date.UTC(2027, 1, 1);

// A tiny Firebase: sign-in, web config and the Realtime Database REST calls.
function fakeFirebase({ password = "pw-secret", failRooms = [] } = {}) {
  const rooms = {};
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.hostname === "toa-rooms.pages.dev") return reply(200, { config: { apiKey: "public-key", databaseURL: DB } });
    if (u.hostname === "identitytoolkit.googleapis.com") {
      const b = JSON.parse(init.body);
      return b.password === password ? reply(200, { idToken: "tok", localId: "robot-uid" }) : reply(400, { error: { message: `INVALID_PASSWORD for ${b.email}` } });
    }
    const path = u.pathname.replace(/^\//, "").replace(/\.json$/, "");
    const m = path.match(/^prayerRooms\/([^/]+)\/prayerQueue(?:\/([^/]+))?$/);
    calls.push(`${init.method || "GET"} ${path}`);
    if (!m) return reply(404, null);
    if (failRooms.includes(m[1])) return reply(401, { error: "Permission denied" });
    const queue = (rooms[m[1]] ??= {});
    const entryKey = m[2];
    const method = init.method || "GET";
    if (method === "GET") {
      const start = JSON.parse(u.searchParams.get("startAt") || '""');
      return reply(200, Object.fromEntries(Object.entries(queue).filter(([k]) => k.startsWith(start))));
    }
    if (method === "PUT") queue[entryKey] = JSON.parse(init.body);
    if (method === "PATCH") queue[entryKey] = { ...queue[entryKey], ...JSON.parse(init.body) };
    if (method === "DELETE") delete queue[entryKey];
    return reply(200, null);
  };
  return { fetchImpl, rooms, calls };
}

const places = [
  { name: "Assembly Room - SENTAN", toa_room_id: "room_A" },
  { name: "Lounge Dorm 1", toa_room_id: "room_B" },
  { name: "Elsewhere", toa_room_id: null },
];
const settings = { kultum_minutes: 7, event_minutes: 90 };
const day = (over = {}) => ({ id: 1, date: "2027-02-08", place: "Assembly Room - SENTAN", start_time: "19:30", kultum: 1, kultum_minutes: null, speaker: "Ali", ...over });
const client = (fb) => createToaClient({ email: "robot@example.org", password: "pw-secret", fetchImpl: fb.fetchImpl });

test("a room id is taken from a bare id or from a TOA link", () => {
  assert.equal(parseToaRoomId("room_1789796426461"), "room_1789796426461");
  assert.equal(parseToaRoomId(" toa://room/room_17 "), "room_17");
  assert.equal(parseToaRoomId("https://toa-rooms.pages.dev/r/room_17"), "room_17");
  assert.equal(parseToaRoomId(""), "");
  assert.equal(parseToaRoomId("not a room!"), null);
  assert.equal(parseToaRoomId("https://evil.example/x/room_17"), null);
});

test("a place saves a cleaned TOA room id and rejects nonsense", () => {
  assert.equal(parsePlace({ name: "Hall", toa_room_id: "toa://room/room_9" }, { requireName: true }).toa_room_id, "room_9");
  assert.equal(parsePlace({ name: "Hall" }, { requireName: true }).toa_room_id, null);
  assert.equal(parsePlace({ toa_room_id: "" }, { requireName: false }).toa_room_id, null);
  assert.match(parsePlace({ toa_room_id: "a b" }, { requireName: false }).error, /TOA room id/);
});

test("an evening becomes a custom entry with the speaker where the board shows it", () => {
  const e = desiredToaEntry(day(), { settings });
  assert.equal(e.entryType, "custom");
  assert.equal(e.customLabel, "Isha + Tarawih · Kultum 7 min");
  assert.equal(e.speakerName, "Ali");
  assert.equal(e.khatibName, "Ali");
  assert.equal(e.recurrence, "once");
  assert.equal(e.scheduledTime, Date.UTC(2027, 1, 8, 10, 30)); // 19:30 Japan time
  assert.equal(e.endTime - e.scheduledTime, 90 * 60000);
  assert.equal(e.notes, "Place: Assembly Room - SENTAN");
  assert.equal(toaEntryKey("2027-02-08"), "sched_2027-02-08_isha_tarawih");
});

test("a day without kultum has no speaker and no talk in its label; the day's own minutes win", () => {
  const plain = desiredToaEntry(day({ kultum: 0 }), { settings });
  assert.equal(plain.customLabel, "Isha + Tarawih");
  assert.equal(plain.speakerName, "");
  assert.equal(plain.durationMinutes, 0);
  assert.equal(desiredToaEntry(day({ kultum_minutes: 10 }), { settings }).customLabel, "Isha + Tarawih · Kultum 10 min");
  assert.equal(desiredToaEntry(day({ speaker: null }), { settings }).speakerName, "");
});

test("an update changes only the fields it owns", () => {
  const wanted = desiredToaEntry(day(), { settings });
  assert.deepEqual(changedFields({ ...wanted, status: "done", attendeeCount: 5 }, wanted), {});
  assert.deepEqual(changedFields({ ...wanted, speakerName: "Old" }, wanted), { speakerName: "Ali" });
});

test("sync creates the evenings in the linked rooms, once, and skips places without a room", async () => {
  const fb = fakeFirebase();
  const gatherings = [day(), day({ id: 2, date: "2027-02-10", place: "Lounge Dorm 1", kultum: 0 }), day({ id: 3, date: "2027-02-12", place: "Elsewhere" })];
  const r = await syncToa({ client: client(fb), gatherings, places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(r.created, 2);
  assert.equal(r.withoutRoom, 1);
  assert.deepEqual(Object.keys(fb.rooms.room_A), ["sched_2027-02-08_isha_tarawih"]);
  assert.deepEqual(Object.keys(fb.rooms.room_B), ["sched_2027-02-10_isha_tarawih"]);
  const made = fb.rooms.room_A["sched_2027-02-08_isha_tarawih"];
  assert.equal(made.addedBy, "robot-uid");
  assert.equal(made.status, "pending");
  assert.equal(made.topic, "");
  const again = await syncToa({ client: client(fb), gatherings, places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(again.created + again.updated + again.removed, 0);
  assert.equal(again.same, 2);
});

test("a changed speaker updates the entry without touching attendees or status", async () => {
  const fb = fakeFirebase();
  await syncToa({ client: client(fb), gatherings: [day()], places, settings, today: "2027-02-01", nowMs: NOW });
  const key = "sched_2027-02-08_isha_tarawih";
  fb.rooms.room_A[key].attendees = { u1: { displayName: "Zed", joinedAt: 1 } };
  fb.rooms.room_A[key].status = "done";
  const r = await syncToa({ client: client(fb), gatherings: [day({ speaker: "Omar" })], places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(r.updated, 1);
  assert.equal(fb.rooms.room_A[key].speakerName, "Omar");
  assert.equal(fb.rooms.room_A[key].status, "done");
  assert.equal(fb.rooms.room_A[key].attendees.u1.displayName, "Zed");
});

test("a deleted day removes its own future entry only", async () => {
  const fb = fakeFirebase();
  await syncToa({ client: client(fb), gatherings: [day(), day({ id: 2, date: "2027-02-09" })], places, settings, today: "2027-02-01", nowMs: NOW });
  fb.rooms.room_A.someone_elses = { addedBy: "other", scheduledTime: Date.UTC(2027, 1, 20) };
  fb.rooms.room_A["sched_2027-01-01_isha_tarawih"] = { addedBy: "robot-uid", scheduledTime: Date.UTC(2027, 0, 1) }; // already past
  const r = await syncToa({ client: client(fb), gatherings: [day()], places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(r.removed, 1);
  assert.ok(!fb.rooms.room_A["sched_2027-02-09_isha_tarawih"]);
  assert.ok(fb.rooms.room_A.someone_elses);
  assert.ok(fb.rooms.room_A["sched_2027-01-01_isha_tarawih"], "past entries are history, never deleted");
});

test("an entry with our key made by someone else is left alone", () => {
  const wanted = new Map([["sched_x", desiredToaEntry(day(), { settings })]]);
  const plan = planRoom({ wanted, existing: { sched_x: { addedBy: "intruder" } }, uid: "robot-uid", nowMs: NOW });
  assert.equal(plan.foreign, 1);
  assert.equal(plan.create.length + plan.update.length + plan.remove.length, 0);
});

test("a dry run reads but never writes", async () => {
  const fb = fakeFirebase();
  const r = await syncToa({ client: client(fb), gatherings: [day()], places, settings, today: "2027-02-01", nowMs: NOW, dryRun: true });
  assert.equal(r.created, 1);
  assert.ok(!fb.calls.some((c) => /^(PUT|PATCH|DELETE)/.test(c)));
  assert.deepEqual(fb.rooms.room_A, {});
});

test("one room failing does not stop the others, and the error carries no password", async () => {
  const fb = fakeFirebase({ failRooms: ["room_A"] });
  const r = await syncToa({ client: client(fb), gatherings: [day(), day({ id: 2, date: "2027-02-10", place: "Lounge Dorm 1" })], places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(r.failed, 1);
  assert.equal(r.created, 1);
  assert.ok(!JSON.stringify(r).includes("pw-secret"));
});

test("a wrong password fails clearly without printing it or the email", async () => {
  const fb = fakeFirebase({ password: "other" });
  await assert.rejects(
    () => syncToa({ client: client(fb), gatherings: [day()], places, settings, today: "2027-02-01", nowMs: NOW }),
    (e) => /sign-in failed/.test(e.message) && !e.message.includes("pw-secret") && !e.message.includes("robot@example.org")
  );
});

test("past days and an empty set of linked rooms do nothing at all", async () => {
  const fb = fakeFirebase();
  const none = await syncToa({ client: client(fb), gatherings: [day()], places: [{ name: "x", toa_room_id: null }], settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(none.rooms, 0);
  assert.equal(fb.calls.length, 0);
  const past = await syncToa({ client: client(fb), gatherings: [day({ date: "2027-01-20" })], places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal(past.created, 0);
});

test("the rooms the account administers are listed by name, and no others", async () => {
  const meta = {
    room_owned: { name: "Musholla BS", admin: "robot-uid" },
    room_added: { name: "Dorm 7", admin: "someone", admins: { "robot-uid": true } },
    room_other: { name: "Not ours", admin: "someone", admins: { x: true } },
    room_noperm: { name: "Locked", admin: "robot-uid" },
    "bad id": { name: "Ignored", admin: "robot-uid" },
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.hostname === "toa-rooms.pages.dev") return reply(200, { config: { apiKey: "k", databaseURL: DB } });
    if (u.hostname === "identitytoolkit.googleapis.com") return reply(200, { idToken: "tok", localId: "robot-uid" });
    const parts = u.pathname.replace(/^\//, "").replace(/\.json$/, "").split("/");
    if (parts.length === 1) return reply(200, u.searchParams.get("shallow") === "true" ? Object.fromEntries(Object.keys(meta).map((k) => [k, true])) : meta);
    const [, id, field, sub] = parts;
    if (id === "room_noperm") return reply(401, { error: "Permission denied" });
    const room = meta[id] || {};
    return reply(200, sub ? room[field]?.[sub] ?? null : room[field] ?? null);
  };
  const rooms = await createToaClient({ email: "robot@example.org", password: "pw", fetchImpl }).listAdminRooms();
  assert.deepEqual(rooms, [{ id: "room_added", name: "Dorm 7" }, { id: "room_owned", name: "Musholla BS" }]);
});
