import { json, badRequest, checkAccess, PERSON_COLUMNS, shapePerson, AFFILIATIONS, parseEmail, parseWhatsapp } from "../_utils.js";
import { meTarget, parseSelfEdit, changedContacts, buildSelfEditEmail } from "../_me.mjs";
import { joinRecipients } from "../_joinmail.mjs";
import { bridgeFrom, syncAfterEdit } from "../_gcal_runtime.mjs";
import { siteUrlFrom } from "../_site.mjs";

const NOT_MINE = "This device is not locked to a name. Choose your name under You are first.";

// Whether the LINE bot is set up here, and where to add it as a friend (optional setting).
const lineInfo = (env) => ({
  configured: !!(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
  bot_url: /^https:\/\/\S+$/.test(env.LINE_BOT_URL || "") ? env.LINE_BOT_URL : null,
});

// A member reads their own details (contact details included) from their own device.
export async function onRequestGet({ request, env }) {
  const target = await meTarget(request, env, checkAccess(request, env));
  if (!target) return json({ error: NOT_MINE }, { status: 403 });
  const row = await env.DB.prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`).bind(target.id).first();
  return json({ person: shapePerson(row, true), line: lineInfo(env) });
}

// A member changes their own contact details and preferences. Admins are emailed when an
// email, WhatsApp, contact or leaving date changes, so a wrong edit is noticed (not when an
// admin made the edit for them on a shared device).
export async function onRequestPatch({ request, env, waitUntil }) {
  const target = await meTarget(request, env, checkAccess(request, env));
  if (!target) return json({ error: NOT_MINE }, { status: 403 });
  const id = target.id;
  const parsed = parseSelfEdit(await request.json().catch(() => null), { parseEmail, parseWhatsapp, affiliations: AFFILIATIONS });
  if (parsed.error) return badRequest(parsed.error);

  const before = await env.DB.prepare("SELECT name, email, whatsapp, calendar_email, contact, leaving_on FROM people WHERE id = ?").bind(id).first();
  const columns = Object.keys(parsed.set);
  await env.DB.prepare(`UPDATE people SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...columns.map((c) => parsed.set[c]), id)
    .run();

  const changes = changedContacts(before, parsed.set);
  if (changes.length && !target.byAdmin) waitUntil(tellAdmins(env, before, changes));
  waitUntil(syncAfterEdit(env)); // the calendar invitation follows the email

  const row = await env.DB.prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`).bind(id).first();
  return json({ person: shapePerson(row, true), line: lineInfo(env) });
}

async function tellAdmins(env, person, changes) {
  const bridge = bridgeFrom(env);
  if (!bridge) return; // no Google bridge: the admin sees the new details in the roster
  try {
    const { results } = await env.DB.prepare("SELECT id, name, status, is_admin, email, reminders, reminder_token FROM people WHERE is_admin = 1").all();
    const siteUrl = siteUrlFrom(env);
    for (const admin of joinRecipients(results)) {
      const mail = buildSelfEditEmail({ person, changes, admin, siteUrl });
      await bridge.sendMail({ to: admin.email, subject: mail.subject, body: mail.text }).catch(() => {});
    }
  } catch (e) {
    console.error("Self-edit email to the admins failed:", e?.message || e);
  }
}
