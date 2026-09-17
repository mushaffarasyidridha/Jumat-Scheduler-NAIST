import { json, badRequest, requireAccess } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const fridayId = url.searchParams.get("friday_id");

  let query = `
    SELECT a.id, a.person_id, p.name AS person_name, a.friday_id, a.status, a.note, a.updated_at
    FROM availability a
    JOIN people p ON p.id = a.person_id
  `;
  const binds = [];
  if (fridayId) {
    query += " WHERE a.friday_id = ?";
    binds.push(Number(fridayId));
  }
  query += " ORDER BY a.updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

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
