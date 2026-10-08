import { json, badRequest, notFound, requireAccess, newLinkCode, formatLinkCode, sqliteUtcToIso } from "../../_utils.js";

const CODE_VALID_DAYS = 3;

// Admin generates a one-time code for a person; the person sends it to the
// LINE bot, and the webhook (../../line/webhook.js) links their LINE account.
export async function onRequestPost({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  const code = newLinkCode();
  const result = await env.DB.prepare(
    `UPDATE people
     SET line_link_code = ?, line_link_expires = datetime('now', '+${CODE_VALID_DAYS} days')
     WHERE id = ?`
  )
    .bind(code, id)
    .run();
  if (result.meta.changes === 0) return notFound("person not found");

  const row = await env.DB.prepare("SELECT line_link_expires AS expires FROM people WHERE id = ?").bind(id).first();
  return json({ code: formatLinkCode(code), expires_at: sqliteUtcToIso(row.expires) });
}

// Forget the linked LINE account (and any pending code).
export async function onRequestDelete({ request, env, params }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  const result = await env.DB.prepare(
    "UPDATE people SET line_user_id = NULL, line_link_code = NULL, line_link_expires = NULL WHERE id = ?"
  )
    .bind(id)
    .run();
  if (result.meta.changes === 0) return notFound("person not found");
  return json({ ok: true });
}
