import { json, checkAccess, newLinkCode, formatLinkCode, sqliteUtcToIso } from "../_utils.js";
import { meTarget } from "../_me.mjs";

const CODE_VALID_DAYS = 3;
const NOT_MINE = "This device is not locked to a name. Choose your name under You are first.";

// A member links their own LINE: they get a one-time code here and send it to the bot
// (the webhook, ../line/webhook.js, then links their LINE account). Same code as the admin's.
export async function onRequestPost({ request, env }) {
  const target = await meTarget(request, env, checkAccess(request, env));
  if (!target) return json({ error: NOT_MINE }, { status: 403 });
  const id = target.id;
  const code = newLinkCode();
  await env.DB.prepare(`UPDATE people SET line_link_code = ?, line_link_expires = datetime('now', '+${CODE_VALID_DAYS} days') WHERE id = ?`)
    .bind(code, id)
    .run();
  const row = await env.DB.prepare("SELECT line_link_expires AS expires FROM people WHERE id = ?").bind(id).first();
  return json({ code: formatLinkCode(code), expires_at: sqliteUtcToIso(row.expires) });
}

// A member unlinks their own LINE.
export async function onRequestDelete({ request, env }) {
  const target = await meTarget(request, env, checkAccess(request, env));
  if (!target) return json({ error: NOT_MINE }, { status: 403 });
  const id = target.id;
  await env.DB.prepare("UPDATE people SET line_user_id = NULL, line_link_code = NULL, line_link_expires = NULL WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
