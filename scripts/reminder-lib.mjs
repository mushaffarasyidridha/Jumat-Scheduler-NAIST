// Pure logic for the daily reminder job: who is due a reminder today and what
// it says. No network or database access here, so it can be unit-tested.

import { createRequire } from "node:module";
import { lineupLines } from "../functions/api/_alertmail.mjs";
import { GATHERING_ID_OFFSET } from "../functions/api/_ramadan.mjs";

// The "can't make it" email lives with the Functions code (they can send it too).
export { alertRecipients, buildAlertEmail } from "../functions/api/_alertmail.mjs";

// The wording and date helpers live in one file shared with the web page (the
// planner's manual "Copy reminder" / WhatsApp buttons), so hand-sent and
// automatic reminders can never drift apart.
const shared = createRequire(import.meta.url)("../public/reminder-message.js");
export const { ROLE_SLOTS, PRAYER_TIME, formatDateShort, formatDateLong } = shared;
const { whenPhrase, venueOf, standbyNote, chatText, calendarShortLink, kultumChatText, formatDateWithWeekday } = shared;

export { DEFAULT_SITE_URL } from "../functions/api/_site.mjs";
import { DEFAULT_SITE_URL as FALLBACK_SITE_URL } from "../functions/api/_site.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // Japan has no daylight saving

// "Today" as the community experiences it (NAIST is in Japan), whatever time
// zone the runner is in.
export function todayInTokyo(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// Minutes since midnight, Japan time.
export function minutesInTokyo(now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

// A reminder for a prayer that is TODAY only helps early in the day. GitHub
// starts scheduled jobs late (once by almost 6 hours), so without this cut-off
// a "you are scheduled today" message can arrive after the prayer is over.
export const SAME_DAY_CUTOFF_MINUTES = 11 * 60; // 11:00 JST

export function tooLateToSend(days, nowMinutes) {
  return days === 0 && nowMinutes >= SAME_DAY_CUTOFF_MINUTES;
}

export function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysUntil(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

// A week-ahead heads-up, then a last reminder the day before. Ranges (not
// exact days) so a missed run doesn't skip a reminder, and so a Friday
// assigned late still gets one - but a person is never sent both on one day.
export function reminderKindFor(days) {
  if (days >= 0 && days <= 1) return "1d";
  if (days >= 2 && days <= 7) return "7d";
  return null;
}

export function sentKey(fridayId, personId, kind, channel) {
  return `${fridayId}:${personId}:${kind}:${channel}`;
}

// fridays: rows with date + the three slot ids; people: rows with id, name,
// email, reminders, line_user_id; sentKeys: Set of sentKey() already delivered.
// One entry per person per channel, with all of that person's roles that day
// grouped (someone who is both khatib and imam gets one message, not two).
export function dueReminders({ today, fridays, people, sentKeys }) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const due = [];

  for (const friday of fridays) {
    const days = daysUntil(today, friday.date);
    const kind = reminderKindFor(days);
    if (!kind) continue;

    const rolesByPerson = new Map();
    for (const slot of ROLE_SLOTS) {
      if (slot.notify === false) continue; // the secondary khatib is not sent reminders
      const personId = friday[slot.field];
      if (personId == null) continue; // open slot, or a free-text guest with no contact details
      if (!rolesByPerson.has(personId)) rolesByPerson.set(personId, []);
      rolesByPerson.get(personId).push(slot.label);
    }

    for (const [personId, roles] of rolesByPerson) {
      const person = peopleById.get(personId);
      if (!person || !person.reminders) continue;
      const channels = [];
      if (person.email) channels.push("email");
      if (person.line_user_id) channels.push("line");
      for (const channel of channels) {
        const key = sentKey(friday.id, personId, kind, channel);
        if (sentKeys.has(key)) continue;
        due.push({ key, friday, person, roles, kind, channel, days });
      }
    }
  }

  // Nearest Friday first, so if something has to run out (LINE's monthly
  // quota) it is the furthest-away reminders that wait.
  due.sort((a, b) => a.days - b.days || a.person.name.localeCompare(b.person.name));
  return due;
}

// ---------- admin to-do ----------
//
// WhatsApp and Facebook can't be automated (see the README), so the admin
// sends those reminders by hand, and posts the Friday announcement in the
// WhatsApp and Facebook groups. This is the nudge to do both, sent at the same
// two moments as the automatic reminders (a week ahead, and the day before).

const NAME_FIELD = { primary_khatib_id: "primary_name", secondary_khatib_id: "secondary_name", imam_id: "imam_name" };

function reachedAutomatically(person) {
  return !!(person && person.reminders && (person.email || person.line_user_id));
}

// For one Friday: who the admin has to message by hand (no email / LINE, or
// their reminders are off, or a guest typed in as free text), and which
// essential slots are still empty. The secondary khatib is standby and is not
// notified, so an empty secondary slot is not flagged and they are not listed.
export function adminChecklist(friday, peopleById) {
  const byHand = [];
  const seen = new Map();
  const open = [];
  for (const slot of ROLE_SLOTS) {
    if (slot.notify === false) continue;
    const id = friday[slot.field];
    const name = friday[NAME_FIELD[slot.field]];
    if (!name) {
      open.push(slot.label);
      continue;
    }
    if (id != null && reachedAutomatically(peopleById.get(id))) continue;
    const key = id != null ? `id:${id}` : `guest:${String(name).toLowerCase()}`;
    if (!seen.has(key)) {
      const entry = { name, roles: [] };
      seen.set(key, entry);
      byHand.push(entry);
    }
    seen.get(key).roles.push(slot.label);
  }
  return { byHand, open };
}

// One entry per admin per channel per Friday, kind "admin-7d" or "admin-1d"
// (own kinds, so they never collide with the khatib's own reminder in the log).
export function dueAdminTodos({ today, fridays, people, sentKeys }) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const admins = people.filter((p) => p.is_admin && p.status === "active" && p.reminders);
  const due = [];

  for (const friday of fridays) {
    const days = daysUntil(today, friday.date);
    const reminderKind = reminderKindFor(days);
    if (!reminderKind) continue;

    const checklist = adminChecklist(friday, peopleById);
    // A week ahead the only job is the by-hand reminders and filling empty
    // slots: with neither, stay quiet. The day before always goes out, because
    // the group announcement is always due.
    if (reminderKind === "7d" && !checklist.byHand.length && !checklist.open.length) continue;

    const kind = `admin-${reminderKind}`;
    for (const person of admins) {
      const channels = [];
      if (person.email) channels.push("email");
      if (person.line_user_id) channels.push("line");
      for (const channel of channels) {
        const key = sentKey(friday.id, person.id, kind, channel);
        if (sentKeys.has(key)) continue;
        due.push({ type: "admin", key, friday, person, kind, channel, days, checklist });
      }
    }
  }
  return due;
}

function adminTodoBlocks({ kind, checklist }) {
  const blocks = [];
  if (checklist.byHand.length) {
    blocks.push(
      [
        "Send the reminder by hand (WhatsApp / Facebook) to:",
        ...checklist.byHand.map((p) => `   • ${p.name} (${p.roles.join(" + ")})`),
      ].join("\n")
    );
  } else if (kind === "admin-1d") {
    blocks.push("Nobody needs a reminder by hand: everyone assigned is reached by email or LINE.");
  }
  if (kind === "admin-1d") {
    blocks.push("Post the announcement in the WhatsApp group and the Facebook group.");
  }
  return blocks;
}

const ADMIN_HOWTO =
  "In the Admin planner: the Copy reminder / WhatsApp buttons are under each assigned person; for the announcement, open the Friday on the calendar and press Generate announcement.";

export function buildAdminChatText({ friday, person, kind, days, checklist, siteUrl = FALLBACK_SITE_URL }) {
  const blocks = adminTodoBlocks({ kind, checklist });
  return [
    "🗂 Jumat admin to-do",
    `Assalamu'alaikum ${person.name}, for ${formatDateLong(friday.date)} (${whenPhrase(days)}):`,
    ...blocks.map((block, i) => `${i + 1}. ${block}`),
    ...(checklist.open.length ? [`⚠ Not assigned yet: ${checklist.open.join(", ")}`] : []),
    `${ADMIN_HOWTO} ${siteUrl}`,
  ].join("\n");
}

export function buildAdminEmail({ friday, person, kind, days, checklist, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${person.reminder_token}`;
  const blocks = adminTodoBlocks({ kind, checklist });
  const text = [
    `Assalamu'alaikum ${person.name},`,
    "",
    `You are an admin of the NAIST Jumat schedule. To do for ${formatDateLong(friday.date)} (${whenPhrase(days)}):`,
    "",
    ...blocks.map((block, i) => `${i + 1}. ${block}`),
    ...(checklist.open.length ? ["", `Not assigned yet: ${checklist.open.join(", ")}`] : []),
    "",
    ADMIN_HOWTO,
    siteUrl,
    "",
    "JazakAllahu khairan.",
    "",
    "--",
    "You get this because you are marked as an admin on the NAIST Jumat roster.",
    `Stop these reminders: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Jumat admin to-do: ${formatDateShort(friday.date)}`, text, unsubscribeUrl };
}

export function buildEmail({ friday, person, roles, days, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${person.reminder_token}`;
  const lineup = lineupLines(friday);
  const standby = standbyNote(roles);
  const calendar = calendarShortLink({ siteUrl, friday, roles });

  const text = [
    `Assalamu'alaikum ${person.name},`,
    "",
    "A reminder that you are scheduled for Jumat prayer at NAIST:",
    "",
    `  Date:  ${formatDateLong(friday.date)} (${whenPhrase(days)})`,
    `  Time:  ${PRAYER_TIME}`,
    `  Place: ${venueOf(friday)}`,
    `  Your role: ${roles.join(" + ")}`,
    "",
    ...(lineup.length ? ["Line-up that day:", ...lineup.map((l) => `  ${l}`), ""] : []),
    ...(standby ? [standby, ""] : []),
    ...(calendar ? [`Add it to your Google Calendar: ${calendar}`, ""] : []),
    ...(shared.wantsKhutbahChecklist(person, roles) ? [...shared.khutbahChecklistLines(), ""] : []),
    "Can't make it? Please tell the coordinator as soon as possible (you can reply to this email) so a replacement can be found.",
    "",
    `Full schedule: ${siteUrl}`,
    "",
    "JazakAllahu khairan.",
    "",
    "--",
    "You get this because you are on the NAIST Jumat khatib/imam roster with this email address.",
    `Stop these reminders: ${unsubscribeUrl}`,
  ].join("\n");

  return {
    subject: `Jumat reminder: ${roles.join(" & ")} on ${formatDateShort(friday.date)}`,
    text,
    unsubscribeUrl,
  };
}

// The chat-app version (LINE push today; the page's Copy / WhatsApp buttons use
// the same text straight from the shared file).
export function buildLineText(args) {
  return chatText(args);
}

// ---------- Ramadan: the kultum speaker ----------
//
// A Ramadan day with a kultum and a named speaker reminds that speaker on the days
// the admin chose (default 3, 2, 1 days before and the day itself). Their reminders
// share the reminder log with the Fridays, under ids offset by GATHERING_ID_OFFSET
// (so a Friday and a Ramadan day can never collide) and kinds "g3", "g2", "g1", "g0".

export { GATHERING_ID_OFFSET };

// The setting is saved as "3,2,1,0".
export function parseReminderDaysSetting(value) {
  const numbers = String(value ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number);
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))].sort((a, b) => b - a);
}

// A reminder for a Ramadan evening that is TODAY only helps while there is still time
// before the start: skip it from two hours before. (Fridays use the 11:00 cut-off.)
export function tooLateForKultum(days, nowMinutes, startTime) {
  if (days !== 0) return false;
  const [h, m] = String(startTime || "19:30").split(":").map(Number);
  return nowMinutes >= h * 60 + m - 120;
}

// One reminder per speaker per channel per run: the nearest chosen day that has been
// reached (so a run missed on day 2 still sends the day-1 reminder), never more than one.
export function kultumOffsetFor(days, reminderDays) {
  const reached = reminderDays.filter((o) => o >= days);
  return days >= 0 && reached.length ? Math.min(...reached) : null;
}

// gatherings: rows with id, date, place, start_time, kultum, kultum_minutes, speaker_id,
// speaker, reminders. settings: { kultum_minutes, reminder_days: [3,2,1,0] }.
export function dueKultumReminders({ today, gatherings, settings, people, sentKeys }) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const due = [];
  for (const g of gatherings) {
    if (!g.kultum || !g.reminders || g.speaker_id == null) continue; // no kultum, reminders off, or a guest / nobody yet
    const days = daysUntil(today, g.date);
    const offset = kultumOffsetFor(days, settings.reminder_days);
    if (offset === null) continue;
    const person = peopleById.get(g.speaker_id);
    if (!person || !person.reminders) continue;
    const channels = [];
    if (person.email) channels.push("email");
    if (person.line_user_id) channels.push("line");
    for (const channel of channels) {
      const kind = `g${offset}`;
      const key = sentKey(GATHERING_ID_OFFSET + g.id, person.id, kind, channel);
      if (sentKeys.has(key)) continue;
      due.push({ key, type: "kultum", gathering: g, person, kind, channel, days, minutes: g.kultum_minutes || settings.kultum_minutes, logId: GATHERING_ID_OFFSET + g.id });
    }
  }
  due.sort((a, b) => a.days - b.days || a.person.name.localeCompare(b.person.name));
  return due;
}

export function buildKultumEmail({ gathering: g, person, days, minutes, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${person.reminder_token}`;
  const text = [
    `Assalamu'alaikum ${person.name},`,
    "",
    "A reminder that you are the kultum speaker at NAIST:",
    "",
    `  Date:  ${formatDateWithWeekday(g.date)} (${whenPhrase(days)})`,
    `  Isha and Tarawih start: ${g.start_time}`,
    `  Kultum: a short talk of about ${minutes} minutes`,
    `  Place: ${(g.place || "").trim() || "to be announced"}`,
    "",
    "Can't make it? Please tell the coordinator as soon as possible (you can reply to this email) so a replacement can be found.",
    "",
    `Full schedule: ${siteUrl}`,
    "",
    "JazakAllahu khairan.",
    "",
    "--",
    "You get this because you are on the NAIST Jumat roster with this email address.",
    `Stop these reminders: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Kultum reminder: ${formatDateShort(g.date)} (${whenPhrase(days)})`, text, unsubscribeUrl };
}

export function buildKultumLineText(args) {
  return kultumChatText(args);
}

// ---------- People who have left ----------
//
// A person with an expected leaving date (NAIST or Nara) who is still active is moved to
// "No longer at NAIST" by the daily job once that day has passed. people: rows with
// id, status, leaving_on.
export function leaversDue(people, today) {
  return people.filter((p) => p.status === "active" && p.leaving_on && p.leaving_on < today);
}

// ---------- The month's full schedule, on the 1st ----------
//
// On the first day of each month (Japan time) the admins and everyone scheduled that month get
// the whole month's schedule: every Friday with its khatib, imam and place, and the Ramadan
// evenings. Logged once per person and channel under MONTH_ID_OFFSET + yyyymm (kind "month"),
// so the second run of the same day never repeats it.
export const MONTH_ID_OFFSET = 2_000_000;

export const monthLogId = (today) => MONTH_ID_OFFSET + Number(today.slice(0, 4)) * 100 + Number(today.slice(5, 7));

// "October 2026" from any date in that month.
export const monthNameOf = (iso) => formatDateShort(`${iso.slice(0, 8)}01`).split(" ").slice(1).join(" ");

export const isFirstOfMonth = (today) => today.slice(8, 10) === "01";

// fridays: rows of the month with date, venue, the three slot ids and primary_name / secondary_name /
// imam_name. gatherings: rows of the month with date, place, start_time, kultum, speaker.
// people: rows with id, name, status, is_admin, email, reminders, line_user_id, reminder_token.
export function dueMonthlyReminders({ today, fridays, gatherings = [], people, sentKeys }) {
  if (!isFirstOfMonth(today) || (!fridays.length && !gatherings.length)) return [];
  const scheduled = new Set();
  for (const f of fridays) for (const slot of ROLE_SLOTS) if (slot.notify !== false && f[slot.field] != null) scheduled.add(f[slot.field]);
  const logId = monthLogId(today);
  const due = [];
  for (const person of people) {
    if (person.status !== "active" || !person.reminders) continue;
    if (!person.is_admin && !scheduled.has(person.id)) continue;
    const mine = fridays
      .map((f) => ({ date: f.date, roles: ROLE_SLOTS.filter((s) => s.notify !== false && f[s.field] === person.id).map((s) => s.label) }))
      .filter((m) => m.roles.length);
    const channels = [];
    if (person.email) channels.push("email");
    if (person.line_user_id) channels.push("line");
    for (const channel of channels) {
      const key = sentKey(logId, person.id, "month", channel);
      if (sentKeys.has(key)) continue;
      due.push({ type: "month", key, person, kind: "month", channel, days: 0, logId, month: monthNameOf(today), fridays, gatherings, mine, open: openSlotDates(fridays) });
    }
  }
  return due;
}

// The Fridays that still miss a khatib or an imam (the secondary is standby and not counted).
function openSlotDates(fridays) {
  return fridays.filter((f) => !f.primary_name || !f.imam_name).map((f) => formatDateShort(f.date));
}

function fridayLine(f) {
  const place = (f.venue || "").trim() || "place to be announced";
  return `${formatDateShort(f.date)}: khatib ${f.primary_name || "(open)"} · imam ${f.imam_name || "(open)"} · ${place}`;
}

function gatheringLine(g) {
  const talk = g.kultum ? `, kultum ${g.speaker || "(speaker open)"}` : "";
  return `${formatDateWithWeekday(g.date)}: Isha + Tarawih ${g.start_time}, ${(g.place || "").trim() || "place to be announced"}${talk}`;
}

function monthBlocks({ month, fridays, gatherings, mine, open, person }) {
  const blocks = [];
  blocks.push([`Jumat prayer, ${month} (${PRAYER_TIME}):`, ...(fridays.length ? fridays.map((f) => `  ${fridayLine(f)}`) : ["  no Friday on the schedule yet"])].join("\n"));
  if (gatherings.length) blocks.push(["Ramadan evenings:", ...gatherings.map((g) => `  ${gatheringLine(g)}`)].join("\n"));
  if (mine.length) blocks.push(["You are scheduled on:", ...mine.map((m) => `  ${formatDateShort(m.date)} (${m.roles.join(" + ")})`)].join("\n"));
  if (person.is_admin && open.length) blocks.push(`Admin: still open (khatib or imam): ${open.join(", ")}`);
  return blocks;
}

export function buildMonthEmail({ month, fridays, gatherings, mine, open, person, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${person.reminder_token}`;
  const text = [
    `Assalamu'alaikum ${person.name},`,
    "",
    `The first of the month: here is the whole schedule for ${month}.`,
    "",
    ...monthBlocks({ month, fridays, gatherings, mine, open, person }).flatMap((b) => [b, ""]),
    `Changes and the latest version: ${siteUrl}`,
    "",
    "JazakAllahu khairan.",
    "",
    "--",
    "You get this because you are on the NAIST Jumat roster with this email address and are scheduled this month (or are an admin).",
    `Stop these reminders: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Jumat schedule for ${month}`, text, unsubscribeUrl };
}

export function buildMonthLineText({ month, fridays, gatherings, mine, open, person, siteUrl = FALLBACK_SITE_URL }) {
  return [`📅 Jumat schedule, ${month}`, `Assalamu'alaikum ${person.name}:`, ...monthBlocks({ month, fridays, gatherings, mine, open, person }), siteUrl].join("\n\n");
}
