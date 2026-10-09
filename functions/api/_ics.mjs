// The public iCalendar (.ics) feed of the Friday schedule - what anyone with a
// Google account (or Apple / Outlook) subscribes to. Pure functions, so they can
// be unit-tested in Node (scripts/reminder-lib.test.mjs).
//
// It only ever carries what the public schedule page already shows: date, time,
// venue, and who is khatib / imam. No contact details.
import shared from "../../public/reminder-message.js";
import announcement from "../../public/announcement.js";

const { calendarStamp, prayerWindowUtc } = shared;
const { buildAnnouncementText, hadithForDate, khatibLine } = announcement;

const encoder = new TextEncoder();

// RFC 5545 TEXT values: backslash, semicolon, comma and line breaks are escaped.
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines may not exceed 75 octets; longer ones continue on the next line after a
// single space. Counted in UTF-8 bytes, and never splits a character.
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let bytes = 0;
  let limit = 75; // continuation lines begin with a space, which counts too
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// What the event is called in a calendar: who is khatib and imam at a glance.
export function eventTitle(friday) {
  return `Jumat prayer - Khatib: ${khatibLine(friday)}, Imam: ${friday.imam_name || "TBA"}`;
}

// Where someone scheduled can say they can't make it: the website, opened on
// that Friday. (Marking yourself unavailable needs no access code.)
export function cantMakeItLink(siteUrl, friday) {
  return `${siteUrl}/?friday=${friday.id}`;
}

// The description of the event is the weekly broadcast itself, so whoever opens
// the event reads exactly what is posted in the groups, plus how to say you
// can't make it.
export function eventDescription(friday, siteUrl) {
  const parts = [buildAnnouncementText(friday, hadithForDate(friday.date))];
  const info = (friday.info || "").trim();
  if (info && info.toUpperCase() !== "TBA") parts.push(`Note: ${info}`);
  parts.push(`Can't make it? Please tell us here, so a replacement can be found: ${cantMakeItLink(siteUrl, friday)}`);
  return parts.join("\n\n");
}

// SQLite's datetime('now') is "2026-10-09 06:01:17" in UTC.
function modifiedMs(friday, fallbackMs) {
  const ms = Date.parse(String(friday.updated_at || "").replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? fallbackMs : ms;
}

export function buildEvent(friday, { siteUrl, nowMs }) {
  const { startMs, endMs } = prayerWindowUtc(friday.date);
  const stamp = calendarStamp(modifiedMs(friday, nowMs));
  const venue = (friday.venue || "").trim();
  return [
    "BEGIN:VEVENT",
    `UID:jumat-friday-${friday.id}@jumat-scheduler-naist`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `DTSTART:${calendarStamp(startMs)}`,
    `DTEND:${calendarStamp(endMs)}`,
    `SUMMARY:${escapeText(eventTitle(friday))}`,
    ...(venue ? [`LOCATION:${escapeText(venue)}`] : []),
    `DESCRIPTION:${escapeText(eventDescription(friday, siteUrl))}`,
    `URL:${siteUrl}`,
    // Informational for everyone who subscribes: it should not mark their
    // calendar as busy during the prayer.
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].map(foldLine);
}

export function buildCalendar({ fridays, siteUrl, nowMs = Date.now() }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NAIST Jumat Scheduler//Friday prayer//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:NAIST Jumat prayer",
    "X-WR-CALDESC:Khatib and imam for the NAIST Friday prayer",
    "X-WR-TIMEZONE:Asia/Tokyo",
    // Hints for calendar apps; Google decides for itself (every few hours).
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...fridays.flatMap((friday) => buildEvent(friday, { siteUrl, nowMs })),
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
