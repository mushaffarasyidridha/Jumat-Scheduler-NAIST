import { json, badRequest, notFound, requireAccess, sqliteUtcToIso } from "../_utils.js";
import { newDeviceToken, hashDeviceToken, deviceLabel, MAX_DEVICES_PER_PERSON } from "../_devices.mjs";

// Admin: the devices that have locked a person's name. ?person_id=
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const personId = Number(new URL(request.url).searchParams.get("person_id"));
  if (!Number.isInteger(personId)) return badRequest("person_id is required");
  const { results } = await env.DB.prepare("SELECT id, label, created_at, last_seen_at FROM device_locks WHERE person_id = ? ORDER BY last_seen_at DESC, id DESC")
    .bind(personId)
    .all();
  return json(results.map((r) => ({ id: r.id, label: r.label || "Unknown device", created_at: sqliteUtcToIso(r.created_at), last_seen_at: sqliteUtcToIso(r.last_seen_at) })));
}

// Public: a browser that has just chosen a name registers itself and gets its secret
// token back (stored only as a hash). A person may have several devices; past the limit
// the one unused for longest is forgotten.
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const personId = Number(body?.person_id);
  if (!Number.isInteger(personId)) return badRequest("person_id is required");
  const person = await env.DB.prepare("SELECT id FROM people WHERE id = ? AND status = 'active'").bind(personId).first();
  if (!person) return notFound("that name is not on the list");

  const token = newDeviceToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO device_locks (person_id, token_hash, label) VALUES (?, ?, ?)").bind(personId, await hashDeviceToken(token), deviceLabel(request.headers.get("user-agent"))),
    env.DB.prepare(
      "DELETE FROM device_locks WHERE person_id = ? AND id NOT IN (SELECT id FROM device_locks WHERE person_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT ?)",
    ).bind(personId, personId, MAX_DEVICES_PER_PERSON),
  ]);
  return json({ token }, { status: 201 });
}

// Admin: reset every device of one person (?person_id=).
export async function onRequestDelete({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const personId = Number(new URL(request.url).searchParams.get("person_id"));
  if (!Number.isInteger(personId)) return badRequest("person_id is required");
  const result = await env.DB.prepare("DELETE FROM device_locks WHERE person_id = ?").bind(personId).run();
  return json({ person_id: personId, reset: result.meta.changes });
}
