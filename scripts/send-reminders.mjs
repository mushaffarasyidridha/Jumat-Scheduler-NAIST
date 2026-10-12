#!/usr/bin/env node
// Daily reminder job, run by .github/workflows/reminders.yml.
//
//   1. Reads the next 7 days of Fridays, the people with a contact channel and
//      the reminders already sent, straight from the D1 database (Cloudflare's
//      REST API, using the same API token the deploy uses).
//   2. Works out who is due a reminder (scripts/reminder-lib.mjs).
//   3. Sends email through the community Gmail account (app password) and LINE
//      through the Messaging API, logging each delivery so it is never repeated.
//
// DRY_RUN=true (or --dry-run) only prints what would happen. TEST_EMAIL=...
// sends one test email and stops, to check the Gmail secrets.
//
// IMPORTANT: this repository is public, so these Actions logs are public. Never
// print email addresses, LINE ids or unsubscribe tokens - see redact().

import { readFileSync } from "node:fs";
import { ALERT_ROW_SELECT } from "../functions/api/_alertmail.mjs";
import { joinRecipients, buildJoinEmail, JOIN_ROW_SELECT } from "../functions/api/_joinmail.mjs";
import { createBridge, syncUpcoming } from "../functions/api/_gcal.mjs";
import { createToaClient, syncToa } from "../functions/api/_toa.mjs";
import {
  DEFAULT_SITE_URL,
  todayInTokyo,
  minutesInTokyo,
  tooLateToSend,
  tooLateForKultum,
  dueKultumReminders,
  buildKultumEmail,
  buildKultumLineText,
  GATHERING_ID_OFFSET,
  parseReminderDaysSetting,
  addDays,
  dueReminders,
  dueAdminTodos,
  sentKey,
  buildEmail,
  buildLineText,
  buildAdminEmail,
  buildAdminChatText,
  alertRecipients,
  buildAlertEmail,
  daysUntil,
  formatDateShort,
} from "./reminder-lib.mjs";

const env = process.env;
const TOA_CHECK = /^(1|true|yes)$/i.test(env.TOA_CHECK || "");
const DRY_RUN = /^(1|true|yes)$/i.test(env.DRY_RUN || "") || process.argv.includes("--dry-run");
const SITE_URL = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const CF_API = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const LINE_API = env.LINE_API_BASE || "https://api.line.me";
const WINDOW_DAYS = 7;
// Set up with the Google Calendar bridge (see the README); until then the job
// does nothing about Google.
const BRIDGE = env.GCAL_BRIDGE_URL && env.GCAL_BRIDGE_SECRET ? createBridge({ url: env.GCAL_BRIDGE_URL, secret: env.GCAL_BRIDGE_SECRET }) : null;
const GCAL_CHECK = /^(1|true|yes)$/i.test(env.GCAL_CHECK || "");

function redact(text) {
  return String(text)
    .replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, "[email]")
    .replace(/\bU[0-9a-f]{32}\b/g, "[line-id]")
    .replace(/\b[0-9a-f]{32}\b/g, "[token]");
}

function need(...names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing required setting(s): ${missing.join(", ")}`);
}

// ---------- D1 over Cloudflare's REST API ----------

function databaseId() {
  if (env.D1_DATABASE_ID) return env.D1_DATABASE_ID;
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const match = toml.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("Could not find database_id in wrangler.toml");
  return match[1];
}

async function d1(sql, params = []) {
  const res = await fetch(`${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId()}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const detail = (body?.errors || []).map((e) => e.message).join("; ") || "no detail";
    throw new Error(`D1 query failed (HTTP ${res.status}): ${detail}`);
  }
  return body.result?.[0]?.results ?? [];
}

// ---------- email (Gmail SMTP) ----------

let transporter;
async function getTransporter() {
  if (!transporter) {
    need("GMAIL_USER", "GMAIL_APP_PASSWORD");
    const { default: nodemailer } = await import("nodemailer");
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: Number(env.SMTP_PORT) || 465,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE !== "false" : true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// A reminder for a person on a Friday, or (type "admin") the admin's to-do.
function emailFor(item) {
  if (item.type === "kultum") return buildKultumEmail({ ...item, siteUrl: SITE_URL });
  return item.type === "admin" ? buildAdminEmail({ ...item, siteUrl: SITE_URL }) : buildEmail({ ...item, siteUrl: SITE_URL });
}

function chatFor(item) {
  if (item.type === "kultum") return buildKultumLineText(item);
  return item.type === "admin" ? buildAdminChatText({ ...item, siteUrl: SITE_URL }) : buildLineText({ ...item, siteUrl: SITE_URL });
}

async function deliverEmail({ to, subject, text, unsubscribeUrl }) {
  const mailer = await getTransporter();
  await mailer.sendMail({
    from: { name: "NAIST Jumat Scheduler", address: env.GMAIL_USER },
    to,
    subject,
    text,
    // Lets mail apps show their own "Unsubscribe" button (RFC 8058 one-click).
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}

async function sendEmail(item) {
  await deliverEmail({ to: item.person.email, ...emailFor(item) });
}

async function sendTestEmail(to) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("test_email is not a valid address");
  const mailer = await getTransporter();
  await mailer.sendMail({
    from: { name: "NAIST Jumat Scheduler", address: env.GMAIL_USER },
    to,
    subject: "Jumat Scheduler: test email",
    text: "If you can read this, the Gmail settings for the Jumat reminders work.\n\n(Sent by the Send Jumat reminders workflow.)",
  });
  console.log("Test email sent. Check that inbox (and its spam folder).");
}

// ---------- LINE ----------

async function lineJson(path) {
  const res = await fetch(`${LINE_API}${path}`, { headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
  if (!res.ok) throw new Error(`LINE ${path} returned HTTP ${res.status}`);
  return res.json();
}

// The free LINE plan allows only a few hundred pushes a month. Count what is
// left so running out is reported clearly instead of as a stream of errors.
async function lineRemaining() {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return Infinity; // sendLine() reports the missing secret
  try {
    const quota = await lineJson("/v2/bot/message/quota");
    if (quota.type !== "limited") return Infinity;
    const { totalUsage } = await lineJson("/v2/bot/message/quota/consumption");
    return Math.max(0, quota.value - totalUsage);
  } catch (e) {
    console.warn(`Could not read the LINE message quota (${redact(e.message)}); sending anyway.`);
    return Infinity;
  }
}

async function sendLine(item) {
  need("LINE_CHANNEL_ACCESS_TOKEN");
  const res = await fetch(`${LINE_API}/v2/bot/message/push`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: item.person.line_user_id, messages: [{ type: "text", text: chatFor(item) }] }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`LINE push failed (HTTP ${res.status}) ${detail}`);
  }
}

// ---------- main ----------

const FRIDAYS_SQL = `
  SELECT f.id, f.date, f.venue, f.primary_khatib_id, f.secondary_khatib_id, f.imam_id,
         COALESCE(pp.name, f.primary_khatib_name) AS primary_name,
         COALESCE(sp.name, f.secondary_khatib_name) AS secondary_name,
         COALESCE(ip.name, f.imam_name) AS imam_name
  FROM fridays f
  LEFT JOIN people pp ON pp.id = f.primary_khatib_id
  LEFT JOIN people sp ON sp.id = f.secondary_khatib_id
  LEFT JOIN people ip ON ip.id = f.imam_id
  WHERE f.is_history = 0 AND f.date >= ? AND f.date <= ?
  ORDER BY f.date`;

// Ramadan days in the window that have a kultum, reminders on and a roster speaker.
const KULTUM_SQL = `
  SELECT id, date, place, start_time, kultum, kultum_minutes, speaker_id, reminders
  FROM gatherings
  WHERE date >= ? AND date <= ? AND kultum = 1 AND reminders = 1 AND speaker_id IS NOT NULL
  ORDER BY date`;

// Someone scheduled said they can't make it: tell the admin(s) by email. The
// website shows the same alert straight away; this is the email half. Marked
// sent only once at least one admin was emailed, so a failure is retried.
const ALERTS_SQL = `${ALERT_ROW_SELECT}
  WHERE a.emailed_at IS NULL AND a.resolved_at IS NULL AND a.acknowledged_at IS NULL AND f.date >= ?
  ORDER BY f.date, a.id`;

async function sendAlertEmails({ today, people }) {
  const alerts = await d1(ALERTS_SQL, [today]);
  if (!alerts.length) return { count: 0, sent: 0, failed: 0 };
  console.log(`${alerts.length} "can't make it" alert(s) waiting for the admin.`);
  const admins = alertRecipients(people);
  if (!admins.length) {
    console.log("No admin has an email address, so the alert email(s) wait until one is set (the website shows them already).");
    return { count: alerts.length, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const row of alerts) {
    const label = `alert ${row.person_name} - ${formatDateShort(row.date)} (${row.roles})`;
    if (DRY_RUN) {
      console.log(`would send: ${label} -> ${admins.length} admin(s)`);
      continue;
    }
    let delivered = 0;
    for (const admin of admins) {
      const email = buildAlertEmail({
        alert: { person_name: row.person_name, roles: row.roles },
        friday: row,
        admin,
        days: daysUntil(today, row.date),
        siteUrl: SITE_URL,
      });
      try {
        await deliverEmail({ to: admin.email, ...email });
        delivered++;
      } catch (e) {
        failed++;
        console.error(`FAILED: ${label}: ${redact(e.message)}`);
      }
    }
    if (!delivered) continue;
    sent++;
    console.log(`sent: ${label}`);
    try {
      await d1("UPDATE availability_alerts SET emailed_at = datetime('now') WHERE id = ?", [row.alert_id]);
    } catch (e) {
      failed++;
      console.error(`!! delivered but NOT recorded (may be sent again on the next run): ${label}: ${redact(e.message)}`);
    }
  }
  return { count: alerts.length, sent, failed };
}

// Someone typed their details because they could not find their name: tell the
// admin(s) by email. The website shows the request in the planner straight away;
// this is the email half. The log says only how many (this repository is public).
async function sendJoinEmails({ people }) {
  const requests = await d1(`${JOIN_ROW_SELECT} WHERE emailed_at IS NULL AND resolved_at IS NULL ORDER BY id`, []);
  if (!requests.length) return { count: 0, sent: 0, failed: 0 };
  console.log(`${requests.length} request(s) to join the roster waiting for the admin.`);
  const admins = joinRecipients(people);
  if (!admins.length) {
    console.log("No admin has an email address, so the request email(s) wait until one is set (the website shows them already).");
    return { count: requests.length, sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const request of requests) {
    const label = `join request #${request.id}`;
    if (DRY_RUN) {
      console.log(`would send: ${label} -> ${admins.length} admin(s)`);
      continue;
    }
    let delivered = 0;
    for (const admin of admins) {
      try {
        await deliverEmail({ to: admin.email, ...buildJoinEmail({ request, admin, siteUrl: SITE_URL }) });
        delivered++;
      } catch (e) {
        failed++;
        console.error(`FAILED: ${label}: ${redact(e.message)}`);
      }
    }
    if (!delivered) continue;
    sent++;
    console.log(`sent: ${label}`);
    try {
      await d1("UPDATE join_requests SET emailed_at = datetime('now') WHERE id = ?", [request.id]);
    } catch (e) {
      failed++;
      console.error(`!! delivered but NOT recorded (may be sent again on the next run): ${label}: ${redact(e.message)}`);
    }
  }
  return { count: requests.length, sent, failed };
}

function printSamples(due) {
  const seen = new Set();
  for (const item of due) {
    const sample = item.type === "admin" ? `admin ${item.channel}` : item.type === "kultum" ? `kultum ${item.channel}` : item.channel;
    if (seen.has(sample)) continue;
    seen.add(sample);
    let body;
    if (item.channel === "email") {
      const email = emailFor(item);
      body = `Subject: ${email.subject}\n${email.text}`;
    } else {
      body = chatFor(item);
    }
    console.log(`\n--- sample ${sample} message (not sent) ---\n${redact(body)}\n---`);
  }
}

// Keep the shared Google Calendar in step with the schedule. The website already
// does this at every edit; this run is the safety net (a failed or missed
// update is retried here, and the first run fills the calendar). Counts only in
// the log: this repository is public.
async function reconcileGoogle({ today, forcePing = false, dryRun = DRY_RUN }) {
  if (!BRIDGE) return { synced: 0, failed: 0 };
  const db = { all: (sql, params = []) => d1(sql, params), run: (sql, params = []) => d1(sql, params) };
  const result = await syncUpcoming({ bridge: BRIDGE, db, siteUrl: SITE_URL, today, dryRun, forcePing });
  const i = result.invites;
  console.log(
    `Google invitations: ${i.accounts} person(s) have an email or Google Calendar address saved, ${i.eligible} of them eligible (active, reminders on); ` +
      `test mode ${i.testMode ? `ON (${i.listed} address(es), ${i.matched} matching an eligible saved address)` : "off"}; ` +
      `${i.fridaysWithGuests} of ${result.total} upcoming Friday(s) have at least one guest to invite (${i.people} different person/people).`
  );
  if (dryRun) {
    console.log(`Google Calendar: ${result.wouldSync} of ${result.total} upcoming Friday(s)${result.gatherings ? ` + ${result.gatherings} Ramadan day(s)` : ""} would be updated${result.wouldRemove ? `, ${result.wouldRemove} removed` : ""}.`);
    return { synced: 0, failed: 0 };
  }
  if (result.calendar) console.log(`Google Calendar connection OK (calendar "${result.calendar.name || "?"}").`);
  if (result.synced || result.failed || result.deferred) {
    console.log(
      `Google Calendar: ${result.synced} Friday(s) updated, ${result.unchanged} already up to date` +
        `${result.removed ? `, ${result.removed} removed` : ""}${result.deferred ? `, ${result.deferred} left for the next run` : ""}${result.failed ? `, ${result.failed} FAILED` : ""}.`
    );
  } else {
    console.log(`Google Calendar: all ${result.total} upcoming Friday(s)${result.gatherings ? ` and ${result.gatherings} Ramadan day(s)` : ""} already up to date.`);
  }
  for (const e of result.errors) console.error(`FAILED: Google Calendar${e.date ? ` ${e.date}` : ""}: ${redact(e.message)}`);
  return { synced: result.synced, failed: result.failed };
}

// Add the Ramadan evenings to the TOA app's room queues (rooms linked on the
// Places card). Switched off until the TOA account secrets exist. Counts only in
// the log: this repository is public.
async function reconcileToa({ today, dryRun = DRY_RUN }) {
  if (!env.TOA_EMAIL || !env.TOA_PASSWORD) return { failed: 0 };
  const places = (await d1("SELECT name, toa_room_id FROM places WHERE toa_room_id IS NOT NULL")).filter((p) => p.toa_room_id);
  if (!places.length) return { failed: 0 };
  let gatherings = [];
  let settings = {};
  try {
    gatherings = await d1(
      `SELECT g.id, g.date, g.place, g.start_time, g.kultum, g.kultum_minutes, COALESCE(p.name, g.speaker_name) AS speaker
       FROM gatherings g LEFT JOIN people p ON p.id = g.speaker_id WHERE g.date >= ? ORDER BY g.date ASC`,
      [today]
    );
    settings = (await d1("SELECT kultum_minutes, event_minutes FROM ramadan_settings WHERE id = 1"))[0] || {};
  } catch {
    console.log("TOA: Ramadan tables not available yet, skipped.");
    return { failed: 0 };
  }
  const client = createToaClient({ email: env.TOA_EMAIL, password: env.TOA_PASSWORD, webConfigUrl: env.TOA_WEB_CONFIG_URL || undefined });
  const r = await syncToa({ client, gatherings, places, settings, today, dryRun });
  const would = dryRun ? "would be " : "";
  console.log(
    `TOA queue: ${r.rooms} linked room(s); ${r.created} evening(s) ${would}added, ${r.updated} ${would}updated, ${r.removed} ${would}removed, ${r.same} already up to date` +
      `${r.foreign ? `, ${r.foreign} left alone (not created by this account)` : ""}${r.withoutRoom ? `, ${r.withoutRoom} at a place with no TOA room` : ""}${r.failed ? `, ${r.failed} FAILED` : ""}.`
  );
  for (const e of r.errors) console.error(`FAILED: ${redact(e)}`);
  return { failed: r.failed };
}

async function main() {
  // Test mode: one email, then stop; touches neither the database nor LINE.
  // TEST_EMAIL_TO_SENDER sends it to the Gmail account itself, so nobody has to
  // type an address (which a public repository could show on the run page).
  const toSender = /^(1|true|yes)$/i.test(env.TEST_EMAIL_TO_SENDER || "");
  if (env.TEST_EMAIL || toSender) {
    if (!env.TEST_EMAIL) need("GMAIL_USER");
    await sendTestEmail(env.TEST_EMAIL ? env.TEST_EMAIL.trim() : env.GMAIL_USER);
    return 0;
  }

  need("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID");
  const today = todayInTokyo();

  // "Check the Google Calendar connection": ping the bridge, then bring the
  // calendar fully up to date (this is also how it gets filled the first time).
  if (GCAL_CHECK) {
    if (!BRIDGE) throw new Error("Missing required setting(s): GCAL_BRIDGE_URL, GCAL_BRIDGE_SECRET");
    // A check is a real run: the dry-run switch (on by default) does not apply.
    const { failed } = await reconcileGoogle({ today, forcePing: true, dryRun: false });
    return failed ? 1 : 0;
  }
  // "Add the Ramadan evenings to TOA now": a real run of just that part.
  if (TOA_CHECK) {
    if (!env.TOA_EMAIL || !env.TOA_PASSWORD) throw new Error("Missing required setting(s): TOA_EMAIL, TOA_PASSWORD");
    const { failed } = await reconcileToa({ today, dryRun: false });
    return failed ? 1 : 0;
  }
  console.log(`${DRY_RUN ? "DRY RUN - nothing is sent or recorded. " : ""}Today in Japan: ${today}`);

  const fridays = await d1(FRIDAYS_SQL, [today, addDays(today, WINDOW_DAYS)]);
  const people = await d1(
    "SELECT id, name, status, is_admin, email, reminders, line_user_id, reminder_token FROM people WHERE email IS NOT NULL OR line_user_id IS NOT NULL"
  );
  // Ramadan: days with a kultum and a named speaker in the next week (none outside Ramadan).
  let gatherings = [];
  let ramadan = { kultum_minutes: 7, reminder_days: [3, 2, 1, 0] };
  try {
    const [settings] = await d1("SELECT kultum_minutes, reminder_days FROM ramadan_settings WHERE id = 1");
    if (settings) ramadan = { kultum_minutes: settings.kultum_minutes, reminder_days: parseReminderDaysSetting(settings.reminder_days) };
    gatherings = await d1(KULTUM_SQL, [today, addDays(today, WINDOW_DAYS)]);
  } catch (e) {
    console.log(`Ramadan days are not available yet (${redact(e.message)}); skipped.`);
  }

  const logIds = [...fridays.map((f) => f.id), ...gatherings.map((g) => GATHERING_ID_OFFSET + g.id)];
  let sentKeys = new Set();
  if (logIds.length) {
    const rows = await d1(
      `SELECT friday_id, person_id, kind, channel FROM reminder_log WHERE friday_id IN (${logIds.map(() => "?").join(",")})`,
      logIds
    );
    sentKeys = new Set(rows.map((r) => sentKey(r.friday_id, r.person_id, r.kind, r.channel)));
  }

  const allDue = [
    ...dueReminders({ today, fridays, people, sentKeys }),
    ...dueAdminTodos({ today, fridays, people, sentKeys }),
    ...dueKultumReminders({ today, gatherings, settings: ramadan, people, sentKeys }),
  ].sort((a, b) => a.days - b.days || a.person.name.localeCompare(b.person.name));
  // Not logged as sent: it was never sent, and it is moot once the day is over.
  const nowMinutes = minutesInTokyo();
  const lateItem = (d) => (d.type === "kultum" ? tooLateForKultum(d.days, nowMinutes, d.gathering.start_time) : tooLateToSend(d.days, nowMinutes));
  const tooLate = allDue.filter(lateItem);
  const due = allDue.filter((d) => !lateItem(d));
  console.log(`${fridays.length} Friday(s) in the next ${WINDOW_DAYS} days${gatherings.length ? `, ${gatherings.length} Ramadan day(s) with a kultum speaker` : ""}; ${due.length} reminder(s) due.`);
  if (tooLate.length) {
    console.log(
      `Skipped ${tooLate.length} same-day reminder(s): too late in the day to help.`
    );
  }

  let sent = 0;
  let failed = 0;
  const lineBudget = !DRY_RUN && due.some((d) => d.channel === "line") ? await lineRemaining() : Infinity;
  let lineUsed = 0;

  for (const item of due) {
    const when = item.type === "kultum" ? item.gathering.date : item.friday.date;
    const label = `${item.channel.padEnd(5)} ${item.person.name} - ${item.type === "kultum" ? "kultum " : ""}${formatDateShort(when)} (${item.kind})`;
    if (DRY_RUN) {
      console.log(`would send: ${label}`);
      continue;
    }
    try {
      if (item.channel === "email") {
        await sendEmail(item);
      } else {
        if (lineUsed >= lineBudget) throw new Error("the LINE message limit for this month is used up");
        await sendLine(item);
        lineUsed++;
      }
    } catch (e) {
      failed++;
      console.error(`FAILED: ${label}: ${redact(e.message)}`);
      continue;
    }
    sent++;
    console.log(`sent: ${label}`);
    try {
      await d1("INSERT OR IGNORE INTO reminder_log (friday_id, person_id, kind, channel) VALUES (?, ?, ?, ?)", [
        item.logId ?? item.friday.id,
        item.person.id,
        item.kind,
        item.channel,
      ]);
    } catch (e) {
      failed++;
      console.error(`!! delivered but NOT recorded (may be sent again on the next run): ${label}: ${redact(e.message)}`);
    }
  }

  const alertStats = await sendAlertEmails({ today, people });
  sent += alertStats.sent;
  failed += alertStats.failed;
  const joinStats = await sendJoinEmails({ people });
  sent += joinStats.sent;
  failed += joinStats.failed;

  const google = await reconcileGoogle({ today });
  failed += google.failed;
  const toa = await reconcileToa({ today }).catch((e) => {
    console.error(`FAILED: TOA: ${redact(e.message)}`);
    return { failed: 1 };
  });
  failed += toa.failed;

  if (DRY_RUN) {
    printSamples(due);
    return 0;
  }

  // Heartbeat: lets the planner show when the job last ran, and warn if the
  // schedule has silently stopped.
  await d1("INSERT INTO reminder_runs (mode, sent, failed, note) VALUES ('send', ?, ?, ?)", [
    sent,
    failed,
    due.length || alertStats.count || joinStats.count ? null : "nothing due",
  ]);
  await d1("DELETE FROM reminder_runs WHERE ran_at < datetime('now', '-90 days')");

  console.log(`Done: ${sent} sent, ${failed} failed.`);
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`ERROR: ${redact(e.message)}`);
    process.exitCode = 1;
  }
);
