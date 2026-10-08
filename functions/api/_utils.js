export const ROLES = ["khatib", "imam", "both"];
export const AFFILIATIONS = ["naist_student", "naist_staff", "dependent", "outside"];

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

// Shared community passcode gate for any mutating request (POST/PATCH/DELETE).
// Reading the schedule stays public; editing it requires the code the mosque
// group shares internally. Set via `wrangler pages secret put ACCESS_CODE`.
export function checkAccess(request, env) {
  const configured = env.ACCESS_CODE;
  if (!configured) return true; // no code configured yet -> leave open
  const provided = request.headers.get("x-access-code") || "";
  return provided === configured;
}

export function requireAccess(request, env) {
  if (!checkAccess(request, env)) {
    return json({ error: "Invalid or missing access code" }, { status: 401 });
  }
  return null;
}

// Everything the API ever returns about a person. The LINE user id, link code
// and unsubscribe token are deliberately not in this list - they never leave
// the server (the reminder job reads them straight from the database).
export const PERSON_COLUMNS = `id, name, country, role, status, note, affiliation, contact,
  email, reminders, line_user_id IS NOT NULL AS line_linked`;

// Contact details and reminder settings are only for people who hold the
// access code. Dropped server-side, not just hidden in the UI.
const PRIVATE_PERSON_KEYS = ["contact", "email", "reminders", "line_linked"];

export function shapePerson(row, authorized) {
  const person = { ...row, reminders: !!row.reminders, line_linked: !!row.line_linked };
  if (!authorized) {
    for (const key of PRIVATE_PERSON_KEYS) delete person[key];
  }
  return person;
}

// Blank clears the address. Whitespace is rejected outright so a stray
// newline can never end up inside an email header.
export function parseEmail(value) {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== "string") return { error: "email must be text" };
  const email = value.trim().toLowerCase();
  if (!email) return { value: null };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address doesn't look valid" };
  }
  return { value: email };
}

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// One-time code a person sends to the LINE bot to link their account. No
// 0/1/I/O so it survives being read out or retyped.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newLinkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 256 is a multiple of 32, so the modulo adds no bias.
  return Array.from(bytes, (b) => LINK_CODE_ALPHABET[b % 32]).join("");
}

export function formatLinkCode(code) {
  return `JMT-${code.slice(0, 4)}-${code.slice(4)}`;
}

// Accepts "JMT-ABCD-2345" however it was typed (case, spaces, dashes). The JMT
// prefix is required so ordinary chat messages are never mistaken for a code.
export function parseLinkCode(text) {
  const compact = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith("JMT")) return null;
  const code = compact.slice(3);
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}

// SQLite's datetime('now') is UTC without a zone marker; make it unambiguous
// for browsers.
export function sqliteUtcToIso(value) {
  return value ? `${String(value).replace(" ", "T")}Z` : null;
}

// Next `count` Fridays on or after `from` (a Date), as ISO yyyy-mm-dd
// strings - including today itself when today is a Friday, so today's
// khatib can still be assigned or fixed up until Jumat actually happens.
export function upcomingFridays(from, count) {
  const dates = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const dayOfWeek = d.getUTCDay(); // 0=Sun .. 5=Fri
  const offset = (5 - dayOfWeek + 7) % 7;
  d.setUTCDate(d.getUTCDate() + offset);
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return dates;
}
