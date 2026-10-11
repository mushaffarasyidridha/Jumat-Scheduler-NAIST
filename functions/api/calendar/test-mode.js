import { json, badRequest, requireAccess } from "../_utils.js";
import { SQL, parseInviteOnly } from "../_gcal.mjs";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

// Invitation test mode. While addresses are saved here, only those addresses are
// invited to Google Calendar events; everyone else is left out. Send an empty
// list to turn it off. The Friday events follow within a minute.
export async function onRequestPost({ request, env, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");
  const raw = Array.isArray(body.invite_only) ? body.invite_only.join(",") : String(body.invite_only ?? "");
  const list = parseInviteOnly(raw);
  if (raw.trim() && !list.length) return badRequest("type a full email address, like name@naist.ac.jp");
  if (list.length > 5) return badRequest("test mode takes at most 5 addresses");

  await env.DB.prepare(SQL.setInviteOnly).bind(list.length ? list.join(",") : null).run();
  waitUntil(syncAfterEdit(env));
  return json({ invite_only: list });
}
