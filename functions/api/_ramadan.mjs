// Ramadan: parsing and checking what the admin enters, and making the days from the
// weekly pattern. Pure functions, shared by the Functions and the tests.
// Ramadan days share the Google event ids and the reminder log with the Fridays, offset
// by this so an id can never collide with a Friday's.
export const GATHERING_ID_OFFSET = 1_000_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MAX_DAYS = 45; // Ramadan is 29 or 30 days; a little room, never a year of rows

export function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const isTime = (value) => typeof value === "string" && TIME.test(value);

export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Every date from start to end, both included.
export function datesInRange(start, end) {
  const out = [];
  for (let d = start; d <= end && out.length <= MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const flag = (value) => (value === true || value === 1 || value === "1" ? 1 : 0);

// The "reminder_days" setting is saved as "3,2,1,0".
export function parseReminderDays(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const numbers = list.map((x) => String(x).trim()).filter((x) => x !== "").map(Number);
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))].sort((a, b) => b - a);
}

// The settings and the weekly pattern as the admin sent them. Returns { error } or the clean values.
export function parseRamadan(body) {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const start = body.start_date || null;
  const end = body.end_date || null;
  if ((start && !isDate(start)) || (end && !isDate(end))) return { error: "dates must look like 2027-02-08" };
  if (!!start !== !!end) return { error: "set both the first and the last day of Ramadan, or neither" };
  if (start && end) {
    if (end < start) return { error: "the last day is before the first day" };
    if (datesInRange(start, end).length > MAX_DAYS) return { error: `that is more than ${MAX_DAYS} days` };
  }
  const defaultStart = body.default_start ?? "19:30";
  if (!isTime(defaultStart)) return { error: "the start time must look like 19:30" };
  const kultumMinutes = Number(body.kultum_minutes ?? 7);
  if (!Number.isInteger(kultumMinutes) || kultumMinutes < 1 || kultumMinutes > 60) return { error: "the kultum length must be 1 to 60 minutes" };
  const eventMinutes = Number(body.event_minutes ?? 90);
  if (!Number.isInteger(eventMinutes) || eventMinutes < 15 || eventMinutes > 360) return { error: "the calendar event length must be 15 to 360 minutes" };
  const reminderDays = parseReminderDays(body.reminder_days ?? "3,2,1,0");

  const pattern = [];
  const given = Array.isArray(body.pattern) ? body.pattern : [];
  for (const row of given) {
    const weekday = Number(row?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "a weekday must be 0 (Sunday) to 6 (Saturday)" };
    const startTime = row.start_time ? String(row.start_time) : null;
    if (startTime && !isTime(startTime)) return { error: `${WEEKDAYS[weekday]}: the start time must look like 19:30` };
    pattern.push({ weekday, active: flag(row.active), place: text(row.place, 60) || null, start_time: startTime, kultum: flag(row.kultum), reminders: row.reminders === false || row.reminders === 0 ? 0 : 1 });
  }
  if (new Set(pattern.map((p) => p.weekday)).size !== pattern.length) return { error: "a weekday is listed twice" };

  return { settings: { start_date: start, end_date: end, default_start: defaultStart, kultum_minutes: kultumMinutes, event_minutes: eventMinutes, reminder_days: reminderDays.join(",") }, pattern };
}

// The days to create: every date in range whose weekday is on in the pattern and that has no gathering yet.
export function gatheringsToCreate({ settings, pattern, existingDates }) {
  if (!settings.start_date || !settings.end_date) return [];
  const byWeekday = new Map(pattern.map((p) => [p.weekday, p]));
  const have = new Set(existingDates);
  return datesInRange(settings.start_date, settings.end_date)
    .filter((date) => !have.has(date) && byWeekday.get(weekdayOf(date))?.active)
    .map((date) => {
      const row = byWeekday.get(weekdayOf(date));
      return { date, place: row.place || null, start_time: row.start_time || settings.default_start, kultum: row.kultum ? 1 : 0, reminders: row.reminders ? 1 : 0 };
    });
}

// One gathering edited by the admin. `given` says what was present (a PATCH changes only those).
export function parseGathering(body, { requireDate }) {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const out = {};
  if (requireDate || "date" in body) {
    if (!isDate(body.date)) return { error: "the date must look like 2027-02-08" };
    out.date = body.date;
  }
  if ("place" in body) out.place = text(body.place, 60) || null;
  if ("start_time" in body) {
    if (!isTime(body.start_time)) return { error: "the start time must look like 19:30" };
    out.start_time = body.start_time;
  }
  if ("kultum" in body) out.kultum = flag(body.kultum);
  if ("kultum_minutes" in body) {
    if (body.kultum_minutes === null || body.kultum_minutes === "") out.kultum_minutes = null;
    else {
      const n = Number(body.kultum_minutes);
      if (!Number.isInteger(n) || n < 1 || n > 60) return { error: "the kultum length must be 1 to 60 minutes" };
      out.kultum_minutes = n;
    }
  }
  if ("speaker_id" in body) out.speaker_id = body.speaker_id ? Number(body.speaker_id) : null;
  if ("speaker_name" in body) out.speaker_name = text(body.speaker_name, 80) || null;
  if ("reminders" in body) out.reminders = flag(body.reminders);
  if ("info" in body) out.info = text(body.info, 300) || null;
  // A speaker is either a roster person or a typed name, never both.
  if (out.speaker_id) out.speaker_name = null;
  else if (out.speaker_name) out.speaker_id = null;
  return out;
}

export const GATHERING_SELECT = `
  SELECT g.id, g.date, g.place, g.start_time, g.kultum, g.kultum_minutes, g.speaker_id,
         COALESCE(p.name, g.speaker_name) AS speaker, g.reminders, g.info
  FROM gatherings g LEFT JOIN people p ON p.id = g.speaker_id`;

export function shapeGathering(row, settings) {
  return {
    id: row.id,
    date: row.date,
    place: row.place || "",
    start_time: row.start_time,
    kultum: !!row.kultum,
    kultum_minutes: row.kultum_minutes ?? settings.kultum_minutes,
    speaker_id: row.speaker_id ?? null,
    speaker: row.speaker || "",
    reminders: !!row.reminders,
    info: row.info || "",
  };
}
