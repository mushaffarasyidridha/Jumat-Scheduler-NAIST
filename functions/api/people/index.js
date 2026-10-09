import {
  json,
  badRequest,
  requireAccess,
  checkAccess,
  ROLES,
  AFFILIATIONS,
  PERSON_COLUMNS,
  shapePerson,
  parseEmail,
  parseWhatsapp,
  newToken,
} from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const authorized = checkAccess(request, env);
  const { results } = await env.DB.prepare(
    `SELECT ${PERSON_COLUMNS}
     FROM people ORDER BY status ASC, name COLLATE NOCASE ASC`
  ).all();
  // Contact info and reminder settings are only for people who already have
  // the community access code - dropping the keys server-side, not just
  // hiding them in the UI, so they never reach an unauthorized client.
  return json(results.map((row) => shapePerson(row, authorized)));
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
  const role = ROLES.includes(body.role) ? body.role : "khatib";
  const affiliation = AFFILIATIONS.includes(body.affiliation) ? body.affiliation : "naist_student";
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const contact = typeof body.contact === "string" ? body.contact.trim() || null : null;
  const email = parseEmail(body.email);
  if (email.error) return badRequest(email.error);
  const whatsapp = parseWhatsapp(body.whatsapp);
  if (whatsapp.error) return badRequest(whatsapp.error);
  const reminders = body.reminders === false ? 0 : 1;
  const isAdmin = body.is_admin === true ? 1 : 0;

  try {
    const result = await env.DB.prepare(
      `INSERT INTO people (name, country, role, status, note, affiliation, contact, email, whatsapp, reminders, is_admin, reminder_token)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(name, country, role, note, affiliation, contact, email.value, whatsapp.value, reminders, isAdmin, newToken())
      .run();
    const person = await env.DB.prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first();
    return json(shapePerson(person, true), { status: 201 });
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE")) {
      return badRequest(`"${name}" is already on the roster`);
    }
    throw e;
  }
}
