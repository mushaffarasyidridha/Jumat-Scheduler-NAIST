import { json, badRequest, requireAccess } from "../_utils.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, country, role, status, note FROM people ORDER BY status ASC, name COLLATE NOCASE ASC"
  ).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return badRequest("name is required");
  }
  const name = body.name.trim();
  const country = typeof body.country === "string" ? body.country.trim() || null : null;
  const role = ["khatib", "imam", "both"].includes(body.role) ? body.role : "khatib";
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  try {
    const result = await env.DB.prepare(
      `INSERT INTO people (name, country, role, status, note)
       VALUES (?, ?, ?, 'active', ?)`
    )
      .bind(name, country, role, note)
      .run();
    return json({ id: result.meta.last_row_id, name, country, role, status: "active", note }, { status: 201 });
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE")) {
      return badRequest(`"${name}" is already on the roster`);
    }
    throw e;
  }
}
