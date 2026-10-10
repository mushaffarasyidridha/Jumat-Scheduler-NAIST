// Google Calendar sync: one event per Friday, kept up to date through the Apps
// Script bridge (google-apps-script/Code.gs). Everything here is plain functions
// over small interfaces (a bridge, and a db with all()/run()), so the website's
// Functions and the reminder job share it, and it is unit-tested in Node.
import shared from "../../public/reminder-message.js";
import { eventTitle, eventDescription } from "./_ics.mjs";
import { alertRecipients, buildAlertEmail, ALERT_ROW_SELECT } from "./_alertmail.mjs";

const { ROLE_SLOTS, prayerWindowUtc } = shared;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ---------- SQL (run by whoever owns the database connection) ----------

export const SQL = {
  fridays: `
    SELECT f.id, f.date, f.venue, f.info,
           f.primary_khatib_id, COALESCE(pp.name, f.primary_khatib_name) AS primary_name,
           f.secondary_khatib_id, COALESCE(sp.name, f.secondary_khatib_name) AS secondary_name,
           f.imam_id, COALESCE(ip.name, f.imam_name) AS imam_name
    FROM fridays f
    LEFT JOIN people pp ON pp.id = f.primary_khatib_id
    LEFT JOIN people sp ON sp.id = f.secondary_khatib_id
    LEFT JOIN people ip ON ip.id = f.imam_id
    WHERE f.is_history = 0 AND f.date >= ?
    ORDER BY f.date ASC`,
  people: "SELECT id, name, status, reminders, calendar_email FROM people WHERE calendar_email IS NOT NULL",
  snapshots: "SELECT friday_id, hash, snapshot FROM gcal_sync",
  saveSnapshot: `INSERT INTO gcal_sync (friday_id, hash, snapshot, synced_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(friday_id) DO UPDATE SET hash = excluded.hash, snapshot = excluded.snapshot, synced_at = datetime('now')`,
  stateOk: "UPDATE gcal_state SET calendar_id = COALESCE(?, calendar_id), last_ok_at = datetime('now'), last_error = NULL WHERE id = 1",
  stateError: "UPDATE gcal_state SET last_error = ?, last_error_at = datetime('now') WHERE id = 1",
  state: "SELECT calendar_id, last_ok_at, last_error, last_error_at FROM gcal_state WHERE id = 1",
};

// ---------- the bridge (an HTTPS client for the Apps Script web app) ----------

export class BridgeError extends Error {
  constructor(message, { unauthorized = false } = {}) {
    super(message);
    this.name = "BridgeError";
    this.unauthorized = unauthorized;
  }
}

export function createBridge({ url, secret, fetchImpl = globalThis.fetch, timeoutMs = 25000 }) {
  async function call(action, payload = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        // text/plain: Apps Script reads the body itself; JSON content-type adds nothing.
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ secret, action, ...payload }),
        redirect: "follow", // Apps Script answers a POST through a redirect
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Never echo the address: it is part of the secret.
      throw new BridgeError(e?.name === "TimeoutError" ? "the Google bridge did not answer in time" : "could not reach the Google bridge");
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new BridgeError(
        `the Google bridge did not answer with JSON (HTTP ${res.status}); check that the web app is deployed with access for “Anyone”`
      );
    }
    if (!data.ok) throw new BridgeError(String(data.error || `HTTP ${res.status}`).slice(0, 300), { unauthorized: data.error === "unauthorized" });
    return data;
  }

  return {
    ping: () => call("ping"),
    upsertEvent: (event) => call("upsert", event),
    deleteEvent: (fridayId) => call("delete", { friday_id: fridayId }),
    sendMail: ({ to, subject, body }) => call("mail", { to, subject, body }),
  };
}

// ---------- what each Friday's event should look like ----------

function jstIso(ms) {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";
}

// Who is invited: the people scheduled that Friday who have a calendar account
// saved, are still active and have not switched their reminders off.
export function guestsFor(friday, peopleById) {
  const emails = new Set();
  for (const slot of ROLE_SLOTS) {
    const person = peopleById.get(friday[slot.field]);
    if (person && person.status === "active" && person.reminders && person.calendar_email) {
      emails.add(person.calendar_email.trim().toLowerCase());
    }
  }
  return [...emails].sort();
}

export function desiredEvent({ friday, peopleById, siteUrl }) {
  const { startMs, endMs } = prayerWindowUtc(friday.date);
  return {
    friday_id: friday.id,
    title: eventTitle(friday),
    description: eventDescription(friday, siteUrl),
    location: (friday.venue || "").trim(),
    start: jstIso(startMs),
    end: jstIso(endMs),
    guests: guestsFor(friday, peopleById),
  };
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

// Nothing to do if what Google already has is what we want now. Guests are
// emailed (invitation, update, cancellation) when the guest list, time or place
// changed; a change of wording only (a different khatib in the title and text)
// is made quietly, so shuffling the line-up does not flood anyone's inbox.
export function planSync(hash, desired, previous) {
  if (previous && previous.hash === hash) return { action: "none" };
  const before = previous && previous.snapshot;
  const quiet =
    !!before &&
    sameList(before.guests, desired.guests) &&
    before.start === desired.start &&
    before.end === desired.end &&
    before.location === desired.location;
  return { action: "upsert", sendUpdates: quiet ? "none" : "all" };
}

function parseSnapshot(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Bring Google up to date for every upcoming Friday. Only what changed is sent.
// `db` is { all(sql, params) -> rows, run(sql, params) -> { changes } } over the D1 database.
//   dryRun    - only count what would be sent; no calls, nothing saved
//   forcePing - contact the bridge even if nothing changed (a connection test)
export async function syncUpcoming({ bridge, db, siteUrl, today, dryRun = false, forcePing = false, maxCalls = 40 }) {
  const fridays = await db.all(SQL.fridays, [today]);
  const people = await db.all(SQL.people, []);
  const snapshots = new Map(
    (await db.all(SQL.snapshots, [])).map((row) => [row.friday_id, { hash: row.hash, snapshot: parseSnapshot(row.snapshot) }])
  );
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const work = [];
  let unchanged = 0;
  for (const friday of fridays) {
    const desired = desiredEvent({ friday, peopleById, siteUrl });
    const hash = await sha256Hex(JSON.stringify(desired));
    const plan = planSync(hash, desired, snapshots.get(friday.id));
    if (plan.action === "none") unchanged++;
    else work.push({ friday, desired, hash, plan });
  }

  const result = { total: fridays.length, unchanged, synced: 0, failed: 0, deferred: 0, errors: [], calendar: null };
  if (dryRun) return { ...result, wouldSync: work.length };
  if (!work.length && !forcePing) return result;

  const fail = async (message) => {
    result.failed++;
    result.errors.push({ message });
    await db.run(SQL.stateError, [message.slice(0, 300)]);
  };

  // One ping first: it proves the connection before any event is touched, and
  // tells us which calendar this is (the home page links to it).
  let calendarId = null;
  try {
    const ping = await bridge.ping();
    result.calendar = { name: ping.calendar_name || null, mail_quota_left: ping.mail_quota_left ?? null };
    calendarId = ping.calendar_id || null;
  } catch (e) {
    await fail(e.message);
    return result;
  }

  let calls = 0;
  for (const { friday, desired, hash, plan } of work) {
    if (calls >= maxCalls) {
      result.deferred++;
      continue;
    }
    calls++;
    try {
      await bridge.upsertEvent({ ...desired, send_updates: plan.sendUpdates });
      await db.run(SQL.saveSnapshot, [friday.id, hash, JSON.stringify(desired)]);
      result.synced++;
    } catch (e) {
      result.failed++;
      result.errors.push({ date: friday.date, message: e.message });
      if (e.unauthorized) break;
    }
  }

  if (result.failed) await db.run(SQL.stateError, [(result.errors[0].message || "sync failed").slice(0, 300)]);
  else await db.run(SQL.stateOk, [calendarId]);
  return result;
}

// ---------- the admin's "can't make it" email, through the bridge ----------

const ADMINS_SQL = "SELECT id, name, status, is_admin, email, reminders, reminder_token FROM people WHERE is_admin = 1";

// Tell the admins at once (the reminder job would only do it at its next run).
// The alert is "claimed" first so the job cannot send it a second time; if
// nothing could be delivered the claim is released and the job sends it later.
// Returns true when at least one admin was emailed.
export async function emailAlertViaBridge({ bridge, db, alertId, siteUrl, today }) {
  const claim = await db.run("UPDATE availability_alerts SET emailed_at = datetime('now') WHERE id = ? AND emailed_at IS NULL AND resolved_at IS NULL AND acknowledged_at IS NULL", [alertId]);
  if (!claim.changes) return false;

  const release = () => db.run("UPDATE availability_alerts SET emailed_at = NULL WHERE id = ?", [alertId]);
  try {
    const [row] = await db.all(`${ALERT_ROW_SELECT} WHERE a.id = ?`, [alertId]);
    const admins = alertRecipients(await db.all(ADMINS_SQL, []));
    if (!row || !admins.length) {
      await release();
      return false;
    }
    const days = Math.round((Date.parse(row.date) - Date.parse(today)) / 86400000);
    let delivered = 0;
    for (const admin of admins) {
      const email = buildAlertEmail({ alert: { person_name: row.person_name, roles: row.roles }, friday: row, admin, days, siteUrl });
      try {
        await bridge.sendMail({ to: admin.email, subject: email.subject, body: email.text });
        delivered++;
      } catch {
        // try the others; the job retries by SMTP if nobody could be reached
      }
    }
    if (!delivered) await release();
    return delivered > 0;
  } catch {
    await release();
    return false;
  }
}

