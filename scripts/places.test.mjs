// Places: what the admin types is cleaned and checked, and the announcement and
// calendar text use the place's details and map link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlace, shapePlace, placeLookup } from "../functions/api/_places.mjs";
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
  assert.deepEqual(shapePlace({ id: 1, name: "R", details: null, maps_url: null, kultum_usual: 1, sort_order: 2 }), { id: 1, name: "R", details: "", maps_url: "", kultum_usual: true, sort_order: 2 });
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
