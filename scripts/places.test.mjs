// Places: what the admin types is cleaned and checked, and the announcement and
// calendar text use the place's details and map link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlace, shapePlace, placeLookup, planPlacesFromRooms } from "../functions/api/_places.mjs";
import { eventDescription, buildEvent } from "../functions/api/_ics.mjs";
import announcement from "../public/announcement.js";

test("place: a name is needed, spaces are tidied, long text is cut", () => {
  assert.ok(parsePlace({ name: "A" }, { requireName: true }).error);
  assert.ok(parsePlace(null, { requireName: true }).error);
  const p = parsePlace({ name: "  Lounge   Dorm 1 ", details: " 1st floor ", maps_url: "", kultum_usual: true }, { requireName: true });
  assert.equal(p.name, "Lounge Dorm 1");
  assert.equal(p.details, "1st floor");
  assert.equal(p.maps_url, null, "an empty link is no link");
  assert.equal(p.kultum_usual, 1);
  assert.equal(parsePlace({ name: "x".repeat(200) }, { requireName: true }).name.length, 60);
  assert.equal(parsePlace({ name: "Room", details: "d".repeat(900) }, { requireName: true }).details.length, 300);
});

test("place: only https map links are accepted", () => {
  for (const bad of ["javascript:alert(1)", "http://maps.example.org", "maps.google.com/x", "https://x y"]) {
    assert.ok(parsePlace({ name: "Room", maps_url: bad }, { requireName: true }).error, bad);
  }
  assert.equal(parsePlace({ name: "Room", maps_url: "https://maps.app.goo.gl/abc" }, { requireName: true }).maps_url, "https://maps.app.goo.gl/abc");
});

test("place: a patch only changes the fields it carries", () => {
  const p = parsePlace({ details: "new" }, { requireName: false });
  assert.deepEqual(Object.keys(p.given), ["details"]);
  assert.equal(parsePlace({ name: "" }, { requireName: false }).error !== undefined, true, "a present but empty name is refused");
  assert.deepEqual(shapePlace({ id: 1, name: "R", details: null, maps_url: null, kultum_usual: 1, sort_order: 2 }), { id: 1, name: "R", details: "", maps_url: "", kultum_usual: true, toa_room_id: "", sort_order: 2 });
});

test("place lookup ignores case and spaces", () => {
  const find = placeLookup([{ name: "Lounge Dorm 1" }]);
  assert.equal(find("  lounge dorm 1 ").name, "Lounge Dorm 1");
  assert.equal(find("Nowhere"), null);
  assert.equal(find(null), null);
});

const friday = { id: 10, date: "2026-10-16", venue: "Lounge Dorm 1", info: null, primary_name: "Ahmad", secondary_name: null, imam_name: "Chris" };
const hadith = announcement.hadithForDate("2026-10-16");

test("announcement: the place's map link and details are used; unknown venues get no invented link", () => {
  const places = [{ name: "Lounge Dorm 1", details: "1st floor, next to the mailboxes", maps_url: "https://maps.app.goo.gl/lounge" }];
  const text = announcement.buildAnnouncementText(friday, hadith, places);
  assert.match(text, /at Lounge Dorm 1 \(https:\/\/maps\.app\.goo\.gl\/lounge\)\./);
  assert.match(text, /\nPlace: 1st floor, next to the mailboxes\n/);
  const none = announcement.buildAnnouncementText(friday, hadith, []);
  assert.match(none, /at Lounge Dorm 1\./);
  assert.ok(!none.includes("Place:") && !none.includes("maps.app"));
});

test("announcement: without places the Sentan link still works; a place with no link means no link", () => {
  const sentan = { ...friday, venue: "Assembly Room - SENTAN" };
  assert.match(announcement.buildAnnouncementText(sentan, hadith), /\(https:\/\/maps\.app\.goo\.gl\/Dd44PcXYVqFm7KDA6\)/);
  const noLink = announcement.buildAnnouncementText(sentan, hadith, [{ name: "Assembly Room - SENTAN", details: "", maps_url: "" }]);
  assert.ok(!noLink.includes("maps.app"), "the admin removed the link: none is shown");
});

test("calendar event text carries the place details too", () => {
  const places = [{ name: "Lounge Dorm 1", details: "1st floor", maps_url: "https://maps.app.goo.gl/lounge" }];
  assert.match(eventDescription(friday, "https://x.test", places), /Place: 1st floor/);
  const lines = buildEvent({ ...friday, updated_at: "2026-10-09 06:00:00" }, { siteUrl: "https://x.test", nowMs: 0, places }).join("\n").replace(/\r?\n /g, "");
  assert.match(lines, /maps\.app\.goo\.gl\/lounge/);
});

test("a place linked to a TOA room puts the TOA app link in the announcements", async () => {
  const { default: announcement } = await import("../public/announcement.js");
  const places = [{ name: "Dorm 7", details: "", maps_url: "", toa_room_id: "room_111" }, { name: "Plain Hall", details: "", maps_url: "", toa_room_id: "" }];
  const friday = { date: "2027-02-12", venue: "Dorm 7", imam_name: "Ali" };
  const text = announcement.buildAnnouncementText(friday, announcement.hadithForDate(friday.date), places);
  assert.ok(text.includes("Live and queue in the TOA app: https://toa-rooms.pages.dev/app/#/room/room_111"));
  assert.ok(!announcement.buildAnnouncementText({ ...friday, venue: "Plain Hall" }, announcement.hadithForDate(friday.date), places).includes("TOA app"));
  const day = announcement.buildGatheringText({ date: "2027-02-08", place: "Dorm 7", start_time: "19:30", kultum: 0 }, { places });
  assert.ok(day.includes("https://toa-rooms.pages.dev/app/#/room/room_111"));
  assert.ok(!announcement.buildGatheringText({ date: "2027-02-08", place: "Plain Hall", start_time: "19:30" }, { places }).includes("TOA"));
});

test("places from TOA rooms: ticked rooms become places, clashes are skipped with a reason", () => {
  const rooms = [
    { id: "room_1", name: "Dorm 1 Lounge" },
    { id: "room_2", name: "Sentan Seminar Room" },
    { id: "room_3", name: "Musholla BS" },
    { id: "room_4", name: "assembly room - sentan" },
  ];
  const places = [
    { name: "Assembly Room - SENTAN", toa_room_id: null },
    { name: "Musholla BS", toa_room_id: "room_3" },
  ];
  const plan = planPlacesFromRooms({ rooms, places, ids: ["room_1", "room_2", "room_3", "room_4", "room_9", "room_1"] });
  assert.deepEqual(plan.create.map((r) => r.name), ["Dorm 1 Lounge", "Sentan Seminar Room"]);
  const why = Object.fromEntries(plan.skipped.map((s) => [s.id, s.why]));
  assert.match(why.room_3, /already a place/);
  assert.match(why.room_4, /name exists/);
  assert.match(why.room_9, /not in the TOA room list/);
  assert.equal(plan.create.length + plan.skipped.length, 5, "a repeated id counts once");
});

test("places from TOA rooms: the 30-place limit is kept and two rooms with one name make one place", () => {
  const rooms = [
    { id: "a", name: "Lounge" },
    { id: "b", name: "LOUNGE" },
    { id: "c", name: "Other" },
  ];
  const places = Array.from({ length: 28 }, (_, i) => ({ name: `P${i}`, toa_room_id: null }));
  const plan = planPlacesFromRooms({ rooms, places, ids: ["a", "b", "c"] });
  assert.deepEqual(plan.create.map((r) => r.id), ["a", "c"]);
  assert.match(plan.skipped.find((s) => s.id === "b").why, /name exists/);
  const full = planPlacesFromRooms({ rooms, places: Array.from({ length: 30 }, (_, i) => ({ name: `P${i}` })), ids: ["a"] });
  assert.match(full.skipped[0].why, /limit/);
});
