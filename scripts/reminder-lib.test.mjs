import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRAYER_TIME,
  todayInTokyo,
  minutesInTokyo,
  tooLateToSend,
  addDays,
  daysUntil,
  formatDateLong,
  formatDateShort,
  reminderKindFor,
  sentKey,
  dueReminders,
  dueAdminTodos,
  adminChecklist,
  buildEmail,
  buildLineText,
  buildAdminEmail,
  buildAdminChatText,
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

// The one place the prayer time lives is public/reminder-message.js; the
// announcement, the emails and the Copy / WhatsApp texts all read it from there.
test("the prayer time is 12.35 pm", () => {
  assert.equal(PRAYER_TIME, "12.35 pm (start)");
});

test("minutesInTokyo is minutes since midnight in Japan", () => {
  assert.equal(minutesInTokyo(new Date("2026-10-09T00:00:00Z")), 9 * 60); // the 09:00 JST cron
  assert.equal(minutesInTokyo(new Date("2026-10-09T05:46:00Z")), 14 * 60 + 46); // the run that came 5h46m late
  assert.equal(minutesInTokyo(new Date("2026-10-08T15:00:00Z")), 0);
});

test("a same-day reminder is dropped from 11:00 JST on; other days are never dropped", () => {
  assert.equal(tooLateToSend(0, 10 * 60 + 59), false);
  assert.equal(tooLateToSend(0, 11 * 60), true);
  assert.equal(tooLateToSend(0, 14 * 60 + 46), true);
  assert.equal(tooLateToSend(1, 23 * 60), false);
  assert.equal(tooLateToSend(7, 23 * 60), false);
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
  assert.ok(text.includes(PRAYER_TIME));
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
  assert.ok(text.includes(PRAYER_TIME));
  assert.ok(text.length < 600);
  assert.ok(!text.includes("unsubscribe")); // LINE users stop by blocking the bot
});

// ---- the wording shared with the web page (public/reminder-message.js) ----
import { createRequire } from "node:module";
const shared = createRequire(import.meta.url)("../public/reminder-message.js");

test("the page's copy/WhatsApp text is exactly the automatic chat text", () => {
  const args = { friday: friday(), person: person(), roles: ["Primary khatib"], days: 3 };
  assert.equal(shared.chatText(args), buildLineText(args));
  assert.match(shared.chatText(args), /in 3 days/);
});

test("whatsappLink builds a wa.me link with the whole message encoded", () => {
  const text = "Line 1\nSalam & \"quotes\" 🕌";
  const link = shared.whatsappLink("+81 90-1234-5678", text);
  assert.ok(link.startsWith("https://wa.me/819012345678?text="));
  assert.equal(decodeURIComponent(link.split("?text=")[1]), text);
  assert.ok(!link.includes("\n") && !link.includes(" "));
});

test("whatsappLink refuses numbers that cannot be international", () => {
  for (const bad of [null, undefined, "", "123", "abc", "1".repeat(16)]) {
    assert.equal(shared.whatsappLink(bad, "hi"), null);
  }
});

test("each role has the wording the automatic reminders use", () => {
  assert.deepEqual(shared.ROLE_SLOTS.map((s) => s.label), ["Primary khatib", "Secondary khatib (standby)", "Imam"]);
});

// ---------- admin to-do ----------

const admin = (over = {}) =>
  person({ id: 9, name: "Admin Aisha", status: "active", is_admin: 1, email: "aisha@example.com", reminder_token: "a".repeat(32), ...over });
const todos = (over = {}) =>
  dueAdminTodos({ today: "2026-10-15", fridays: [friday()], people: [admin(), person()], sentKeys: new Set(), ...over });

test("admin: the day before, the to-do lists who to message by hand and the group announcement", () => {
  // Zed (id 2) has no email/LINE so he is not in `people`; the imam slot is empty.
  const f = friday({ primary_khatib_id: 2, primary_name: "Zed" });
  const [item] = todos({ fridays: [f] });
  assert.equal(item.type, "admin");
  assert.equal(item.kind, "admin-1d");
  assert.equal(item.channel, "email");
  assert.deepEqual(item.checklist.byHand, [{ name: "Zed", roles: ["Primary khatib"] }]);
  assert.deepEqual(item.checklist.open, ["Imam"]);
  const text = buildAdminChatText(item);
  assert.match(text, /Friday, 16 October 2026 \(tomorrow\)/);
  assert.match(text, /1\. Send the reminder by hand \(WhatsApp \/ Facebook\) to:\n {3}• Zed \(Primary khatib\)/);
  assert.match(text, /2\. Post the announcement in the WhatsApp group and the Facebook group\./);
  assert.match(text, /Not assigned yet: Imam/);
  assert.ok(text.length < 1000);
  assert.ok(!/undefined|null/.test(text));
});

test("admin: people reached by email or LINE are not on the by-hand list", () => {
  const [item] = todos(); // Ahmad (id 1) has an email
  assert.deepEqual(item.checklist.byHand, []);
  assert.match(buildAdminChatText(item), /Nobody needs a reminder by hand/);
});

test("admin: someone with their reminders switched off is on the by-hand list", () => {
  const [item] = todos({ people: [admin(), person({ reminders: 0 })] });
  assert.deepEqual(item.checklist.byHand, [{ name: "Ahmad", roles: ["Primary khatib"] }]);
});

test("admin: a guest typed in as free text is on the by-hand list, grouped by name", () => {
  const f = friday({ primary_khatib_id: null, primary_name: "Guest Speaker", imam_id: null, imam_name: "Guest Speaker" });
  const checklist = adminChecklist(f, new Map());
  assert.deepEqual(checklist.byHand, [{ name: "Guest Speaker", roles: ["Primary khatib", "Imam"] }]);
  assert.deepEqual(checklist.open, []);
});

test("admin: an empty secondary slot is not flagged, an empty primary or imam is", () => {
  const checklist = adminChecklist(friday({ primary_khatib_id: null, primary_name: null }), new Map());
  assert.deepEqual(checklist.open, ["Primary khatib", "Imam"]);
});

test("admin: a week ahead it stays quiet unless there is something to do", () => {
  const full = friday({ imam_id: 3, imam_name: "Chris" });
  const reached = [admin(), person(), person({ id: 3, name: "Chris", email: "c@example.com" })];
  assert.equal(todos({ today: "2026-10-09", fridays: [full], people: reached }).length, 0);

  const [item] = todos({ today: "2026-10-09" }); // imam still open
  assert.equal(item.kind, "admin-7d");
  const text = buildAdminChatText(item);
  assert.match(text, /Not assigned yet: Imam/);
  assert.ok(!/Post the announcement/.test(text), "the announcement is for the day before");
});

test("admin: the day before always goes out, even if nothing is by hand and nothing is open", () => {
  const full = friday({ imam_id: 3, imam_name: "Chris" });
  const reached = [admin(), person(), person({ id: 3, name: "Chris", email: "c@example.com" })];
  const due = todos({ fridays: [full], people: reached });
  assert.equal(due.length, 1);
  assert.match(buildAdminChatText(due[0]), /Post the announcement/);
});

test("admin: only active admins with reminders on and somewhere to send get a to-do", () => {
  assert.equal(todos({ people: [admin({ is_admin: 0 }), person()] }).length, 0);
  assert.equal(todos({ people: [admin({ status: "inactive" }), person()] }).length, 0);
  assert.equal(todos({ people: [admin({ reminders: 0 }), person()] }).length, 0);
  // email and LINE are separate deliveries
  const both = todos({ people: [admin({ line_user_id: "U" + "a".repeat(32) }), person()] });
  assert.deepEqual(both.map((d) => d.channel).sort(), ["email", "line"]);
});

test("admin: a to-do already sent is not sent again, and does not block the khatib's own reminder", () => {
  const sent = new Set([sentKey(10, 9, "admin-1d", "email")]);
  assert.equal(todos({ sentKeys: sent }).length, 0);
  const own = dueReminders({ today: "2026-10-15", fridays: [friday()], people: [admin({ id: 1 })], sentKeys: new Set([sentKey(10, 1, "admin-1d", "email")]) });
  assert.equal(own.length, 1, "the admin-1d log entry must not hide the 1d reminder");
  assert.equal(own[0].kind, "1d");
});

test("admin: the same person as admin and as khatib gets both messages", () => {
  const me = admin({ id: 1, name: "Ahmad" });
  const reminders = dueReminders({ today: "2026-10-15", fridays: [friday()], people: [me], sentKeys: new Set() });
  const adminTodos = dueAdminTodos({ today: "2026-10-15", fridays: [friday()], people: [me], sentKeys: new Set() });
  assert.equal(reminders.length, 1);
  assert.equal(adminTodos.length, 1);
  assert.notEqual(reminders[0].key, adminTodos[0].key);
});

test("admin email: subject, steps, unsubscribe link", () => {
  const [item] = todos({ fridays: [friday({ primary_khatib_id: 2, primary_name: "Zed" })] });
  const { subject, text, unsubscribeUrl } = buildAdminEmail({ ...item, siteUrl: "https://example.pages.dev" });
  assert.equal(subject, "Jumat admin to-do: 16 October 2026");
  assert.match(text, /Assalamu'alaikum Admin Aisha,/);
  assert.match(text, /• Zed \(Primary khatib\)/);
  assert.match(text, /Not assigned yet: Imam/);
  assert.equal(unsubscribeUrl, `https://example.pages.dev/api/reminders/unsubscribe?t=${"a".repeat(32)}`);
  assert.ok(text.includes(unsubscribeUrl));
  assert.ok(!/undefined|null/.test(text));
});

// ---------- Google Calendar ----------

const gcal = (link) => {
  const url = new URL(link);
  return { origin: url.origin + url.pathname, p: Object.fromEntries(url.searchParams) };
};

test("calendar link: a Google 'new event' link with the prayer time in UTC (12.35 JST = 03:35Z)", () => {
  const { origin, p } = gcal(shared.calendarLink({ friday: friday(), roles: ["Primary khatib"] }));
  assert.equal(origin, "https://calendar.google.com/calendar/render");
  assert.equal(p.action, "TEMPLATE");
  assert.equal(p.text, "Jumat prayer: Primary khatib");
  assert.equal(p.dates, "20261016T033500Z/20261016T042000Z"); // 45 minutes
  assert.equal(p.location, "Assembly Room - SENTAN");
  assert.match(p.details, /Your role: Primary khatib\./);
  assert.match(p.details, /tell the coordinator/);
});

test("calendar link: starts at the same time the messages announce", () => {
  assert.equal(PRAYER_TIME, "12.35 pm (start)");
  assert.ok(gcal(shared.calendarLink({ friday: friday(), roles: [] })).p.dates.startsWith("20261016T0335"));
});

test("calendar link: a Friday near New Year rolls the date correctly", () => {
  // 00:30 JST on 1 Jan would be 15:30Z the day before; the prayer is at noon so
  // this only checks plain date arithmetic across a year boundary.
  const { p } = gcal(shared.calendarLink({ friday: friday({ date: "2027-01-01" }), roles: ["Imam"] }));
  assert.equal(p.dates, "20270101T033500Z/20270101T042000Z");
});

test("calendar link: no role => generic title; no venue => no location; standby is explained", () => {
  const generic = gcal(shared.calendarLink({ friday: friday({ venue: null }), roles: [] }));
  assert.equal(generic.p.text, "Jumat prayer");
  assert.ok(!("location" in generic.p));
  assert.ok(!/Your role/.test(generic.p.details));
  const standby = gcal(shared.calendarLink({ friday: friday(), roles: ["Secondary khatib (standby)"] }));
  assert.match(standby.p.details, /on standby/);
});

test("calendar link: two roles in one title", () => {
  const { p } = gcal(shared.calendarLink({ friday: friday(), roles: ["Primary khatib", "Imam"] }));
  assert.equal(p.text, "Jumat prayer: Primary khatib + Imam");
});

test("role codes round-trip, unknown letters are ignored", () => {
  assert.deepEqual(shared.rolesFromCodes("pi"), ["Primary khatib", "Imam"]);
  assert.deepEqual(shared.rolesFromCodes("S"), ["Secondary khatib (standby)"]);
  assert.deepEqual(shared.rolesFromCodes("xyz"), []);
  assert.deepEqual(shared.rolesFromCodes(null), []);
  const link = shared.calendarShortLink({ siteUrl: "https://x.test", friday: friday(), roles: ["Imam", "Primary khatib"] });
  assert.equal(link, "https://x.test/api/calendar/add?friday=10&roles=pi");
});

test("chat text carries a short calendar link only when it has a site and a saved Friday", () => {
  const args = { friday: friday(), person: person(), roles: ["Primary khatib"], days: 3 };
  const withLink = shared.chatText({ ...args, siteUrl: "https://x.test" });
  assert.match(withLink, /📆 Add to Google Calendar: https:\/\/x\.test\/api\/calendar\/add\?friday=10&roles=p\n/);
  assert.ok(withLink.length < 600, "still short enough for a chat message");
  assert.ok(!shared.chatText(args).includes("Google Calendar"));
  assert.ok(!shared.chatText({ ...args, friday: friday({ id: undefined }), siteUrl: "https://x.test" }).includes("Google Calendar"));
});

test("the page's text and the LINE text stay identical with the calendar link", () => {
  const args = { friday: friday(), person: person(), roles: ["Primary khatib", "Imam"], days: 7, siteUrl: "https://x.test" };
  assert.equal(shared.chatText(args), buildLineText(args));
});

test("reminder email links to the calendar", () => {
  const { text } = buildEmail({ friday: friday(), person: person(), roles: ["Imam"], days: 1, siteUrl: "https://x.test" });
  assert.match(text, /Add it to your Google Calendar: https:\/\/x\.test\/api\/calendar\/add\?friday=10&roles=i\n/);
  assert.ok(!/undefined|null/.test(text));
});
