import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToaRoomId, toaExternalId, desiredToaEntry, planRoom, syncToa, createToaClient, matches, syncToaBookings, planBookings, desiredBookingsByRoom } from "../functions/api/_toa.mjs";
import { parsePlace } from "../functions/api/_places.mjs";

const NOW = Date.UTC(2027, 1, 1);
const KEY = "toa_" + "k".repeat(40);

// A tiny TOA: GET /rooms, GET/POST/DELETE /rooms/{room}/queue, answering like TOA's /api/v1.
function fakeToa({ adminOf = ["room_A", "room_B"], names = { room_A: "Musholla BS", room_B: "Dorm 7" }, availability = { room_A: "booked", room_B: "booked" }, failRooms = [], key = KEY } = {}) {
  const queues = {};
  const bookings = {};
  const calls = [];
  let nextId = 1;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    calls.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization });
    if (init.headers?.authorization !== `Bearer ${key}`) return reply(401, { ok: false, error: "invalid_key", message: `The key ${init.headers?.authorization} is not valid.` });
    const parts = u.pathname.replace(/^\/api\/v1/, "").split("/").filter(Boolean);
    if (parts[0] === "rooms" && parts.length === 1) return reply(200, { ok: true, rooms: adminOf.map((id) => ({ id, name: names[id] || id, role: "admin", availability: availability[id] || "always" })) });
    const [, room, kind, id] = parts;
    if (!adminOf.includes(room)) return reply(403, { ok: false, error: "not_an_admin", message: "not an admin" });
    if (failRooms.includes(room)) return reply(502, { ok: false, error: "upstream_failed", message: "Could not reach the database." });
    if (parts.length === 2) return reply(200, { ok: true, id: room, availability: availability[room] || "always", bookings: bookings[room] ??= [] });
    if (kind === "bookings") {
      const list = (bookings[room] ??= []);
      if (method === "DELETE") {
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) return reply(404, { ok: false, error: "not_found" });
        list.splice(i, 1);
        return reply(200, { ok: true, removed: id });
      }
      if (method === "POST") {
        const b = JSON.parse(init.body);
        const item = { start: Date.parse(b.start), end: Date.parse(b.end), note: b.note || "", repeat: "once", externalId: b.externalId || "" };
        const have = b.externalId && list.find((x) => x.externalId === b.externalId);
        if (have) {
          Object.assign(have, item);
          return reply(200, { ok: true, id: have.id, created: false, updated: true });
        }
        list.push({ id: `-B${nextId++}`, ...item });
        return reply(200, { ok: true, id: list.at(-1).id, created: true });
      }
      return reply(200, { ok: true, bookings: list });
    }
    const queue = (queues[room] ??= []);
    if (method === "GET") return reply(200, { ok: true, queue });
    if (method === "DELETE") {
      const i = queue.findIndex((q) => q.id === id);
      if (i < 0) return reply(404, { ok: false, error: "not_found", message: "No such entry" });
      queue.splice(i, 1);
      return reply(200, { ok: true, removed: id });
    }
    if (method === "POST") {
      const b = JSON.parse(init.body);
      const item = {
        type: b.type, prayer: "", label: b.label, time: Date.parse(b.time), end: Date.parse(b.end),
        leader: b.speaker || "", topic: "", repeat: b.repeat, note: b.note || "", status: "pending", externalId: b.externalId || "",
      };
      const have = b.externalId && queue.find((q) => q.externalId === b.externalId);
      if (have) {
        Object.assign(have, item);
        return reply(200, { ok: true, id: have.id, created: false, updated: true });
      }
      queue.push({ id: `-N${nextId++}`, ...item });
      return reply(200, { ok: true, id: queue.at(-1).id, created: true, notified: b.notify !== false });
    }
    return reply(404, { ok: false, error: "not_found" });
  };
  return { fetchImpl, queues, bookings, calls };
}

const places = [
  { name: "Assembly Room - SENTAN", toa_room_id: "room_A" },
  { name: "Lounge Dorm 1", toa_room_id: "room_B" },
  { name: "Elsewhere", toa_room_id: null },
];
const settings = { kultum_minutes: 7, event_minutes: 90 };
const day = (over = {}) => ({ id: 1, date: "2027-02-08", place: "Assembly Room - SENTAN", start_time: "19:30", kultum: 1, kultum_minutes: null, speaker: "Ali", ...over });
const client = (fake, key = KEY) => createToaClient({ key, fetchImpl: fake.fetchImpl, baseUrl: "https://toa.test/api/v1" });
const run = (fake, over = {}) => syncToa({ client: client(fake), gatherings: [day()], places, settings, today: "2027-02-01", nowMs: NOW, ...over });
const writes = (fake) => fake.calls.filter((c) => c.method !== "GET");

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

test("an evening is a custom entry with the speaker, Japan time, our own id and no notification", () => {
  const { body, expect, startMs } = desiredToaEntry(day(), { settings });
  assert.deepEqual(body, {
    type: "custom",
    label: "Isha + Tarawih · Kultum 7 min",
    time: "2027-02-08T19:30:00+09:00",
    end: "2027-02-08T21:00:00+09:00",
    speaker: "Ali",
    note: "Place: Assembly Room - SENTAN",
    repeat: "once",
    notify: false,
    externalId: "naist-ramadan-2027-02-08",
  });
  assert.equal(startMs, Date.UTC(2027, 1, 8, 10, 30));
  assert.equal(expect.end - expect.time, 90 * 60000);
  assert.equal(toaExternalId("2027-02-08"), "naist-ramadan-2027-02-08");
});

test("a day without kultum has no speaker and no talk in its label; the day's own minutes win", () => {
  assert.equal(desiredToaEntry(day({ kultum: 0 }), { settings }).body.label, "Isha + Tarawih");
  assert.equal(desiredToaEntry(day({ kultum: 0 }), { settings }).body.speaker, "");
  assert.equal(desiredToaEntry(day({ kultum_minutes: 10 }), { settings }).body.label, "Isha + Tarawih · Kultum 10 min");
  assert.equal(desiredToaEntry(day({ speaker: null }), { settings }).body.speaker, "");
});

test("the key proves itself by listing the rooms, and a wrong key is refused without printing it", async () => {
  const fake = fakeToa();
  assert.deepEqual((await client(fake).rooms()).map((r) => r.name), ["Musholla BS", "Dorm 7"]);
  const wrong = "toa_" + "x".repeat(40);
  await assert.rejects(
    () => client(fake, wrong).rooms(),
    (e) => /HTTP 401/.test(e.message) && !e.message.includes(wrong)
  );
});

test("sync adds the evenings to the linked rooms, once, and skips places without a room", async () => {
  const fake = fakeToa();
  const gatherings = [day(), day({ id: 2, date: "2027-02-10", place: "Lounge Dorm 1", kultum: 0 }), day({ id: 3, date: "2027-02-12", place: "Elsewhere" })];
  const r = await run(fake, { gatherings });
  assert.equal(r.created, 2);
  assert.equal(r.withoutRoom, 1);
  assert.equal(fake.queues.room_A.length, 1);
  assert.equal(fake.queues.room_B.length, 1);
  assert.ok(writes(fake).every((c) => c.body.notify === false), "no write tells the people nearby");
  assert.ok(fake.calls.every((c) => c.auth === `Bearer ${KEY}`));
  const again = await run(fake, { gatherings });
  assert.equal(again.created + again.updated + again.removed, 0);
  assert.equal(again.same, 2);
});

test("a changed speaker or time updates the same entry rather than adding another", async () => {
  const fake = fakeToa();
  await run(fake);
  const r = await run(fake, { gatherings: [day({ speaker: "Omar", start_time: "20:00" })] });
  assert.equal(r.updated, 1);
  assert.equal(fake.queues.room_A.length, 1);
  assert.equal(fake.queues.room_A[0].leader, "Omar");
  assert.equal(fake.queues.room_A[0].time, Date.UTC(2027, 1, 8, 11, 0));
});

test("a deleted day removes its own future entry, and nobody else's", async () => {
  const fake = fakeToa();
  await run(fake, { gatherings: [day(), day({ id: 2, date: "2027-02-09" })] });
  fake.queues.room_A.push({ id: "-others", label: "Kajian", externalId: "", time: Date.UTC(2027, 1, 20), end: 0 });
  fake.queues.room_A.push({ id: "-ext", label: "Class", externalId: "someone-else-1", time: Date.UTC(2027, 1, 21), end: 0 });
  fake.queues.room_A.push({ id: "-past", label: "Isha + Tarawih", externalId: "naist-ramadan-2027-01-01", time: Date.UTC(2027, 0, 1), end: 0 });
  const r = await run(fake);
  assert.equal(r.removed, 1);
  assert.deepEqual(fake.queues.room_A.map((q) => q.id).filter((id) => id.startsWith("-") && !id.startsWith("-N")), ["-others", "-ext", "-past"]);
  assert.equal(fake.queues.room_A.filter((q) => q.externalId === "naist-ramadan-2027-02-09").length, 0);
});

test("the first version's database-written entries are replaced by the API's, not doubled", async () => {
  const fake = fakeToa();
  fake.queues.room_A = [
    { id: "sched_2027-02-08_isha_tarawih", label: "Isha + Tarawih · Kultum 7 min", externalId: "", time: Date.UTC(2027, 1, 8, 10, 30), end: Date.UTC(2027, 1, 8, 12, 0) },
    { id: "sched_2027-01-05_isha_tarawih", label: "Isha + Tarawih", externalId: "", time: Date.UTC(2027, 0, 5), end: 0 },
  ];
  const r = await run(fake);
  assert.equal(r.created, 1);
  assert.equal(r.removed, 1, "only the future legacy entry goes");
  assert.deepEqual(fake.queues.room_A.map((q) => q.id).sort(), ["-N1", "sched_2027-01-05_isha_tarawih"]);
});

test("an evening that began over an hour ago is left alone as history", async () => {
  const fake = fakeToa();
  const r = await run(fake, { gatherings: [day({ date: "2027-02-01", start_time: "00:30" })], nowMs: Date.UTC(2027, 1, 1, 15, 31) });
  assert.equal(r.past, 1);
  assert.equal(r.created, 0);
  assert.equal(writes(fake).length, 0);
});

test("a dry run reads but never writes", async () => {
  const fake = fakeToa();
  const r = await run(fake, { dryRun: true });
  assert.equal(r.created, 1);
  assert.equal(writes(fake).length, 0);
});

test("a room the key's owner does not administer is skipped, and one failing room does not stop the others", async () => {
  const fake = fakeToa({ adminOf: ["room_A", "room_B"], failRooms: ["room_A"] });
  const gatherings = [day(), day({ id: 2, date: "2027-02-10", place: "Lounge Dorm 1" })];
  const r = await run(fake, { gatherings });
  assert.equal(r.failed, 1);
  assert.equal(r.created, 1);
  assert.ok(!JSON.stringify(r).includes(KEY));
  const other = await run(fakeToa({ adminOf: ["room_B"] }), { gatherings, adminRooms: [{ id: "room_B" }] });
  assert.equal(other.notAdmin, 1);
  assert.equal(other.created, 1);
});

test("an existing entry is recognised as matching only when everything shown is the same", () => {
  const { expect } = desiredToaEntry(day(), { settings });
  const item = { label: expect.label, leader: "Ali", time: expect.time, end: expect.end, note: expect.note };
  assert.equal(matches(item, expect), true);
  assert.equal(matches({ ...item, leader: "Omar" }, expect), false);
  assert.equal(matches({ ...item, note: "" }, expect), false);
});

test("no linked rooms means nothing is read or written", async () => {
  const fake = fakeToa();
  const r = await run(fake, { places: [{ name: "x", toa_room_id: null }] });
  assert.equal(r.rooms, 0);
  assert.equal(fake.calls.length, 0);
});

test("planRoom: add, update, same and removal", () => {
  const a = desiredToaEntry(day(), { settings });
  const wanted = new Map([[a.body.externalId, a]]);
  const plan = planRoom({ wanted, queue: [], nowMs: NOW });
  assert.equal(plan.create.length, 1);
  const have = { id: "x", externalId: a.body.externalId, ...{ label: a.expect.label, leader: a.expect.leader, time: a.expect.time, end: a.expect.end, note: a.expect.note } };
  assert.equal(planRoom({ wanted, queue: [have], nowMs: NOW }).same, 1);
  assert.equal(planRoom({ wanted, queue: [{ ...have, leader: "Old" }], nowMs: NOW }).update.length, 1);
});

// ---------- bookings ----------

const friday = (over = {}) => ({ date: "2027-02-12", venue: "Assembly Room - SENTAN", ...over });
const syncBookings = (fake, over = {}) =>
  syncToaBookings({
    client: client(fake),
    fridays: [friday()],
    gatherings: [],
    places,
    settings,
    today: "2027-02-01",
    nowMs: NOW,
    adminRooms: [
      { id: "room_A", availability: "booked" },
      { id: "room_B", availability: "booked" },
    ],
    ...over,
  });

test("a Friday prayer at a book-only room becomes a booking at exactly the scheduled time", async () => {
  const fake = fakeToa();
  const r = await syncBookings(fake);
  assert.equal(r.created, 1);
  const b = fake.bookings.room_A[0];
  assert.equal(b.externalId, "naist-friday-2027-02-12");
  assert.equal(b.start, Date.UTC(2027, 1, 12, 3, 35)); // 12:35 Japan time
  assert.equal(b.end - b.start, 30 * 60000);
  assert.equal(b.note, "Friday prayer");
  const again = await syncBookings(fake);
  assert.equal(again.created + again.updated + again.removed, 0);
  assert.equal(again.same, 1);
});

test("a Ramadan evening is booked for its start time and the event length", async () => {
  const fake = fakeToa();
  const r = await syncBookings(fake, { fridays: [], gatherings: [day({ place: "Lounge Dorm 1" })] });
  assert.equal(r.created, 1);
  const b = fake.bookings.room_B[0];
  assert.equal(b.externalId, "naist-ramadan-2027-02-08");
  assert.equal(b.start, Date.UTC(2027, 1, 8, 10, 30));
  assert.equal(b.end - b.start, 90 * 60000);
});

test("moving a Friday to another place moves its booking; deleting the day removes it", async () => {
  const fake = fakeToa();
  await syncBookings(fake);
  const moved = await syncBookings(fake, { fridays: [friday({ venue: "Lounge Dorm 1" })] });
  assert.equal(moved.created, 1);
  assert.equal(moved.removed, 1);
  assert.equal(fake.bookings.room_A.length, 0);
  assert.equal(fake.bookings.room_B.length, 1);
  const gone = await syncBookings(fake, { fridays: [] });
  assert.equal(gone.removed, 1);
  assert.equal(fake.bookings.room_B.length, 0);
});

test("a changed time updates the same booking", async () => {
  const fake = fakeToa();
  await syncBookings(fake, { fridays: [], gatherings: [day()] });
  const r = await syncBookings(fake, { fridays: [], gatherings: [day({ start_time: "20:00" })] });
  assert.equal(r.updated, 1);
  assert.equal(fake.bookings.room_A.length, 1);
  assert.equal(fake.bookings.room_A[0].start, Date.UTC(2027, 1, 8, 11, 0));
});

test("a hand-made booking is kept unless replacing was asked for, and only when it overlaps", async () => {
  const fake = fakeToa();
  const handMade = { id: "-hand", start: Date.UTC(2027, 1, 12, 3, 0), end: Date.UTC(2027, 1, 12, 4, 30), note: "x", repeat: "once", externalId: "" };
  const elsewhere = { id: "-other", start: Date.UTC(2027, 1, 15, 3, 0), end: Date.UTC(2027, 1, 15, 4, 30), note: "y", repeat: "once", externalId: "" };
  const weekly = { id: "-weekly", start: Date.UTC(2027, 1, 12, 3, 0), end: Date.UTC(2027, 1, 12, 4, 0), note: "z", repeat: "weekly", externalId: "" };
  fake.bookings.room_A = [handMade, elsewhere, weekly];
  const kept = await syncBookings(fake);
  assert.equal(kept.left, 2, "the overlapping one-off and weekly are reported, not touched");
  assert.equal(fake.bookings.room_A.length, 4);
  const replaced = await syncBookings(fake, { replaceOthers: true });
  assert.equal(replaced.replaced, 1);
  assert.deepEqual(fake.bookings.room_A.map((x) => x.id).filter((i) => !i.startsWith("-B")), ["-other", "-weekly"]);
});

test("a room that is open all the time needs no bookings", async () => {
  const fake = fakeToa({ availability: { room_A: "always", room_B: "booked" } });
  const r = await syncBookings(fake, { adminRooms: [{ id: "room_A", availability: "always" }, { id: "room_B", availability: "booked" }] });
  assert.equal(r.alwaysOpen, 1);
  assert.equal(r.created, 0);
  assert.ok(!fake.calls.some((c) => c.path.includes("room_A")));
});

test("bookings: a dry run writes nothing, and past or unlinked days are ignored", async () => {
  const fake = fakeToa();
  const r = await syncBookings(fake, { dryRun: true });
  assert.equal(r.created, 1);
  assert.equal(fake.calls.filter((c) => c.method !== "GET").length, 0);
  const none = desiredBookingsByRoom({ fridays: [friday({ date: "2027-01-08" }), friday({ venue: "Elsewhere" })], gatherings: [], places, settings, today: "2027-02-01", nowMs: NOW });
  assert.equal([...none.values()].reduce((n, m) => n + m.size, 0), 0);
  assert.equal(planBookings({ wanted: new Map(), bookings: [], nowMs: NOW }).same, 0);
});
