// "My details": what a member may change about themselves, and the note to the admins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSelfEdit, changedContacts, buildSelfEditEmail, SELF_FIELDS } from "../functions/api/_me.mjs";

// Stand-ins for the parsers in functions/api/_utils.js (an ES module only the Functions load).
const parseEmail = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s.toLowerCase() } : { error: "that email address looks wrong" };
};
const parseWhatsapp = (v) => ({ value: String(v ?? "").trim() || null });
const deps = { parseEmail, parseWhatsapp, affiliations: ["naist_student", "naist_staff", "dependent", "outside"] };

test("self edit: only a member's own contact details and preferences", () => {
  for (const field of ["name", "role", "status", "is_admin", "khutbah_checklist", "line_user_id", "id"]) {
    assert.match(parseSelfEdit({ [field]: "x" }, deps).error, /only be changed by the admin/, field);
  }
  assert.deepEqual(SELF_FIELDS.sort(), ["affiliation", "calendar_email", "contact", "country", "email", "note", "reminders", "whatsapp"]);
  const ok = parseSelfEdit({ email: " A@Example.org ", whatsapp: "+81 90", country: "  Indonesia ", note: "", reminders: false, affiliation: "naist_staff" }, deps);
  assert.deepEqual(ok.set, { email: "a@example.org", whatsapp: "+81 90", country: "Indonesia", note: null, reminders: 0, affiliation: "naist_staff" });
});

test("self edit: bad values are refused", () => {
  assert.ok(parseSelfEdit({ email: "nope" }, deps).error);
  assert.ok(parseSelfEdit({ affiliation: "king" }, deps).error);
  assert.ok(parseSelfEdit({ reminders: "yes" }, deps).error);
  assert.ok(parseSelfEdit({}, deps).error);
  assert.ok(parseSelfEdit(null, deps).error);
});

test("self edit: the admins hear about changed contact details only", () => {
  const before = { name: "Ali", email: "old@x.org", whatsapp: null, calendar_email: null, contact: "fb" };
  const changes = changedContacts(before, { email: "new@x.org", whatsapp: null, country: "Japan", contact: "fb" });
  assert.deepEqual(changes, [{ field: "email", from: "old@x.org", to: "new@x.org" }]);
  assert.deepEqual(changedContacts(before, { note: "hi" }), []);
  const mail = buildSelfEditEmail({ person: before, changes, admin: { name: "Admin", reminder_token: "t" }, siteUrl: "https://s.test" });
  assert.match(mail.subject, /Ali changed their contact details/);
  assert.match(mail.text, /Email: old@x\.org -> new@x\.org/);
  assert.match(mail.text, /unsubscribe\?t=t/);
});
