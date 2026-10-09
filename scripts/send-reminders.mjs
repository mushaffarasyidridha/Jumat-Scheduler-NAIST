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
import {
  DEFAULT_SITE_URL,
  todayInTokyo,
  minutesInTokyo,
  tooLateToSend,
  addDays,
  dueReminders,
  dueAdminTodos,
  sentKey,
  buildEmail,
  buildLineText,
  buildAdminEmail,
  buildAdminChatText,
  formatDateShort,
} from "./reminder-lib.mjs";

const env = process.env;
const DRY_RUN = /^(1|true|yes)$/i.test(env.DRY_RUN || "") || process.argv.includes("--dry-run");
const SITE_URL = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const CF_API = env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const LINE_API = env.LINE_API_BASE || "https://api.line.me";
const WINDOW_DAYS = 7;

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
  return item.type === "admin" ? buildAdminEmail({ ...item, siteUrl: SITE_URL }) : buildEmail({ ...item, siteUrl: SITE_URL });
}

function chatFor(item) {
  return item.type === "admin" ? buildAdminChatText({ ...item, siteUrl: SITE_URL }) : buildLineText({ ...item, siteUrl: SITE_URL });
}

async function sendEmail(item) {
  const { subject, text, unsubscribeUrl } = emailFor(item);
  const mailer = await getTransporter();
  await mailer.sendMail({
    from: { name: "NAIST Jumat Scheduler", address: env.GMAIL_USER },
    to: item.person.email,
    subject,
    text,
    // Lets mail apps show their own "Unsubscribe" button (RFC 8058 one-click).
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
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

function printSamples(due) {
  const seen = new Set();
  for (const item of due) {
    const sample = item.type === "admin" ? `admin ${item.channel}` : item.channel;
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
  console.log(`${DRY_RUN ? "DRY RUN - nothing is sent or recorded. " : ""}Today in Japan: ${today}`);

  const fridays = await d1(FRIDAYS_SQL, [today, addDays(today, WINDOW_DAYS)]);
  const people = await d1(
    "SELECT id, name, status, is_admin, email, reminders, line_user_id, reminder_token FROM people WHERE email IS NOT NULL OR line_user_id IS NOT NULL"
  );
  let sentKeys = new Set();
  if (fridays.length) {
    const rows = await d1(
      `SELECT friday_id, person_id, kind, channel FROM reminder_log WHERE friday_id IN (${fridays.map(() => "?").join(",")})`,
      fridays.map((f) => f.id)
    );
    sentKeys = new Set(rows.map((r) => sentKey(r.friday_id, r.person_id, r.kind, r.channel)));
  }

  const allDue = [...dueReminders({ today, fridays, people, sentKeys }), ...dueAdminTodos({ today, fridays, people, sentKeys })].sort(
    (a, b) => a.days - b.days || a.person.name.localeCompare(b.person.name)
  );
  // Not logged as sent: it was never sent, and it is moot once the day is over.
  const nowMinutes = minutesInTokyo();
  const tooLate = allDue.filter((d) => tooLateToSend(d.days, nowMinutes));
  const due = allDue.filter((d) => !tooLateToSend(d.days, nowMinutes));
  console.log(`${fridays.length} Friday(s) in the next ${WINDOW_DAYS} days; ${due.length} reminder(s) due.`);
  if (tooLate.length) {
    console.log(
      `Skipped ${tooLate.length} same-day reminder(s): it is already past 11:00 in Japan, too late to help.`
    );
  }

  let sent = 0;
  let failed = 0;
  const lineBudget = !DRY_RUN && due.some((d) => d.channel === "line") ? await lineRemaining() : Infinity;
  let lineUsed = 0;

  for (const item of due) {
    const label = `${item.channel.padEnd(5)} ${item.person.name} - ${formatDateShort(item.friday.date)} (${item.kind})`;
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
        item.friday.id,
        item.person.id,
        item.kind,
        item.channel,
      ]);
    } catch (e) {
      failed++;
      console.error(`!! delivered but NOT recorded (may be sent again on the next run): ${label}: ${redact(e.message)}`);
    }
  }

  if (DRY_RUN) {
    printSamples(due);
    return 0;
  }

  // Heartbeat: lets the planner show when the job last ran, and warn if the
  // schedule has silently stopped.
  await d1("INSERT INTO reminder_runs (mode, sent, failed, note) VALUES ('send', ?, ?, ?)", [
    sent,
    failed,
    due.length ? null : "nothing due",
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
