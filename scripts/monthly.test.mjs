// The first-of-the-month schedule message, and moving people whose leaving date has passed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueMonthlyReminders,
  buildMonthEmail,
  buildMonthLineText,
  leaversDue,
  monthLogId,
  monthNameOf,
  sentKey,
} from "./reminder-lib.mjs";

const people = [
  { id: 1, name: "Ali", status: "active", is_admin: 0, email: "ali@x.org", reminders: 1, line_user_id: "U1", reminder_token: "t1" },
  { id: 2, name: "Budi", status: "active", is_admin: 0, email: "budi@x.org", reminders: 1, line_user_id: null, reminder_token: "t2" },
  { id: 3, name: "Cara", status: "active", is_admin: 1, email: "cara@x.org", reminders: 1, line_user_id: null, reminder_token: "t3" },
  { id: 4, name: "Dan", status: "active", is_admin: 0, email: "dan@x.org", reminders: 1, line_user_id: null, reminder_token: "t4" }, // not scheduled
  { id: 5, name: "Eli", status: "inactive", is_admin: 0, email: "eli@x.org", reminders: 1, line_user_id: null, reminder_token: "t5" }, // left
  { id: 6, name: "Fay", status: "active", is_admin: 0, email: "fay@x.org", reminders: 0, line_user_id: null, reminder_token: "t6" }, // reminders off
];
const fridays = [
  { id: 10, date: "2026-11-06", venue: "Sentan", primary_khatib_id: 1, secondary_khatib_id: 4, imam_id: 2, primary_name: "Ali", secondary_name: "Dan", imam_name: "Budi" },
  { id: 11, date: "2026-11-13", venue: "", primary_khatib_id: 5, secondary_khatib_id: null, imam_id: 6, primary_name: "Eli", secondary_name: null, imam_name: "Fay" },
  { id: 12, date: "2026-11-20", venue: "Sentan", primary_khatib_id: null, secondary_khatib_id: null, imam_id: 2, primary_name: null, secondary_name: null, imam_name: "Budi" },
];
const gatherings = [{ date: "2026-11-21", place: "Lounge 1", start_time: "19:30", kultum: 1, speaker: "Ali" }];

test("the month schedule goes out on the 1st only, to the admins and everyone scheduled", () => {
  assert.deepEqual(dueMonthlyReminders({ today: "2026-11-02", fridays, people, sentKeys: new Set() }), []);
  const due = dueMonthlyReminders({ today: "2026-11-01", fridays, gatherings, people, sentKeys: new Set() });
  const who = due.map((d) => `${d.person.name}:${d.channel}`).sort();
  // Ali (email + LINE) and Budi are scheduled, Cara is admin; Dan is standby only, Eli left, Fay has reminders off.
  assert.deepEqual(who, ["Ali:email", "Ali:line", "Budi:email", "Cara:email"]);
  assert.ok(due.every((d) => d.type === "month" && d.kind === "month" && d.logId === monthLogId("2026-11-01")));
});

test("the month schedule is never sent twice", () => {
  const sent = new Set([sentKey(monthLogId("2026-11-01"), 1, "month", "email"), sentKey(monthLogId("2026-11-01"), 1, "month", "line")]);
  const due = dueMonthlyReminders({ today: "2026-11-01", fridays, people, sentKeys: sent });
  assert.deepEqual(due.map((d) => d.person.name).sort(), ["Budi", "Cara"]);
  assert.notEqual(monthLogId("2026-11-01"), monthLogId("2026-12-01"));
});

test("nothing to send when the month has no schedule", () => {
  assert.deepEqual(dueMonthlyReminders({ today: "2026-11-01", fridays: [], gatherings: [], people, sentKeys: new Set() }), []);
});

test("the message lists every Friday, your own days, and the open slots for an admin", () => {
  const due = dueMonthlyReminders({ today: "2026-11-01", fridays, gatherings, people, sentKeys: new Set() });
  const ali = due.find((d) => d.person.name === "Ali" && d.channel === "email");
  const mail = buildMonthEmail({ ...ali, siteUrl: "https://s.test" });
  assert.equal(mail.subject, "Jumat schedule for November 2026");
  assert.match(mail.text, /6 November 2026: khatib Ali · imam Budi · Sentan/);
  assert.match(mail.text, /13 November 2026: khatib Eli · imam Fay · place to be announced/);
  assert.match(mail.text, /20 November 2026: khatib \(open\)/);
  assert.match(mail.text, /Ramadan evenings/);
  assert.match(mail.text, /You are scheduled on:\n {2}6 November 2026 \(Primary khatib\)/);
  assert.doesNotMatch(mail.text, /Admin: still open/);
  assert.match(mail.text, /unsubscribe\?t=t1/);
  const cara = buildMonthLineText({ ...due.find((d) => d.person.name === "Cara"), siteUrl: "https://s.test" });
  assert.match(cara, /Admin: still open \(khatib or imam\): 20 November 2026/);
  assert.doesNotMatch(cara, /You are scheduled on/);
});

test("month names", () => {
  assert.equal(monthNameOf("2027-01-01"), "January 2027");
});

test("a person is moved to left once the leaving date has passed, not on the day itself", () => {
  const rows = [
    { id: 1, status: "active", leaving_on: "2026-03-31" },
    { id: 2, status: "active", leaving_on: "2026-04-01" },
    { id: 3, status: "active", leaving_on: "2026-04-02" },
    { id: 4, status: "active", leaving_on: null },
    { id: 5, status: "inactive", leaving_on: "2026-01-01" },
  ];
  assert.deepEqual(leaversDue(rows, "2026-04-01").map((p) => p.id), [1]);
  assert.deepEqual(leaversDue(rows, "2026-04-02").map((p) => p.id), [1, 2]);
});
