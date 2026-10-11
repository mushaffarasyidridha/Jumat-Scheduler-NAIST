// Ramadan: checking what the admin enters, and making the days from the weekly pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDate, isTime, weekdayOf, addDays, datesInRange, parseReminderDays, parseRamadan, gatheringsToCreate, parseGathering, shapeGathering, MAX_DAYS } from "../functions/api/_ramadan.mjs";

test("dates and times are checked strictly", () => {
  assert.ok(isDate("2027-02-08") && !isDate("2027-02-30") && !isDate("27-2-8") && !isDate(20270208) && !isDate(null));
  assert.ok(isTime("19:30") && isTime("00:00") && isTime("23:59") && !isTime("24:00") && !isTime("7:30") && !isTime("19:60") && !isTime(1930));
  assert.equal(weekdayOf("2027-02-08"), 1, "8 Feb 2027 is a Monday");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.deepEqual(datesInRange("2027-02-08", "2027-02-10"), ["2027-02-08", "2027-02-09", "2027-02-10"]);
  assert.equal(datesInRange("2027-02-08", "2027-02-08").length, 1);
});

test("reminder days: numbers 0 to 7, once each, nearest last", () => {
  assert.deepEqual(parseReminderDays("3,2,1,0"), [3, 2, 1, 0]);
  assert.deepEqual(parseReminderDays([1, "3", 3, 9, -1, "x", 0]), [3, 1, 0]);
  assert.deepEqual(parseReminderDays(""), []);
  assert.deepEqual(parseReminderDays(null), []);
});

const base = { start_date: "2027-02-08", end_date: "2027-03-09", default_start: "19:30", kultum_minutes: 7, event_minutes: 90, reminder_days: [3, 2, 1, 0] };

test("settings: valid input is cleaned, bad input is refused with a reason", () => {
  const ok = parseRamadan({ ...base, pattern: [{ weekday: 1, active: true, place: " Assembly   Room - SENTAN ", start_time: "19:45", kultum: true }] });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.settings, { start_date: "2027-02-08", end_date: "2027-03-09", default_start: "19:30", kultum_minutes: 7, event_minutes: 90, reminder_days: "3,2,1,0" });
  assert.deepEqual(ok.pattern[0], { weekday: 1, active: 1, place: "Assembly Room - SENTAN", start_time: "19:45", kultum: 1, reminders: 1 });

  for (const [bad, why] of [
    [{ ...base, start_date: "2027-02-30" }, /dates must look like/],
    [{ ...base, end_date: null }, /both the first and the last/],
    [{ ...base, end_date: "2027-02-01" }, /before the first/],
    [{ ...base, end_date: "2027-06-30" }, /more than 45 days/],
    [{ ...base, default_start: "7pm" }, /19:30/],
    [{ ...base, kultum_minutes: 0 }, /1 to 60/],
    [{ ...base, kultum_minutes: 7.5 }, /1 to 60/],
    [{ ...base, event_minutes: 5 }, /15 to 360/],
    [{ ...base, pattern: [{ weekday: 7 }] }, /0 \(Sunday\) to 6/],
    [{ ...base, pattern: [{ weekday: 1, start_time: "25:00" }] }, /Monday: the start time/],
    [{ ...base, pattern: [{ weekday: 1 }, { weekday: 1 }] }, /listed twice/],
    [null, /invalid body/],
  ]) assert.match(parseRamadan(bad).error || "", why, JSON.stringify(bad).slice(0, 60));
  assert.equal(parseRamadan({ default_start: "19:30" }).error, undefined, "no dates at all is fine: Ramadan not set");
  assert.ok(MAX_DAYS >= 30);
});

const pattern = [
  { weekday: 1, active: true, place: "Assembly Room - SENTAN", start_time: "19:45", kultum: true, reminders: true },
  { weekday: 3, active: true, place: "Lounge Dorm 1", start_time: null, kultum: false, reminders: false },
  { weekday: 5, active: false, place: "x", start_time: "20:00", kultum: true, reminders: true },
];

test("the days are made from the pattern: only the chosen weekdays, with each weekday's place and time", () => {
  const rows = gatheringsToCreate({ settings: { ...base, end_date: "2027-02-14" }, pattern, existingDates: [] });
  assert.deepEqual(rows, [
    { date: "2027-02-08", place: "Assembly Room - SENTAN", start_time: "19:45", kultum: 1, reminders: 1 },
    { date: "2027-02-10", place: "Lounge Dorm 1", start_time: "19:30", kultum: 0, reminders: 0 },
  ]);
});

test("existing days are never touched or duplicated; a month makes about 8 to 9 Mondays and Wednesdays", () => {
  const first = gatheringsToCreate({ settings: base, pattern, existingDates: [] });
  assert.equal(first.length, 9, "5 Mondays and 4 Wednesdays between 8 Feb and 9 Mar 2027");
  const again = gatheringsToCreate({ settings: base, pattern, existingDates: first.map((g) => g.date) });
  assert.deepEqual(again, []);
  const one = gatheringsToCreate({ settings: base, pattern, existingDates: first.slice(1).map((g) => g.date) });
  assert.deepEqual(one.map((g) => g.date), [first[0].date]);
  assert.deepEqual(gatheringsToCreate({ settings: { ...base, start_date: null, end_date: null }, pattern, existingDates: [] }), [], "no dates: nothing");
});

test("one day edited: only what is present is changed; a speaker is a roster person or a typed name", () => {
  assert.match(parseGathering({ date: "bad" }, { requireDate: true }).error, /date must look like/);
  assert.match(parseGathering({ start_time: "7pm" }, { requireDate: false }).error, /19:30/);
  assert.match(parseGathering({ kultum_minutes: 99 }, { requireDate: false }).error, /1 to 60/);
  assert.deepEqual(parseGathering({ kultum: true, info: "  bring   dates " }, { requireDate: false }), { kultum: 1, info: "bring dates" });
  assert.deepEqual(parseGathering({ speaker_id: 5, speaker_name: "Ignored" }, { requireDate: false }), { speaker_id: 5, speaker_name: null });
  assert.deepEqual(parseGathering({ speaker_id: null, speaker_name: " Prof.  Arai " }, { requireDate: false }), { speaker_id: null, speaker_name: "Prof. Arai" });
  assert.deepEqual(parseGathering({ speaker_id: null, speaker_name: "" }, { requireDate: false }), { speaker_id: null, speaker_name: null }, "clearing the speaker");
  assert.equal(parseGathering({ speaker_name: "x".repeat(200) }, { requireDate: false }).speaker_name.length, 80);
  assert.deepEqual(parseGathering({ kultum_minutes: "" }, { requireDate: false }), { kultum_minutes: null }, "empty = the setting");
});

test("a day as sent to the page: kultum minutes fall back to the setting", () => {
  const row = { id: 3, date: "2027-02-08", place: null, start_time: "19:45", kultum: 1, kultum_minutes: null, speaker_id: 4, speaker: "Ahmad", reminders: 1, info: null };
  assert.deepEqual(shapeGathering(row, { kultum_minutes: 7 }), { id: 3, date: "2027-02-08", place: "", start_time: "19:45", kultum: true, kultum_minutes: 7, speaker_id: 4, speaker: "Ahmad", reminders: true, info: "" });
});
