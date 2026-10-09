// Wording and small helpers shared by the page (the planner's "Copy reminder"
// and "WhatsApp" buttons) and the daily reminder job (scripts/reminder-lib.mjs),
// so a reminder sent by hand reads exactly like an automatic one.
//
// A plain script - no import/export - so the page can load it with a <script>
// tag; Node loads the very same file through require().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JumatReminderMessage = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The one place the prayer time lives (Japan time, no daylight saving). The
  // announcement, the emails, the Copy / WhatsApp texts and the calendar event
  // all read it from here.
  const PRAYER_START = { hour: 12, minute: 35 };
  const JST_OFFSET_HOURS = 9;
  // How long the calendar event lasts. Only the start time is announced; this
  // just gives the event a sensible length on someone's calendar.
  const PRAYER_DURATION_MIN = 30;

  function clockLabel({ hour, minute }) {
    return `${hour % 12 || 12}.${String(minute).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}`;
  }
  const PRAYER_TIME = `${clockLabel(PRAYER_START)} (start)`;

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Which Friday column holds which role, how a reminder names it, and the
  // one-letter code the calendar link uses for it.
  const ROLE_SLOTS = [
    { field: "primary_khatib_id", label: "Primary khatib", code: "p" },
    { field: "secondary_khatib_id", label: "Secondary khatib (standby)", code: "s" },
    { field: "imam_id", label: "Imam", code: "i" },
  ];

  // Fixed "16 October 2026" format - never locale-dependent.
  function formatDateShort(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return `${day} ${MONTHS[month - 1]} ${year}`;
  }

  function formatDateLong(iso) {
    return `Friday, ${formatDateShort(iso)}`;
  }

  function whenPhrase(days) {
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  }

  function venueOf(friday) {
    return (friday.venue || "").trim() || "to be announced";
  }

  function standbyNote(roles) {
    return roles.some((r) => r.startsWith("Secondary"))
      ? "As secondary khatib you are on standby: please be ready to step in if the primary khatib can't make it."
      : null;
  }

  // ---------- Google Calendar ----------

  function calendarStamp(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  }

  // When the prayer starts and ends on a given Friday ("2026-10-16"), as UTC
  // milliseconds - so it is right whatever time zone a calendar is set to.
  function prayerWindowUtc(dateIso) {
    const [year, month, day] = dateIso.split("-").map(Number);
    const startMs = Date.UTC(year, month - 1, day, PRAYER_START.hour - JST_OFFSET_HOURS, PRAYER_START.minute);
    return { startMs, endMs: startMs + PRAYER_DURATION_MIN * 60000 };
  }

  // A Google Calendar "new event" link, already filled in: the person opens it
  // and presses Save.
  function calendarLink({ friday, roles }) {
    const { startMs, endMs } = prayerWindowUtc(friday.date);
    const role = roles.length ? roles.join(" + ") : null;
    const standby = standbyNote(roles);
    const venue = (friday.venue || "").trim();
    const details = [
      "Friday prayer (Jumat) at NAIST.",
      ...(role ? [`Your role: ${role}.`] : []),
      ...(standby ? [standby] : []),
      "Can't make it? Please tell the coordinator as soon as possible.",
    ].join("\n");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: role ? `Jumat prayer: ${role}` : "Jumat prayer",
      dates: `${calendarStamp(startMs)}/${calendarStamp(endMs)}`,
      details,
    });
    if (venue) params.set("location", venue);
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  function roleCodes(roles) {
    return ROLE_SLOTS.filter((s) => roles.includes(s.label)).map((s) => s.code).join("");
  }

  function rolesFromCodes(codes) {
    const wanted = String(codes || "").toLowerCase();
    return ROLE_SLOTS.filter((s) => wanted.includes(s.code)).map((s) => s.label);
  }

  // What goes into a message: a short link to this site, which sends the person
  // on to Google Calendar. Short because the full Google link is several hundred
  // characters, and because the site fills in the Friday's current venue when
  // it is opened, so a venue changed after the message was sent is still right.
  function calendarShortLink({ siteUrl, friday, roles }) {
    if (!siteUrl || friday.id == null) return null; // nothing saved to point at
    return `${siteUrl}/api/calendar/add?friday=${friday.id}&roles=${roleCodes(roles)}`;
  }

  // Short, plain-text reminder for a chat app (WhatsApp, LINE, Facebook...).
  // `roles` are ROLE_SLOTS labels, `days` is how many days away the Friday is.
  // With `siteUrl` (and a saved Friday) it also carries an "add to Google
  // Calendar" link.
  function chatText({ friday, person, roles, days, siteUrl }) {
    const standby = standbyNote(roles);
    const calendar = calendarShortLink({ siteUrl, friday, roles });
    return [
      "🕌 Jumat reminder",
      `Assalamu'alaikum ${person.name}, you are scheduled as ${roles.join(" + ")}:`,
      `📅 ${formatDateLong(friday.date)} (${whenPhrase(days)})`,
      `🕛 ${PRAYER_TIME}`,
      `📍 ${venueOf(friday)}`,
      ...(calendar ? [`📆 Add to Google Calendar: ${calendar}`] : []),
      ...(standby ? ["", standby] : []),
      "",
      "Can't make it? Please tell the coordinator as soon as possible.",
    ].join("\n");
  }

  // wa.me opens a WhatsApp chat with the message already typed in; it needs the
  // number in full international format, digits only. null if it can't be one.
  function whatsappLink(number, text) {
    const digits = String(number || "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  return {
    PRAYER_TIME,
    ROLE_SLOTS,
    formatDateShort,
    formatDateLong,
    whenPhrase,
    venueOf,
    standbyNote,
    calendarStamp,
    prayerWindowUtc,
    calendarLink,
    calendarShortLink,
    rolesFromCodes,
    chatText,
    whatsappLink,
  };
});
