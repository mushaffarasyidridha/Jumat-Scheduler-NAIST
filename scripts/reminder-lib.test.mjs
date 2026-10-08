import { test } from "node:test";
import assert from "node:assert/strict";
import {
  todayInTokyo,
  addDays,
  daysUntil,
  formatDateLong,
  formatDateShort,
  reminderKindFor,
  sentKey,
  dueReminders,
  buildEmail,
  buildLineText,
} from "./reminder-lib.mjs";

const person = (over = {}) => ({
  id: 1, name: "Ahmad", email: "a@example.com", reminders: 1, line_user_id: null, reminder_token: "t".repeat(32), ...over,
});
const friday = (over = {}) => ({
  id: 10, date: "2026-10-16", venue: "Assembly Room - SENTAN",
  primary_khatib_id: 1, secondary_khatib_id: null, imam_id: null,
  primary_name: "Ahmad", secondary_name: null, imam_name: null, ...over,
});
const run = (over = {}) =>
  dueReminders({ today: "2026-10-09", fridays: [friday()], people: [person()], sentKeys: new Set(), ...over });

test("todayInTokyo rolls over at 15:00 UTC, not midnight UTC", () => {
  assert.equal(todayInTokyo(new Date("2026-10-08T14:59:00Z")), "2026-10-08");
  assert.equal(todayInTokyo(new Date("2026-10-08T15:00:00Z")), "2026-10-09");
  assert.equal(todayInTokyo(new Date("2026-10-09T00:00:00Z")), "2026-10-09"); // the 09:00 JST cron
});

test("date helpers", () => {
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(daysUntil("2026-10-09", "2026-10-16"), 7);
  assert.equal(daysUntil("2026-10-16", "2026-10-16"), 0);
  assert.equal(daysUntil("2026-10-17", "2026-10-16"), -1);
});

test("dates are formatted the same way whatever the locale", () => {
  assert.equal(formatDateShort("2026-10-16"), "16 October 2026");
  assert.equal(formatDateShort("2027-01-01"), "1 January 2027");
  assert.equal(formatDateLong("2026-10-16"), "Friday, 16 October 2026");
});

test("reminder kind boundaries", () => {
  const kinds = [-1, 0, 1, 2, 7, 8].map(reminderKindFor);
  assert.deepEqual(kinds, [null, "1d", "1d", "7d", "7d", null]);
});

test("a Friday 7 days out gets the week-ahead reminder", () => {
  const due = run();
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "7d");
  assert.equal(due[0].channel, "email");
  assert.deepEqual(due[0].roles, ["Primary khatib"]);
});

test("the day before only the last reminder is due, never both", () => {
  const due = run({ today: "2026-10-15" });
  assert.deepEqual(due.map((d) => d.kind), ["1d"]);
});

test("a reminder already sent is not sent again, but the other kind still is", () => {
  const sent = new Set([sentKey(10, 1, "7d", "email")]);
  assert.equal(run({ sentKeys: sent }).length, 0);
  assert.equal(run({ sentKeys: sent, today: "2026-10-15" }).length, 1);
});

test("Fridays too far away, or already past, are ignored", () => {
  assert.equal(run({ today: "2026-10-08" }).length, 0); // 8 days out
  assert.equal(run({ today: "2026-10-17" }).length, 0); // yesterday
});

test("reminders switched off, or no channel, means nothing is due", () => {
  assert.equal(run({ people: [person({ reminders: 0 })] }).length, 0);
  assert.equal(run({ people: [person({ email: null })] }).length, 0);
  assert.equal(run({ people: [] }).length, 0);
});

test("email and LINE are separate reminders, each tracked on its own", () => {
  const people = [person({ line_user_id: "U" + "a".repeat(32) })];
  const due = run({ people });
  assert.deepEqual(due.map((d) => d.channel).sort(), ["email", "line"]);
  const sent = new Set([sentKey(10, 1, "7d", "email")]);
  assert.deepEqual(run({ people, sentKeys: sent }).map((d) => d.channel), ["line"]);
});

test("someone who is both khatib and imam gets one message listing both roles", () => {
  const due = run({ fridays: [friday({ imam_id: 1 })] });
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].roles, ["Primary khatib", "Imam"]);
});

test("each assigned person is reminded; open slots and guests without a roster id are skipped", () => {
  const people = [person({ id: 1, name: "Ahmad" }), person({ id: 2, name: "Bilal", email: "b@example.com" })];
  const due = run({
    people,
    fridays: [friday({ secondary_khatib_id: 2, imam_id: null, imam_name: "Guest Imam" })],
  });
  assert.deepEqual(due.map((d) => d.person.name), ["Ahmad", "Bilal"]);
  assert.deepEqual(due[1].roles, ["Secondary khatib (standby)"]);
});

test("nearest Friday comes first", () => {
  const due = run({
    today: "2026-10-09",
    fridays: [friday({ id: 11, date: "2026-10-16" }), friday({ id: 12, date: "2026-10-10" })],
  });
  assert.deepEqual(due.map((d) => d.friday.id), [12, 11]);
});

test("email text carries the date, time, venue, role, line-up and unsubscribe link", () => {
  const { subject, text, unsubscribeUrl } = buildEmail({
    friday: friday({ secondary_khatib_id: 2, secondary_name: "Bilal", imam_id: 3, imam_name: "Chris" }),
    person: person(),
    roles: ["Primary khatib"],
    days: 7,
    siteUrl: "https://example.pages.dev",
  });
  assert.equal(subject, "Jumat reminder: Primary khatib on 16 October 2026");
  assert.match(text, /Assalamu'alaikum Ahmad,/);
  assert.match(text, /Friday, 16 October 2026 \(in 7 days\)/);
  assert.match(text, /12\.40 pm \(start\)/);
  assert.match(text, /Assembly Room - SENTAN/);
  assert.match(text, /Khatib: Ahmad \/ Bilal \(Secondary\)/);
  assert.match(text, /Imam: Chris/);
  assert.equal(unsubscribeUrl, `https://example.pages.dev/api/reminders/unsubscribe?t=${"t".repeat(32)}`);
  assert.ok(text.includes(unsubscribeUrl));
  assert.ok(!/undefined|null/.test(text));
});

test("secondary khatib is told they are standby", () => {
  const { text } = buildEmail({
    friday: friday(), person: person(), roles: ["Secondary khatib (standby)"], days: 1, siteUrl: "https://x.test",
  });
  assert.match(text, /on standby/);
  assert.match(text, /tomorrow/);
});

test("a missing venue never prints 'null' or 'undefined'", () => {
  for (const venue of [null, undefined, "", "   "]) {
    const email = buildEmail({ friday: friday({ venue }), person: person(), roles: ["Imam"], days: 0, siteUrl: "https://x.test" });
    const line = buildLineText({ friday: friday({ venue }), person: person(), roles: ["Imam"], days: 0 });
    assert.match(email.text, /Place: to be announced/);
    assert.match(line, /to be announced/);
    assert.match(line, /today/);
  }
});

test("LINE text is short and has the essentials", () => {
  const text = buildLineText({ friday: friday(), person: person(), roles: ["Primary khatib", "Imam"], days: 7 });
  assert.match(text, /Primary khatib \+ Imam/);
  assert.match(text, /Friday, 16 October 2026/);
  assert.match(text, /12\.40 pm/);
  assert.ok(text.length < 600);
  assert.ok(!text.includes("unsubscribe")); // LINE users stop by blocking the bot
});
