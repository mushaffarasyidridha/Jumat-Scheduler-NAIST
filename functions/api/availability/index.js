import { json, badRequest, checkAccess } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const fridayId = url.searchParams.get("friday_id");
  const personId = url.searchParams.get("person_id");
  const authorized = checkAccess(request, env);

  // Without the community access code, availability is only visible for
  // whichever person_id you ask for (yourself) - not everyone's status.
  if (!authorized && !personId) {
    return json([]);
  }

  const conditions = [];
  const binds = [];
  if (fridayId) {
    conditions.push("a.friday_id = ?");
    binds.push(Number(fridayId));
  }
  if (personId) {
    conditions.push("a.person_id = ?");
    binds.push(Number(personId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.person_id, p.name AS person_name, a.friday_id, a.status, a.note, a.updated_at
     FROM availability a
     JOIN people p ON p.id = a.person_id
     ${where}
     ORDER BY a.updated_at DESC`
  )
    .bind(...binds)
    .all();
  return json(results);
}

// No access code needed: marking your own availability is self-service and
// low-stakes, unlike assigning khatib/imam or editing the roster. There's
// no real per-person login in this app (the shared code isn't one either),
// so this can't verify the caller is only marking themselves - accepted
// here the same way the shared code already is, for a small trusted group.
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const personId = Number(body?.person_id);
  const fridayId = Number(body?.friday_id);
  const status = body?.status;

  if (!Number.isInteger(personId) || !Number.isInteger(fridayId)) {
    return badRequest("person_id and friday_id are required");
  }
  if (!["available", "unavailable"].includes(status)) {
    return badRequest("status must be 'available' or 'unavailable'");
  }
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  await env.DB.prepare(
    `INSERT INTO availability (person_id, friday_id, status, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(person_id, friday_id)
     DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now')`
  )
    .bind(personId, fridayId, status, note)
    .run();

  const row = await env.DB.prepare(
    `SELECT a.id, a.person_id, p.name AS person_name, a.friday_id, a.status, a.note, a.updated_at
     FROM availability a JOIN people p ON p.id = a.person_id
     WHERE a.person_id = ? AND a.friday_id = ?`
  )
    .bind(personId, fridayId)
    .first();

  return json(row);
}
