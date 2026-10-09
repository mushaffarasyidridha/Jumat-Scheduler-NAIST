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

  // Same fixed start time the announcement generator prints (app.js).
  const PRAYER_TIME = "12.35 pm (start)";
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Which Friday column holds which role, and how a reminder names it.
  const ROLE_SLOTS = [
    { field: "primary_khatib_id", label: "Primary khatib" },
    { field: "secondary_khatib_id", label: "Secondary khatib (standby)" },
    { field: "imam_id", label: "Imam" },
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

  // Short, plain-text reminder for a chat app (WhatsApp, LINE, Facebook...).
  // `roles` are ROLE_SLOTS labels, `days` is how many days away the Friday is.
  function chatText({ friday, person, roles, days }) {
    const standby = standbyNote(roles);
    return [
      "🕌 Jumat reminder",
      `Assalamu'alaikum ${person.name}, you are scheduled as ${roles.join(" + ")}:`,
      `📅 ${formatDateLong(friday.date)} (${whenPhrase(days)})`,
      `🕛 ${PRAYER_TIME}`,
      `📍 ${venueOf(friday)}`,
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
    chatText,
    whatsappLink,
  };
});
