// Tests for the Google Apps Script bridge (google-apps-script/Code.gs). The
// script is loaded into a sandbox with stand-ins for Google's services, so its
// own logic - the shared secret, how events are created / updated / deleted, what
// the email action accepts - is exercised without a Google account.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8");

// Objects made inside the sandbox have another realm's prototypes, which strict
// deep-equal rejects; copy through JSON so the tests compare plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeCalendar() {
  const events = [];
  const calls = [];
  const find = (id) => events.find((e) => e.id === id);
  return {
    events,
    calls,
    Calendars: { get: (id) => ({ id, summary: "NAIST Jumat", timeZone: "Asia/Tokyo" }) },
    Events: {
      insert(resource, calendarId, options) {
        calls.push(plain(["insert", resource, calendarId, options]));
        if (find(resource.id)) throw new Error("API call to calendar.events.insert failed with error: The requested identifier already exists.");
        const event = { ...plain(resource) };
        events.push(event);
        return event;
      },
      patch(resource, calendarId, eventId, options) {
        calls.push(plain(["patch", resource, calendarId, eventId, options]));
        const event = find(eventId);
        if (!event) throw new Error("API call to calendar.events.patch failed with error: Not Found");
        Object.assign(event, plain(resource));
        return event;
      },
      remove(calendarId, eventId, options) {
        calls.push(plain(["remove", calendarId, eventId, options]));
        const event = find(eventId);
        if (!event) throw new Error("API call to calendar.events.remove failed with error: Not Found");
        events.splice(events.indexOf(event), 1);
      },
    },
  };
}

function load({ props = { SECRET: "s3cret", CALENDAR_ID: "cal@group.calendar.google.com" }, calendar = fakeCalendar() } = {}) {
  const sent = [];
  const locks = [];
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => (key in props ? props[key] : null) }) },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (text) => ({ text, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    MailApp: { sendEmail: (message) => sent.push(plain(message)), getRemainingDailyQuota: () => 97 },
    LockService: { getScriptLock: () => ({ waitLock: () => locks.push("wait"), releaseLock: () => locks.push("release") }) },
    Calendar: calendar,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const post = (payload, { raw } = {}) => {
    const out = sandbox.doPost({ postData: { contents: raw ?? JSON.stringify(payload) } });
    assert.equal(out.mime, "JSON");
    return JSON.parse(out.text);
  };
  return { post, calendar, sent, sandbox, locks };
}

const event = (over = {}) => ({
  secret: "s3cret", action: "upsert", friday_id: 7,
  title: "Jumat prayer - Khatib: Ahmad, Imam: Chris", description: "Assalamualaikum...", location: "Assembly Room - SENTAN",
  start: "2026-10-16T12:35:00+09:00", end: "2026-10-16T13:05:00+09:00", guests: ["a@naist.ac.jp"], ...over,
});

test("bridge: a plain GET answers harmlessly", () => {
  const { sandbox } = load();
  assert.equal(JSON.parse(sandbox.doGet().text).ok, true);
});

test("bridge: bad JSON, a wrong secret, a missing secret and an unconfigured script are all refused", () => {
  const { post, calendar } = load();
  assert.deepEqual(post(null, { raw: "not json" }), { ok: false, error: "bad request" });
  assert.deepEqual(post({ action: "ping", secret: "wrong" }), { ok: false, error: "unauthorized" });
  assert.deepEqual(post({ action: "ping" }), { ok: false, error: "unauthorized" });
  assert.equal(calendar.calls.length, 0, "nothing is touched without the secret");
  const noSecret = load({ props: { CALENDAR_ID: "x" } });
  assert.deepEqual(noSecret.post({ action: "ping" }), { ok: false, error: "unauthorized" }); // undefined === undefined must not pass
});

test("bridge: ping names the calendar and the mail quota left", () => {
  const { post } = load();
  assert.deepEqual(post({ secret: "s3cret", action: "ping" }), {
    ok: true, calendar_id: "cal@group.calendar.google.com", calendar_name: "NAIST Jumat", time_zone: "Asia/Tokyo", mail_quota_left: 97,
  });
});

test("bridge: a missing CALENDAR_ID is reported clearly", () => {
  const { post } = load({ props: { SECRET: "s3cret" } });
  assert.match(post({ secret: "s3cret", action: "ping" }).error, /CALENDAR_ID is not set/);
});

test("bridge: upsert tries to update first, then creates the event with an id made from the Friday, inviting by default", () => {
  const { post, calendar } = load();
  const out = post(event());
  assert.deepEqual(out, { ok: true, created: true, event_id: "jumat7" });
  assert.deepEqual(calendar.calls.map((c) => c[0]), ["patch", "insert"], "patch first (it does not exist yet), then insert");
  const [, resource, calendarId, options] = calendar.calls[1];
  assert.equal(calendarId, "cal@group.calendar.google.com");
  assert.deepEqual(options, { sendUpdates: "all" });
  assert.equal(resource.id, "jumat7");
  assert.match(resource.id, /^[a-v0-9]{5,}$/, "a valid Google event id");
  assert.equal(resource.summary, "Jumat prayer - Khatib: Ahmad, Imam: Chris");
  assert.equal(resource.location, "Assembly Room - SENTAN");
  assert.deepEqual(resource.start, { dateTime: "2026-10-16T12:35:00+09:00", timeZone: "Asia/Tokyo" });
  assert.deepEqual(resource.end, { dateTime: "2026-10-16T13:05:00+09:00", timeZone: "Asia/Tokyo" });
  assert.deepEqual(resource.attendees, [{ email: "a@naist.ac.jp" }]);
  assert.deepEqual(resource.extendedProperties, { private: { jumatFriday: "7" } });
});

test("bridge: the guest list is hidden from other guests (the calendar is public)", () => {
  const { post, calendar } = load();
  post(event());
  const resource = calendar.calls.find((c) => c[0] === "insert")[1];
  assert.equal(resource.guestsCanSeeOtherGuests, false);
  assert.equal(resource.guestsCanInviteOthers, false);
  assert.equal(resource.guestsCanModify, false);
});

test("bridge: upserting the same Friday again updates that event rather than adding another", () => {
  const { post, calendar } = load();
  post(event());
  const out = post(event({ title: "changed", guests: [], send_updates: "none" }));
  assert.deepEqual(out, { ok: true, created: false, event_id: "jumat7" });
  assert.equal(calendar.events.length, 1);
  const patch = calendar.calls.filter((c) => c[0] === "patch").pop();
  assert.equal(patch[3], "jumat7");
  assert.deepEqual(patch[4], { sendUpdates: "none" });
  assert.equal(patch[1].summary, "changed");
  assert.deepEqual(patch[1].attendees, [], "an empty guest list removes the guests");
  post(event({ friday_id: 8 }));
  assert.equal(calendar.events.length, 2, "a different Friday is a different event");
});

test("bridge: every update asks for status 'confirmed' (which is how a cancelled event is restored)", () => {
  const { post, calendar } = load();
  post(event());
  assert.equal(calendar.events[0].status, "confirmed");
  calendar.events[0].status = "cancelled";
  post(event({ title: "again" }));
  assert.equal(calendar.events[0].status, "confirmed");
  assert.equal(calendar.events.length, 1);
});

test("bridge: two updates arriving together can never produce two events (the insert loses, then updates)", () => {
  const calendar = fakeCalendar();
  const realInsert = calendar.Events.insert;
  // The patch says "not found", but by the time we insert, a concurrent request has created it.
  calendar.Events.insert = (resource, calendarId, options) => {
    calendar.events.push({ ...plain(resource), summary: "created by the other request" });
    return realInsert(resource, calendarId, options);
  };
  const { post } = load({ calendar });
  const out = post(event({ title: "mine" }));
  assert.deepEqual(out, { ok: true, created: false, event_id: "jumat7" });
  assert.equal(calendar.events.length, 1);
  assert.equal(calendar.events[0].summary, "mine");
});

test("bridge: updates run one at a time (the lock is taken and always released, even on an error)", () => {
  const ok = load();
  ok.post(event());
  assert.deepEqual(ok.locks, ["wait", "release"]);
  const calendar = fakeCalendar();
  calendar.Events.patch = () => { throw new Error("Forbidden"); };
  const failing = load({ calendar });
  assert.deepEqual(failing.post(event()), { ok: false, error: "Forbidden" });
  assert.deepEqual(failing.locks, ["wait", "release"]);
});

test("bridge: anything but 'none' for send_updates means 'all'; an empty venue clears the location", () => {
  const { post, calendar } = load();
  post(event({ send_updates: "whatever", location: "" }));
  const insert = calendar.calls.find((c) => c[0] === "insert");
  assert.deepEqual(insert[3], { sendUpdates: "all" });
  assert.equal(insert[1].location, "");
});

test("bridge: delete removes the event (and tells its guests), and is harmless when there is none", () => {
  const { post, calendar } = load();
  post(event());
  assert.deepEqual(post({ secret: "s3cret", action: "delete", friday_id: 7 }), { ok: true, deleted: true });
  assert.deepEqual(calendar.calls.find((c) => c[0] === "remove").slice(1), ["cal@group.calendar.google.com", "jumat7", { sendUpdates: "all" }]);
  assert.deepEqual(post({ secret: "s3cret", action: "delete", friday_id: 7 }), { ok: true, deleted: false });
});

test("bridge: the event id only ever contains digits from the friday id", () => {
  const { post, calendar } = load();
  post(event({ friday_id: "12; DROP TABLE" }));
  assert.equal(calendar.events[0].id, "jumat12");
});

test("bridge: mail sends one plain email from the account", () => {
  const { post, sent } = load();
  assert.deepEqual(post({ secret: "s3cret", action: "mail", to: "admin@example.org", subject: "Jumat alert", body: "Hello" }), { ok: true });
  assert.deepEqual(sent, [{ to: "admin@example.org", subject: "Jumat alert", body: "Hello", name: "NAIST Jumat Scheduler" }]);
});

test("bridge: mail refuses anything that is not exactly one address, or has no subject / body", () => {
  const { post, sent } = load();
  for (const to of ["", "nope", "a@b", "a@b.co,c@d.co", "a@b.co;c@d.co", "a b@c.co", "<a@b.co>", "a@b.co\nBcc: x@y.co", undefined]) {
    assert.match(post({ secret: "s3cret", action: "mail", to, subject: "s", body: "b" }).error, /invalid recipient/, JSON.stringify(to));
  }
  assert.match(post({ secret: "s3cret", action: "mail", to: "a@b.co", subject: "", body: "b" }).error, /required/);
  assert.match(post({ secret: "s3cret", action: "mail", to: "a@b.co", subject: "s", body: "" }).error, /required/);
  assert.equal(sent.length, 0);
});

test("bridge: mail flattens line breaks in the subject and caps the length", () => {
  const { post, sent } = load();
  post({ secret: "s3cret", action: "mail", to: "a@b.co", subject: "line one\r\nBcc: evil@x.co", body: "x".repeat(20000) });
  assert.ok(!/[\r\n]/.test(sent[0].subject));
  assert.equal(sent[0].body.length, 8000);
});

test("bridge: an unknown action, and an error from Google, come back as { ok: false, error }", () => {
  const calendar = fakeCalendar();
  calendar.Events.insert = () => { throw new Error("Invalid attendee email."); };
  const { post } = load({ calendar });
  assert.deepEqual(post({ secret: "s3cret", action: "explode" }), { ok: false, error: "unknown action" });
  assert.deepEqual(post(event()), { ok: false, error: "Invalid attendee email." });
});
