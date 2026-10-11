import { json, badRequest, requireAccess, parseEmail, parseWhatsapp, ROLES, AFFILIATIONS, sqliteUtcToIso } from "../_utils.js";
import { emailJoinNow } from "../_gcal_runtime.mjs";

// Public: someone who cannot find their name sends their details. It only ever
// adds a pending request for the admin to look at; nothing here touches the roster.
const MAX_PENDING = 50; // unresolved requests at any time
const MAX_PER_HOUR = 10; // new requests per hour, from everybody (no accounts, so no per-person limit)

const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (value) => text(value, 200).toLowerCase();

export async function onRequestPost({ request, env, waitUntil }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("invalid body");

  // A hidden field real people never fill in: bots do. Pretend it worked.
  if (text(body.website, 100)) return json({ ok: true }, { status: 201 });

  const name = text(body.name, 80);
  if (name.length < 2) return badRequest("please type your name");
  const country = text(body.country, 60) || null;
  const note = text(body.note, 300) || null;
  const role = ROLES.includes(body.role) ? body.role : null;
  const affiliation = AFFILIATIONS.includes(body.affiliation) ? body.affiliation : null;
  const email = parseEmail(body.email);
  if (email.error) return badRequest(email.error);
  const whatsapp = parseWhatsapp(body.whatsapp);
  if (whatsapp.error) return badRequest(whatsapp.error);

  // Already on the roster (just missed in the list)? Say so instead of asking the admin.
  const { results: people } = await env.DB.prepare("SELECT name, status FROM people").all();
  if (people.some((p) => norm(p.name) === norm(name) && p.status === "active")) {
    return json({ error: "That name is already on the list: pick it under “You are”.", code: "already_listed" }, { status: 409 });
  }
  // The same person pressing the button twice.
  const dup = await env.DB.prepare("SELECT id FROM join_requests WHERE resolved_at IS NULL AND lower(name) = lower(?)").bind(name).first();
  if (dup) return json({ ok: true, duplicate: true }, { status: 200 });

  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM join_requests WHERE resolved_at IS NULL").first();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM join_requests WHERE created_at >= datetime('now', '-1 hour')").first();
  if (pending.n >= MAX_PENDING || recent.n >= MAX_PER_HOUR) {
    return json({ error: "Too many requests at the moment. Please ask the admin directly.", code: "busy" }, { status: 429 });
  }

  const result = await env.DB.prepare(
    "INSERT INTO join_requests (name, affiliation, country, role, email, whatsapp, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(name, affiliation, country, role, email.value, whatsapp.value, note)
    .run();
  // With the Google bridge the admins are emailed at once; otherwise the reminder job does it.
  waitUntil(emailJoinNow(env, result.meta.last_row_id));
  return json({ ok: true, id: result.meta.last_row_id }, { status: 201 });
}

// Admin: the requests still waiting.
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const { results } = await env.DB.prepare(
    "SELECT id, name, affiliation, country, role, email, whatsapp, note, created_at FROM join_requests WHERE resolved_at IS NULL ORDER BY id ASC"
  ).all();
  return json(results.map((row) => ({ ...row, created_at: sqliteUtcToIso(row.created_at) })));
}
