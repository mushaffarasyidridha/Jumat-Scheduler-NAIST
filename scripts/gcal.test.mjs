// The Google Calendar sync logic (functions/api/_gcal.mjs): what each Friday's
// event should be, what is sent when something changes, and how failures are
// handled - against a fake bridge and a fake database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteUrlFrom, DEFAULT_SITE_URL } from "../functions/api/_site.mjs";
import { SQL, BridgeError, createBridge, guestsFor, gatheringGuests, desiredGathering, inviteAddress, parseInviteOnly, desiredEvent, planSync, sha256Hex, syncUpcoming, emailAlertViaBridge } from "../functions/api/_gcal.mjs";

const SITE = "https://x.test";
const TODAY = "2026-10-09";

const person = (over = {}) => ({ id: 1, name: "Ahmad", status: "active", reminders: 1, calendar_email: "Ahmad@NAIST.ac.jp", ...over });
const friday = (over = {}) => ({
  id: 10, date: "2026-10-16", venue: "Assembly Room - SENTAN", info: null,
  primary_khatib_id: 1, primary_name: "Ahmad", secondary_khatib_id: null, secondary_name: null, imam_id: null, imam_name: null, ...over,
});
const byId = (...people) => new Map(people.map((p) => [p.id, p]));

// ---------- what an event should be ----------

test("guests: scheduled, active people with a calendar account and reminders on; lowercased, unique, sorted", () => {
  const f = friday({ imam_id: 2, primary_khatib_id: 1, secondary_khatib_id: 3 });
  const people = byId(
    person({ calendar_email: "Zed@naist.ac.jp" }),
    person({ id: 2, calendar_email: "a@naist.ac.jp" }),
    person({ id: 3, calendar_email: "zed@NAIST.ac.jp" }) // same address as person 1 (and only the secondary khatib: not invited)
  );
  assert.deepEqual(guestsFor(f, people), ["a@naist.ac.jp", "zed@naist.ac.jp"]);
  assert.deepEqual(guestsFor(friday({ primary_khatib_id: null, secondary_khatib_id: 3 }), people), [], "a secondary khatib alone is not invited");
});

test("guests: the Email is the invitation address; a separate Google Calendar address wins when saved", () => {
  const f = friday({ primary_khatib_id: 1, imam_id: 2, secondary_khatib_id: 3 });
  const people = byId(
    person({ calendar_email: null, email: "Ahmad@Is.NAIST.jp" }),
    person({ id: 2, calendar_email: "bilal@g.ext.naist.jp", email: "bilal@naist.ac.jp" }),
    person({ id: 3, calendar_email: "sec@naist.ac.jp" }) // the secondary khatib: never invited
  );
  assert.deepEqual(guestsFor(f, people), ["ahmad@is.naist.jp", "bilal@g.ext.naist.jp"]);
  assert.deepEqual(guestsFor(f, people, ["ahmad@is.naist.jp"]), ["ahmad@is.naist.jp"], "test mode matches the email too");
  assert.equal(inviteAddress({ email: " X@Y.org " }), "x@y.org");
  assert.equal(inviteAddress({}), "");
});

test("guests: nobody who is inactive, opted out, has no account, or is not scheduled; guests typed as free text have no account", () => {
  const f = friday({ secondary_khatib_id: 2, imam_id: 3, primary_khatib_id: 1 }); // 2 is the secondary: also never invited
  assert.deepEqual(guestsFor(f, byId(person({ status: "inactive" }), person({ id: 2, reminders: 0 }), person({ id: 3, calendar_email: null }))), []);
  assert.deepEqual(guestsFor(friday({ primary_khatib_id: null, primary_name: "Guest Speaker" }), byId(person())), []);
  assert.deepEqual(guestsFor(friday({ primary_khatib_id: 9 }), byId(person())), [], "a person who is not on this Friday");
});

test("event: 12.35 to 13.05 JST with the offset spelled out, the broadcast as description, venue as location", () => {
  const e = desiredEvent({ friday: friday({ imam_name: "Chris" }), peopleById: byId(person()), siteUrl: SITE });
  assert.equal(e.friday_id, 10);
  assert.equal(e.start, "2026-10-16T12:35:00+09:00");
  assert.equal(e.end, "2026-10-16T13:05:00+09:00");
  assert.equal(e.title, "Jumat prayer - Khatib: Ahmad, Imam: Chris");
  assert.equal(e.location, "Assembly Room - SENTAN");
  assert.match(e.description, /^Assalamualaikum Warrahmatullah Wabarakatuh,/);
  assert.match(e.description, /Time: 12\.35 pm \(start\)/);
  assert.match(e.description, /Can't make it\? .*https:\/\/x\.test\/\?friday=10$/);
  assert.deepEqual(e.guests, ["ahmad@naist.ac.jp"]);
  assert.equal(desiredEvent({ friday: friday({ venue: "  " }), peopleById: byId(), siteUrl: SITE }).location, "");
});

// ---------- what to send ----------

test("plan: nothing when Google already has this; the first time, and any change of guests / time / place, notify guests", async () => {
  const base = desiredEvent({ friday: friday(), peopleById: byId(person()), siteUrl: SITE });
  const hash = await sha256Hex(JSON.stringify(base));
  assert.deepEqual(planSync(hash, base, { hash, snapshot: base }), { action: "none" });
  assert.deepEqual(planSync(hash, base, undefined), { action: "upsert", sendUpdates: "all" });
  const prev = { hash: "old", snapshot: base };
  assert.deepEqual(planSync("new", { ...base, guests: [] }, prev), { action: "upsert", sendUpdates: "all" });
  assert.deepEqual(planSync("new", { ...base, location: "Lounge" }, prev), { action: "upsert", sendUpdates: "all" });
  assert.deepEqual(planSync("new", { ...base, start: "2026-10-16T12:40:00+09:00" }, prev), { action: "upsert", sendUpdates: "all" });
});

test("plan: a change of wording only (a different khatib in the title and text) is made quietly", () => {
  const base = desiredEvent({ friday: friday(), peopleById: byId(person()), siteUrl: SITE });
  const reworded = { ...base, title: "other", description: "other" };
  assert.deepEqual(planSync("new", reworded, { hash: "old", snapshot: base }), { action: "upsert", sendUpdates: "none" });
  assert.deepEqual(planSync("new", reworded, { hash: "old", snapshot: null }), { action: "upsert", sendUpdates: "all" }, "unreadable history => notify");
});

// ---------- the bridge client ----------

const reply = (data, { status = 200, text } = {}) => ({ status, text: async () => text ?? JSON.stringify(data) });

test("bridge client: posts the secret and action as text, follows redirects, returns the answer", async () => {
  let seen;
  const bridge = createBridge({ url: "https://script.example/exec", secret: "s3cret", fetchImpl: async (url, init) => { seen = { url, init }; return reply({ ok: true, calendar_name: "N" }); } });
  assert.deepEqual(await bridge.ping(), { ok: true, calendar_name: "N" });
  assert.equal(seen.url, "https://script.example/exec");
  assert.equal(seen.init.method, "POST");
  assert.match(seen.init.headers["content-type"], /^text\/plain/);
  assert.equal(seen.init.redirect, "follow");
  assert.deepEqual(JSON.parse(seen.init.body), { secret: "s3cret", action: "ping" });
  await bridge.upsertEvent({ friday_id: 3, title: "t" });
  assert.deepEqual(JSON.parse(seen.init.body), { secret: "s3cret", action: "upsert", friday_id: 3, title: "t" });
  await bridge.sendMail({ to: "a@b.co", subject: "s", body: "b" });
  assert.deepEqual(JSON.parse(seen.init.body), { secret: "s3cret", action: "mail", to: "a@b.co", subject: "s", body: "b" });
  await bridge.deleteEvent(3);
  assert.deepEqual(JSON.parse(seen.init.body), { secret: "s3cret", action: "delete", friday_id: 3 });
});

test("bridge client: errors are clear, flag a wrong secret, and never contain the address or the secret", async () => {
  const mk = (fetchImpl) => createBridge({ url: "https://script.example/exec?private=abc", secret: "s3cret", fetchImpl });
  await assert.rejects(mk(async () => reply({ ok: false, error: "unauthorized" })).ping(), (e) => e instanceof BridgeError && e.unauthorized === true && e.message === "unauthorized");
  await assert.rejects(mk(async () => reply({ ok: false, error: "Invalid attendee email." })).ping(), (e) => e.unauthorized === false && e.message === "Invalid attendee email.");
  await assert.rejects(mk(async () => reply(null, { status: 200, text: "<html>Sign in</html>" })).ping(), /did not answer with JSON \(HTTP 200\).*“Anyone”/);
  await assert.rejects(mk(async () => { throw new TypeError("fetch failed for https://script.example/exec?private=abc"); }).ping(), (e) => e.message === "could not reach the Google bridge" && !/script\.example|abc|s3cret/.test(e.message));
  await assert.rejects(mk(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }).ping(), /did not answer in time/);
  await assert.rejects(mk(async () => reply({ ok: false, error: "x".repeat(1000) })).ping(), (e) => e.message.length === 300);
});

// ---------- the whole sync ----------

function fakeDb({ fridays = [], people = [], snapshots = [], inviteOnly = null, places = [], gatherings = [], ramadan = { kultum_minutes: 7, event_minutes: 90 } } = {}) {
  const runs = [];
  return {
    runs,
    snapshots,
    async all(sql, params) {
      if (sql === SQL.fridays) return fridays.filter((f) => f.date >= params[0]);
      if (sql === SQL.people) return people;
      if (sql === SQL.snapshots) return snapshots;
      if (sql === SQL.places) return places;
      if (sql === SQL.gatherings) return gatherings;
      if (sql === SQL.ramadan) return [ramadan];
      if (sql === SQL.state) return [{ invite_only: inviteOnly }];
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async run(sql, params) {
      runs.push({ sql, params });
      if (sql === SQL.deleteSnapshot) {
        const i = snapshots.findIndex((x) => x.friday_id === params[0]);
        if (i >= 0) snapshots.splice(i, 1);
      }
      if (sql === SQL.saveSnapshot) {
        const [id, hash, snapshot] = params;
        const row = snapshots.find((s) => s.friday_id === id);
        if (row) Object.assign(row, { hash, snapshot });
        else snapshots.push({ friday_id: id, hash, snapshot });
      }
      return { changes: 1 };
    },
  };
}

function fakeBridge({ failOn = () => false, pingFails = null } = {}) {
  const calls = [];
  return {
    calls,
    async ping() {
      calls.push({ action: "ping" });
      if (pingFails) throw pingFails;
      return { ok: true, calendar_id: "cal@group.calendar.google.com", calendar_name: "NAIST Jumat", mail_quota_left: 90 };
    },
    async upsertEvent(event) {
      calls.push({ action: "upsert", event });
      const failure = failOn(event);
      if (failure) throw failure;
      return { ok: true };
    },
    async deleteEvent(id) {
      calls.push({ action: "delete", id });
      return { ok: true };
    },
  };
}

const three = () => [friday({ id: 10, date: "2026-10-09" }), friday({ id: 11, date: "2026-10-16" }), friday({ id: 12, date: "2026-10-23" })];
const run = (args) => syncUpcoming({ siteUrl: SITE, today: TODAY, ...args });

test("sync: the first run sends every upcoming Friday and records them; the second sends nothing, not even a ping", async () => {
  const db = fakeDb({ fridays: three(), people: [person()] });
  const bridge = fakeBridge();
  const first = await run({ bridge, db });
  assert.deepEqual([first.total, first.synced, first.unchanged, first.failed], [3, 3, 0, 0]);
  assert.deepEqual(bridge.calls.map((c) => c.action), ["ping", "upsert", "upsert", "upsert"]);
  assert.ok(bridge.calls.filter((c) => c.event).every((c) => c.event.send_updates === "all"));
  assert.equal(db.snapshots.length, 3);
  assert.deepEqual(first.calendar, { name: "NAIST Jumat", mail_quota_left: 90 });
  const ok = db.runs.find((r) => r.sql === SQL.stateOk);
  assert.deepEqual(ok.params, ["cal@group.calendar.google.com"], "remembers which calendar this is");

  bridge.calls.length = 0;
  const second = await run({ bridge, db });
  assert.deepEqual([second.synced, second.unchanged], [0, 3]);
  assert.deepEqual(bridge.calls, [], "nothing changed: Google is not contacted");
});

test("sync: past Fridays are not touched", async () => {
  const db = fakeDb({ fridays: [friday({ id: 9, date: "2026-10-02" }), friday({ id: 10, date: "2026-10-09" })], people: [] });
  const bridge = fakeBridge();
  await run({ bridge, db });
  assert.deepEqual(bridge.calls.filter((c) => c.event).map((c) => c.event.friday_id), [10]);
});

test("sync: scheduling someone with a calendar account invites them, and only that Friday is sent", async () => {
  const open = (f) => ({ ...f, primary_khatib_id: null, primary_name: null });
  const fridays = three().map(open);
  const db = fakeDb({ fridays, people: [person()] });
  const bridge = fakeBridge();
  await run({ bridge, db });
  assert.ok(bridge.calls.filter((c) => c.event).every((c) => c.event.guests.length === 0), "nobody scheduled: nobody invited");
  bridge.calls.length = 0;

  Object.assign(fridays[1], { primary_khatib_id: 1, primary_name: "Ahmad" });
  const result = await run({ bridge, db });
  const sent = bridge.calls.filter((c) => c.event);
  assert.equal(result.synced, 1);
  assert.deepEqual(sent.map((c) => c.event.friday_id), [11]);
  assert.deepEqual(sent[0].event.guests, ["ahmad@naist.ac.jp"]);
  assert.equal(sent[0].event.send_updates, "all", "the invitation goes out");
});

test("sync: a new guest is sent with notification; a re-wording only is sent quietly", async () => {
  const fridays = [friday({ id: 10, date: "2026-10-16", primary_khatib_id: null, primary_name: null })];
  const people = [person()];
  const db = fakeDb({ fridays, people });
  const bridge = fakeBridge();
  await run({ bridge, db });
  bridge.calls.length = 0;

  fridays[0].primary_khatib_id = 1; fridays[0].primary_name = "Ahmad"; // Ahmad scheduled: becomes a guest
  await run({ bridge, db });
  let upsert = bridge.calls.find((c) => c.event).event;
  assert.deepEqual(upsert.guests, ["ahmad@naist.ac.jp"]);
  assert.equal(upsert.send_updates, "all");
  assert.equal(bridge.calls[0].action, "ping", "a change is preceded by one ping");

  bridge.calls.length = 0;
  people[0].name = "Ahmad B"; fridays[0].primary_name = "Ahmad B"; // only the wording changes
  await run({ bridge, db });
  upsert = bridge.calls.find((c) => c.event).event;
  assert.equal(upsert.send_updates, "none");
  assert.match(upsert.title, /Ahmad B/);

  bridge.calls.length = 0;
  people[0].calendar_email = null; // account removed: the guest is dropped, with notification
  await run({ bridge, db });
  upsert = bridge.calls.find((c) => c.event).event;
  assert.deepEqual(upsert.guests, []);
  assert.equal(upsert.send_updates, "all");
});

test("sync: forcePing contacts the bridge even when nothing changed; dryRun contacts nobody and saves nothing", async () => {
  const db = fakeDb({ fridays: three(), people: [] });
  const bridge = fakeBridge();
  await run({ bridge, db });
  bridge.calls.length = 0;
  const forced = await run({ bridge, db, forcePing: true });
  assert.deepEqual(bridge.calls.map((c) => c.action), ["ping"]);
  assert.equal(forced.calendar.name, "NAIST Jumat");

  const fresh = fakeDb({ fridays: three(), people: [] });
  const quiet = fakeBridge();
  const dry = await run({ bridge: quiet, db: fresh, dryRun: true });
  assert.equal(dry.wouldSync, 3);
  assert.deepEqual(quiet.calls, []);
  assert.deepEqual(fresh.runs, []);
});

test("sync: one Friday failing does not stop the others, is not recorded as done, and is reported", async () => {
  const db = fakeDb({ fridays: three(), people: [] });
  const bridge = fakeBridge({ failOn: (e) => (e.friday_id === 11 ? new BridgeError("Invalid attendee email.") : null) });
  const result = await run({ bridge, db });
  assert.deepEqual([result.synced, result.failed], [2, 1]);
  assert.deepEqual(result.errors, [{ date: "2026-10-16", message: "Invalid attendee email." }]);
  assert.deepEqual(db.snapshots.map((s) => s.friday_id).sort(), [10, 12]);
  const error = db.runs.find((r) => r.sql === SQL.stateError);
  assert.deepEqual(error.params, ["Invalid attendee email."]);
  assert.ok(!db.runs.some((r) => r.sql === SQL.stateOk));

  bridge.calls.length = 0;
  const retry = await run({ bridge: fakeBridge(), db });
  assert.deepEqual([retry.synced, retry.unchanged], [1, 2], "the next run retries only the one that failed");
});

test("sync: a wrong secret stops at once; a failing ping touches no event", async () => {
  const db = fakeDb({ fridays: three(), people: [] });
  const wrong = fakeBridge({ failOn: () => new BridgeError("unauthorized", { unauthorized: true }) });
  const r1 = await run({ bridge: wrong, db });
  assert.equal(wrong.calls.filter((c) => c.event).length, 1, "stops after the first refusal");
  assert.equal(r1.failed, 1);

  const down = fakeBridge({ pingFails: new BridgeError("could not reach the Google bridge") });
  const r2 = await run({ bridge: down, db: fakeDb({ fridays: three(), people: [] }) });
  assert.deepEqual(down.calls.map((c) => c.action), ["ping"]);
  assert.deepEqual([r2.synced, r2.failed], [0, 1]);
});

test("sync: at most maxCalls events per run; the rest wait for the next one", async () => {
  const db = fakeDb({ fridays: three(), people: [] });
  const bridge = fakeBridge();
  const first = await run({ bridge, db, maxCalls: 2 });
  assert.deepEqual([first.synced, first.deferred], [2, 1]);
  const second = await run({ bridge, db, maxCalls: 2 });
  assert.deepEqual([second.synced, second.unchanged, second.deferred], [1, 2, 0]);
});

// ---------- the instant alert email ----------

function alertDb({ row, admins, claim = 1 }) {
  const runs = [];
  return {
    runs,
    async all(sql) {
      if (sql.includes("FROM availability_alerts a")) return row ? [row] : [];
      if (sql.includes("FROM people WHERE is_admin = 1")) return admins;
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async run(sql, params) {
      runs.push({ sql, params });
      return { changes: sql.includes("SET emailed_at = datetime('now')") ? claim : 1 };
    },
  };
}
const alertRow = { alert_id: 5, roles: "Primary khatib", person_name: "Ahmad", id: 10, date: "2026-10-16", venue: null, primary_name: "Ahmad", secondary_name: null, imam_name: null };
const adminRow = (over = {}) => ({ id: 9, name: "Aisha", status: "active", is_admin: 1, email: "aisha@example.org", reminders: 1, reminder_token: "a".repeat(32), ...over });
const mailer = (fail = () => false) => {
  const sent = [];
  return { sent, async sendMail(m) { if (fail(m)) throw new BridgeError("nope"); sent.push(m); } };
};
const releasedOrClaimed = (db) => db.runs.map((r) => (r.sql.includes("SET emailed_at = NULL") ? "released" : r.sql.includes("SET emailed_at = datetime") ? "claimed" : "other"));

test("alert email: claims the alert, emails every eligible admin through the bridge, keeps the claim", async () => {
  const db = alertDb({ row: alertRow, admins: [adminRow(), adminRow({ id: 10, email: "b@example.org" }), adminRow({ id: 11, reminders: 0 }), adminRow({ id: 12, status: "inactive" }), adminRow({ id: 13, email: null })] });
  const bridge = mailer();
  assert.equal(await emailAlertViaBridge({ bridge, db, alertId: 5, siteUrl: SITE, today: TODAY }), true);
  assert.deepEqual(bridge.sent.map((m) => m.to), ["aisha@example.org", "b@example.org"]);
  assert.match(bridge.sent[0].subject, /Jumat alert: Ahmad can't make it on 16 October 2026/);
  assert.match(bridge.sent[0].body, /Primary khatib/);
  assert.deepEqual(releasedOrClaimed(db), ["claimed"]);
});

test("alert email: not sent twice (already claimed), and released when nobody can be reached", async () => {
  const taken = alertDb({ row: alertRow, admins: [adminRow()], claim: 0 });
  const b1 = mailer();
  assert.equal(await emailAlertViaBridge({ bridge: b1, db: taken, alertId: 5, siteUrl: SITE, today: TODAY }), false);
  assert.equal(b1.sent.length, 0);

  const noAdmin = alertDb({ row: alertRow, admins: [adminRow({ email: null })] });
  assert.equal(await emailAlertViaBridge({ bridge: mailer(), db: noAdmin, alertId: 5, siteUrl: SITE, today: TODAY }), false);
  assert.deepEqual(releasedOrClaimed(noAdmin), ["claimed", "released"], "the job can still send it");

  const failing = alertDb({ row: alertRow, admins: [adminRow(), adminRow({ id: 10, email: "b@example.org" })] });
  const b2 = mailer((m) => m.to === "aisha@example.org");
  assert.equal(await emailAlertViaBridge({ bridge: b2, db: failing, alertId: 5, siteUrl: SITE, today: TODAY }), true, "one admin reached is enough");
  assert.deepEqual(releasedOrClaimed(failing), ["claimed"]);

  const allFail = alertDb({ row: alertRow, admins: [adminRow()] });
  assert.equal(await emailAlertViaBridge({ bridge: mailer(() => true), db: allFail, alertId: 5, siteUrl: SITE, today: TODAY }), false);
  assert.deepEqual(releasedOrClaimed(allFail), ["claimed", "released"]);

  const gone = alertDb({ row: null, admins: [adminRow()] });
  assert.equal(await emailAlertViaBridge({ bridge: mailer(), db: gone, alertId: 5, siteUrl: SITE, today: TODAY }), false);
  assert.deepEqual(releasedOrClaimed(gone), ["claimed", "released"]);
});

test("site address: one canonical address for links, with an optional override and no trailing slash", () => {
  assert.equal(DEFAULT_SITE_URL, "https://jumat-scheduler-naist.pages.dev");
  assert.equal(siteUrlFrom({}), DEFAULT_SITE_URL);
  assert.equal(siteUrlFrom({ SITE_URL: "" }), DEFAULT_SITE_URL, "an empty variable means 'not set'");
  assert.equal(siteUrlFrom({ SITE_URL: "https://jumat.example.org//" }), "https://jumat.example.org");
});

// ---------- invitation test mode ----------

test("test mode: the saved text keeps only real addresses, lower-cased, once each", () => {
  assert.deepEqual(parseInviteOnly("Me@NAIST.ac.jp, me@naist.ac.jp; other@x.org  junk, @bad, a@b"), ["me@naist.ac.jp", "other@x.org"]);
  assert.deepEqual(parseInviteOnly(null), []);
  assert.deepEqual(parseInviteOnly(""), []);
  assert.deepEqual(parseInviteOnly("not an address"), [], "a damaged value never invites anyone by accident");
});

test("test mode: only the listed addresses are invited, the others are left out", () => {
  const f = friday({ primary_khatib_id: 1, imam_id: 2 });
  const people = byId(person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, calendar_email: "other@naist.ac.jp" }));
  assert.deepEqual(guestsFor(f, people, []), ["me@naist.ac.jp", "other@naist.ac.jp"], "off: everyone");
  assert.deepEqual(guestsFor(f, people, ["me@naist.ac.jp"]), ["me@naist.ac.jp"]);
  assert.deepEqual(guestsFor(f, people, ["nobody@x.org"]), [], "a list nobody matches invites nobody");
});

test("test mode: the saved setting limits the invitations in a sync, and turning it off invites everyone again", async () => {
  const people = [person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, calendar_email: "other@naist.ac.jp" })];
  const fridays = [friday({ id: 11, date: "2026-10-16", primary_khatib_id: 1, imam_id: 2 })];

  const db = fakeDb({ fridays, people, inviteOnly: "me@naist.ac.jp" });
  const bridge = fakeBridge();
  await run({ bridge, db });
  assert.deepEqual(bridge.calls.find((c) => c.event).event.guests, ["me@naist.ac.jp"]);

  // Same line-up, test mode off: the other person is now invited (an invitation email).
  const off = fakeDb({ fridays, people, snapshots: db.snapshots });
  const bridge2 = fakeBridge();
  await run({ bridge: bridge2, db: off });
  const event = bridge2.calls.find((c) => c.event).event;
  assert.deepEqual(event.guests, ["me@naist.ac.jp", "other@naist.ac.jp"]);
  assert.equal(event.send_updates, "all", "the guest list changed: Google sends the invitation");
});

test("sync reports why nobody is invited, as counts only", async () => {
  const fridays = [friday({ id: 11, date: "2026-10-16", primary_khatib_id: 1, imam_id: 2 })];
  const people = [person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, calendar_email: "other@naist.ac.jp", reminders: 0 }), person({ id: 3, calendar_email: "x@naist.ac.jp", status: "inactive" })];

  const off = await run({ bridge: fakeBridge(), db: fakeDb({ fridays, people }), dryRun: true });
  assert.deepEqual(off.invites, { accounts: 3, eligible: 1, testMode: false, listed: 0, matched: 0, fridaysWithGuests: 1, people: 1 });

  const typo = await run({ bridge: fakeBridge(), db: fakeDb({ fridays, people, inviteOnly: "mee@naist.ac.jp" }), dryRun: true });
  assert.deepEqual(typo.invites, { accounts: 3, eligible: 1, testMode: true, listed: 1, matched: 0, fridaysWithGuests: 0, people: 0 }, "an address that matches no saved account invites nobody");

  const none = await run({ bridge: fakeBridge(), db: fakeDb({ fridays, people: [] }), dryRun: true });
  assert.equal(none.invites.accounts, 0);
  assert.ok(!JSON.stringify(off.invites).includes("@"), "no address in the report");
});

// ---------- "my name isn't listed": the admin's email ----------

import { joinRecipients, buildJoinEmail } from "../functions/api/_joinmail.mjs";
import { emailJoinViaBridge } from "../functions/api/_gcal.mjs";

const joinRequest = { id: 7, name: "Firoz Ahmed", affiliation: "naist_student", country: "Bangladesh", role: "both", email: "f@example.org", whatsapp: "+81 90 1234 5678", note: "new at NAIST", resolved_at: null };

test("join email: who asked, what they typed, what to do, how to stop", () => {
  const { subject, text } = buildJoinEmail({ request: joinRequest, admin: adminRow(), siteUrl: SITE });
  assert.equal(subject, "Jumat: Firoz Ahmed asks to be added to the roster");
  for (const part of ["Assalamu'alaikum Aisha", "Name: Firoz Ahmed", "NAIST student", "Bangladesh", "Khatib and imam", "f@example.org", "+81 90 1234 5678", "new at NAIST", "Add to roster", `${SITE}/api/reminders/unsubscribe?t=${"a".repeat(32)}`]) {
    assert.ok(text.includes(part), `missing: ${part}`);
  }
  const sparse = buildJoinEmail({ request: { id: 8, name: "Sam" }, admin: adminRow(), siteUrl: SITE }).text;
  assert.ok(!/undefined|null/.test(sparse) && !sparse.includes("Email:"), "a sparse request prints no empty lines");
});

test("join email: only active admins with an email and reminders on", () => {
  const people = [adminRow(), adminRow({ id: 10, email: null }), adminRow({ id: 11, status: "inactive" }), adminRow({ id: 12, reminders: 0 }), { id: 13, status: "active", is_admin: 0, email: "x@y.org", reminders: 1 }];
  assert.deepEqual(joinRecipients(people).map((p) => p.id), [9]);
});

function joinDb({ request = joinRequest, admins = [adminRow()], claim = 1 } = {}) {
  const runs = [];
  return {
    runs,
    async all(sql) {
      if (sql.includes("FROM join_requests")) return request ? [request] : [];
      if (sql.includes("FROM people WHERE is_admin = 1")) return admins;
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async run(sql, params) {
      runs.push({ sql, params });
      return { changes: sql.includes("SET emailed_at = datetime('now')") ? claim : 1 };
    },
  };
}

test("join email via the bridge: every admin is mailed and the request is claimed", async () => {
  const sent = [];
  const bridge = { async sendMail(m) { sent.push(m); } };
  const db = joinDb({ admins: [adminRow(), adminRow({ id: 10, name: "Bilal", email: "b@example.org" })] });
  assert.equal(await emailJoinViaBridge({ bridge, db, requestId: 7, siteUrl: SITE }), true);
  assert.deepEqual(sent.map((m) => m.to), ["aisha@example.org", "b@example.org"]);
  assert.match(sent[0].subject, /Firoz Ahmed asks to be added/);
  assert.ok(!db.runs.some((r) => r.sql.includes("emailed_at = NULL")), "claim kept");
});

test("join email via the bridge: nobody to tell, or a failed send, releases the claim so the job retries; an already-claimed request is skipped", async () => {
  const none = joinDb({ admins: [] });
  assert.equal(await emailJoinViaBridge({ bridge: { async sendMail() {} }, db: none, requestId: 7, siteUrl: SITE }), false);
  assert.ok(none.runs.some((r) => r.sql.includes("emailed_at = NULL")));

  const failing = joinDb();
  assert.equal(await emailJoinViaBridge({ bridge: { async sendMail() { throw new BridgeError("nope"); } }, db: failing, requestId: 7, siteUrl: SITE }), false);
  assert.ok(failing.runs.some((r) => r.sql.includes("emailed_at = NULL")));

  const claimed = joinDb({ claim: 0 });
  assert.equal(await emailJoinViaBridge({ bridge: { async sendMail() { throw new Error("must not send"); } }, db: claimed, requestId: 7, siteUrl: SITE }), false);
});


// ---------- Ramadan days in Google Calendar and the feed ----------

import { GATHERING_ID_OFFSET } from "../functions/api/_ramadan.mjs";
import { buildCalendar, gatheringTitle, gatheringWindowUtc } from "../functions/api/_ics.mjs";

const gday = (over = {}) => ({ id: 5, date: "2026-10-12", place: "Assembly Room - SENTAN", start_time: "19:45", kultum: 1, kultum_minutes: null, speaker_id: 1, speaker: "Ahmad", reminders: 1, info: null, ...over });
const rSettings = { kultum_minutes: 7, event_minutes: 90 };

test("Ramadan event: titled with the kultum speaker, 19:45 Japan time for 90 minutes, at the place, the announcement as its text", () => {
  const e = desiredGathering({ gathering: gday(), peopleById: byId(person({ calendar_email: "me@naist.ac.jp" })), siteUrl: SITE, settings: rSettings });
  assert.equal(e.friday_id, GATHERING_ID_OFFSET + 5);
  assert.equal(e.title, "Isha + Tarawih - Kultum: Ahmad");
  assert.equal(e.start, "2026-10-12T19:45:00+09:00");
  assert.equal(e.end, "2026-10-12T21:15:00+09:00");
  assert.equal(e.location, "Assembly Room - SENTAN");
  assert.match(e.description, /Isha and Tarawih will be held in sha Allah at Assembly Room - SENTAN/);
  assert.match(e.description, /Kultum \(7 minutes\): Ahmad/);
  assert.match(e.description, /Can't make it\? Please tell the coordinator/);
  assert.deepEqual(e.guests, ["me@naist.ac.jp"]);
  assert.equal(desiredGathering({ gathering: gday({ kultum: 0 }), peopleById: byId(person()), siteUrl: SITE, settings: rSettings }).title, "Isha + Tarawih");
  const w = gatheringWindowUtc(gday(), 90);
  assert.equal(new Date(w.startMs).toISOString(), "2026-10-12T10:45:00.000Z");
});

test("Ramadan guests: only the kultum speaker, only on a kultum day, with the same rules as Fridays", () => {
  const people = byId(person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, calendar_email: "other@naist.ac.jp" }));
  assert.deepEqual(gatheringGuests(gday(), people), ["me@naist.ac.jp"]);
  assert.deepEqual(gatheringGuests(gday({ kultum: 0 }), people), [], "no kultum, nobody to invite");
  assert.deepEqual(gatheringGuests(gday({ speaker_id: null, speaker: "Prof. Arai" }), people), [], "a guest speaker has no address");
  assert.deepEqual(gatheringGuests(gday({ speaker_id: 9 }), people), []);
  assert.deepEqual(gatheringGuests(gday(), byId(person({ reminders: 0 }))), [], "reminders off: not invited");
  assert.deepEqual(gatheringGuests(gday(), people, ["other@naist.ac.jp"]), [], "test mode lists someone else");
  assert.deepEqual(gatheringGuests(gday(), people, ["me@naist.ac.jp"]), ["me@naist.ac.jp"], "test mode lists the speaker");
});

test("Ramadan sync: days are sent under offset ids next to the Fridays, then left alone; past days are not touched", async () => {
  const db = fakeDb({ fridays: three(), people: [person()], gatherings: [gday({ id: 5, date: "2026-10-12" }), gday({ id: 6, date: "2026-10-13", kultum: 0 }), gday({ id: 4, date: "2026-10-01" })], ramadan: rSettings });
  const bridge = fakeBridge();
  const first = await run({ bridge, db });
  assert.equal(first.gatherings, 2, "only the upcoming two (today is 9 Oct)");
  assert.equal(first.synced, 5, "3 Fridays + 2 Ramadan days");
  const ids = bridge.calls.filter((c) => c.event).map((c) => c.event.friday_id).sort((a, b) => a - b);
  assert.deepEqual(ids, [10, 11, 12, GATHERING_ID_OFFSET + 5, GATHERING_ID_OFFSET + 6]);
  bridge.calls.length = 0;
  const second = await run({ bridge, db });
  assert.deepEqual(bridge.calls, [], "nothing changed: Google is not contacted");
  assert.equal(second.synced, 0);
});

test("Ramadan sync: a new speaker or time updates that day (guests are notified); wording-only changes stay quiet", async () => {
  const db = fakeDb({ fridays: [], people: [person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, name: "Bilal", calendar_email: "b@naist.ac.jp" })], gatherings: [gday()], ramadan: rSettings });
  const bridge = fakeBridge();
  await run({ bridge, db });
  assert.equal(bridge.calls.find((c) => c.event).event.send_updates, "all", "first time: the speaker is invited");

  bridge.calls.length = 0;
  const gatherings = [gday({ speaker_id: 2, speaker: "Bilal" })];
  await run({ bridge, db: fakeDb({ fridays: [], people: db.__people || [person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, name: "Bilal", calendar_email: "b@naist.ac.jp" })], gatherings, snapshots: db.snapshots, ramadan: rSettings }) });
  const change = bridge.calls.find((c) => c.event).event;
  assert.deepEqual(change.guests, ["b@naist.ac.jp"]);
  assert.equal(change.send_updates, "all", "the guest list changed: invitation and cancellation");

  bridge.calls.length = 0;
  const people2 = [person({ calendar_email: "me@naist.ac.jp" }), person({ id: 2, name: "Bilal", calendar_email: "b@naist.ac.jp" })];
  await run({ bridge, db: fakeDb({ fridays: [], people: people2, gatherings: [gday({ speaker_id: 2, speaker: "Bilal", info: "bring dates" })], snapshots: db.snapshots, ramadan: rSettings }) });
  assert.equal(bridge.calls.find((c) => c.event).event.send_updates, "none", "only the note changed: quiet");
});

test("Ramadan sync: a deleted day has its event removed and forgotten; a past day is kept", async () => {
  const gone = { friday_id: GATHERING_ID_OFFSET + 9, hash: "x", snapshot: "{}" };
  const db = fakeDb({ fridays: [], people: [], gatherings: [gday({ id: 4, date: "2026-10-01" })], snapshots: [gone, { friday_id: GATHERING_ID_OFFSET + 4, hash: "y", snapshot: "{}" }], ramadan: rSettings });
  const bridge = fakeBridge();
  const result = await run({ bridge, db });
  assert.deepEqual(bridge.calls.filter((c) => c.action === "delete").map((c) => c.id), [GATHERING_ID_OFFSET + 9], "only the deleted day's event");
  assert.equal(result.removed, 1);
  assert.deepEqual(db.snapshots.map((s) => s.friday_id), [GATHERING_ID_OFFSET + 4], "its snapshot is forgotten; the past day's stays");
  const dry = await run({ bridge: fakeBridge(), db: fakeDb({ fridays: [], gatherings: [], snapshots: [gone], ramadan: rSettings }), dryRun: true });
  assert.equal(dry.wouldRemove, 1);
});

test("the calendar feed carries the Ramadan days with their own UID, time in UTC, place and text", () => {
  const text = buildCalendar({ fridays: [], gatherings: [{ ...gday(), updated_at: "2026-10-09 06:00:00" }], siteUrl: SITE, nowMs: 0, places: [{ name: "Assembly Room - SENTAN", details: "Sentan 1F", maps_url: "https://maps.app.goo.gl/x" }], settings: rSettings }).replace(/\r?\n /g, "");
  assert.match(text, /UID:jumat-gathering-5@jumat-scheduler-naist/);
  assert.match(text, /DTSTART:20261012T104500Z/);
  assert.match(text, /DTEND:20261012T121500Z/);
  assert.match(text, /SUMMARY:Isha \+ Tarawih - Kultum: Ahmad/);
  assert.match(text, /LOCATION:Assembly Room - SENTAN/);
  assert.match(text, /Place: Sentan 1F/);
  assert.equal(gatheringTitle(gday({ kultum: 0 })), "Isha + Tarawih");
});
