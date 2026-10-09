// Pure logic for the daily reminder job: who is due a reminder today and what
// it says. No network or database access here, so it can be unit-tested.

import { createRequire } from "node:module";

// The wording and date helpers live in one file shared with the web page (the
// planner's manual "Copy reminder" / WhatsApp buttons), so hand-sent and
// automatic reminders can never drift apart.
const shared = createRequire(import.meta.url)("../public/reminder-message.js");
const { PRAYER_TIME, whenPhrase, venueOf, standbyNote, chatText } = shared;
export const { ROLE_SLOTS, formatDateShort, formatDateLong } = shared;

export const DEFAULT_SITE_URL = "https://jumat-scheduler-naist.pages.dev";

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

function lineupLines(friday) {
  const lines = [];
  if (friday.primary_name && friday.secondary_name) {
    lines.push(`Khatib: ${friday.primary_name} / ${friday.secondary_name} (Secondary)`);
  } else if (friday.primary_name) {
    lines.push(`Khatib: ${friday.primary_name}`);
  } else if (friday.secondary_name) {
    lines.push(`Khatib: ${friday.secondary_name} (Secondary)`);
  }
  if (friday.imam_name) lines.push(`Imam: ${friday.imam_name}`);
  return lines;
}

export function buildEmail({ friday, person, roles, days, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${person.reminder_token}`;
  const lineup = lineupLines(friday);
  const standby = standbyNote(roles);

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
