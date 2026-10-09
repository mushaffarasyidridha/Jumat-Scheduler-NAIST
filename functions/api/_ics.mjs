// The public iCalendar (.ics) feed of the Friday schedule - what anyone with a
// Google account (or Apple / Outlook) subscribes to. Pure functions, so they can
// be unit-tested in Node (scripts/reminder-lib.test.mjs).
//
// It only ever carries what the public schedule page already shows: date, time,
// venue, and who is khatib / imam. No contact details.
import shared from "../../public/reminder-message.js";

const { PRAYER_TIME, calendarStamp, prayerWindowUtc, venueOf } = shared;

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

function khatibLine(friday) {
  const { primary_name: primary, secondary_name: secondary } = friday;
  if (primary && secondary) return `${primary} / ${secondary} (Secondary)`;
  if (primary) return primary;
  if (secondary) return `${secondary} (Secondary)`;
  return "TBA";
}

function describe(friday, siteUrl) {
  const lines = [
    `Khatib: ${khatibLine(friday)}`,
    `Imam: ${friday.imam_name || "TBA"}`,
    `Time: ${PRAYER_TIME}`,
    `Venue: ${venueOf(friday)}`,
  ];
  const info = (friday.info || "").trim();
  if (info && info.toUpperCase() !== "TBA") lines.push(`Note: ${info}`);
  lines.push("", `Schedule and any changes: ${siteUrl}`);
  return lines.join("\n");
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
    `SUMMARY:${escapeText(friday.primary_name ? `Jumat prayer: Khatib ${friday.primary_name}` : "Jumat prayer (khatib not assigned yet)")}`,
    ...(venue ? [`LOCATION:${escapeText(venue)}`] : []),
    `DESCRIPTION:${escapeText(describe(friday, siteUrl))}`,
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
