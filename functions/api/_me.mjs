// "My details": a member edits their own roster entry from a device locked to their name.
// The device proves who it is with its name-lock token (see _devices.mjs); a shared
// device, or one the admin has reset, has none and so cannot edit anything.
import { hashDeviceToken } from "./_devices.mjs";

// Who a "My details" request is about: the person this device is locked to, or - when the
// admin has entered the access code on a shared device and names a person (x-person-id) -
// that active person. `accessOk` is checkAccess() from _utils.js, passed in so this file
// also loads in the Node tests. -> { id, byAdmin } or null.
export async function meTarget(request, env, accessOk) {
  const asked = Number(request.headers.get("x-person-id"));
  if (Number.isInteger(asked) && asked > 0 && request.headers.get("x-access-code") && accessOk) {
    const row = await env.DB.prepare("SELECT id FROM people WHERE id = ? AND status = 'active'").bind(asked).first();
    return row ? { id: row.id, byAdmin: true } : null;
  }
  const id = await deviceOwner(request, env);
  return id ? { id, byAdmin: false } : null;
}

// The person this device is locked to (an active one), or null.
export async function deviceOwner(request, env) {
  const token = request.headers.get("x-device-token") || "";
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT p.id FROM device_locks d JOIN people p ON p.id = d.person_id WHERE d.token_hash = ? AND p.status = 'active'",
  )
    .bind(await hashDeviceToken(token))
    .first();
  return row ? row.id : null;
}

// What a member may change about themselves. Name, role, status, the admin flag and the
// khutbah checklist tick stay with the admin.
export const SELF_FIELDS = ["email", "whatsapp", "calendar_email", "contact", "country", "affiliation", "note", "reminders", "leaving_on"];
const CONTACT_FIELDS = ["email", "whatsapp", "calendar_email", "contact", "leaving_on"];

// The expected leaving date: blank clears it, otherwise a real calendar day "2027-03-31".
export function parseLeavingOn(value) {
  if (value === null || value === undefined || value === "") return { value: null };
  const hint = "Enter the expected leaving date as a real day, e.g. 2027-03-31";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return { error: hint };
  const day = value.trim();
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return { error: hint };
  return { value: day };
}

// -> { set: {column: value}, error }. The parsers come from _utils.js (passed in, so this
// module also loads in the Node tests).
export function parseSelfEdit(body, { parseEmail, parseWhatsapp, affiliations }) {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const set = {};
  const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
  for (const key of Object.keys(body)) {
    if (!SELF_FIELDS.includes(key)) return { error: `${key} can only be changed by the admin` };
  }
  for (const key of ["email", "calendar_email"]) {
    if (body[key] === undefined) continue;
    const parsed = parseEmail(body[key]);
    if (parsed.error) return { error: parsed.error };
    set[key] = parsed.value;
  }
  if (body.whatsapp !== undefined) {
    const parsed = parseWhatsapp(body.whatsapp);
    if (parsed.error) return { error: parsed.error };
    set.whatsapp = parsed.value;
  }
  if (body.contact !== undefined) set.contact = text(body.contact, 200);
  if (body.country !== undefined) set.country = text(body.country, 60);
  if (body.note !== undefined) set.note = text(body.note, 300);
  if (body.affiliation !== undefined) {
    if (!affiliations.includes(body.affiliation)) return { error: "unknown affiliation" };
    set.affiliation = body.affiliation;
  }
  if (body.leaving_on !== undefined) {
    const parsed = parseLeavingOn(body.leaving_on);
    if (parsed.error) return { error: parsed.error };
    set.leaving_on = parsed.value;
  }
  if (body.reminders !== undefined) {
    if (typeof body.reminders !== "boolean") return { error: "reminders must be true or false" };
    set.reminders = body.reminders ? 1 : 0;
  }
  if (!Object.keys(set).length) return { error: "nothing to update" };
  return { set };
}

// Which contact details changed (old row vs new values), for the note to the admins.
export function changedContacts(before, set) {
  return CONTACT_FIELDS.filter((k) => k in set && (before[k] || null) !== (set[k] || null)).map((k) => ({
    field: k,
    from: before[k] || "",
    to: set[k] || "",
  }));
}

const LABELS = { email: "Email", whatsapp: "WhatsApp", calendar_email: "Google Calendar address", contact: "Contact", leaving_on: "Expected to leave on" };

// The email to each admin when a member changed their own contact details.
export function buildSelfEditEmail({ person, changes, admin, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${admin.reminder_token}`;
  const text = [
    `Assalamu'alaikum ${admin.name},`,
    "",
    `${person.name} changed their own details on the NAIST Muslim Community Scheduler:`,
    "",
    ...changes.map((c) => `  ${LABELS[c.field]}: ${c.from || "(empty)"} -> ${c.to || "(empty)"}`),
    "",
    "Nothing to do if this is expected. If not, Edit them in the roster.",
    siteUrl,
    "",
    "--",
    "You get this because you are marked as an admin on the roster.",
    `Stop these emails: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Scheduler: ${person.name} changed their contact details`, text };
}
