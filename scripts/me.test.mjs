// "My details": what a member may change about themselves, and the note to the admins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSelfEdit, changedContacts, buildSelfEditEmail, parseLeavingOn, meTarget, SELF_FIELDS } from "../functions/api/_me.mjs";

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
  assert.deepEqual(SELF_FIELDS.sort(), ["affiliation", "calendar_email", "contact", "country", "email", "leaving_on", "note", "reminders", "whatsapp"]);
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

test("the expected leaving date: blank clears it, only a real day is kept", () => {
  assert.deepEqual(parseLeavingOn(""), { value: null });
  assert.deepEqual(parseLeavingOn(null), { value: null });
  assert.deepEqual(parseLeavingOn(" 2027-03-31 "), { value: "2027-03-31" });
  for (const bad of ["2027-02-30", "31/03/2027", "2027-3-1", 20270331, "soon"]) assert.ok(parseLeavingOn(bad).error, String(bad));
  assert.deepEqual(parseSelfEdit({ leaving_on: "2027-03-31" }, deps).set, { leaving_on: "2027-03-31" });
  assert.ok(parseSelfEdit({ leaving_on: "tomorrow" }, deps).error);
  assert.deepEqual(changedContacts({ leaving_on: null }, { leaving_on: "2027-03-31" }), [{ field: "leaving_on", from: "", to: "2027-03-31" }]);
});

test("admin on a shared device: the access code plus a person id opens that person's details", async () => {
  const people = new Map([[3, "active"], [4, "inactive"]]);
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => (sql.includes("FROM people WHERE id") && people.get(args[0]) === "active" ? { id: args[0] } : null),
        }),
      }),
    },
  };
  const req = (headers) => ({ headers: new Headers(headers) });
  assert.deepEqual(await meTarget(req({ "x-access-code": "c", "x-person-id": "3" }), env, true), { id: 3, byAdmin: true });
  assert.equal(await meTarget(req({ "x-access-code": "c", "x-person-id": "4" }), env, true), null, "a person who left is not editable");
  assert.equal(await meTarget(req({ "x-access-code": "wrong", "x-person-id": "3" }), env, false), null, "a wrong code is not enough");
  assert.equal(await meTarget(req({ "x-person-id": "3" }), env, true), null, "no code header at all (an open site with no code set) opens nothing");
});
