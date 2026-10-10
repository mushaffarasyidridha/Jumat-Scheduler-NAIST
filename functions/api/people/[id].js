import {
  json,
  badRequest,
  notFound,
  requireAccess,
  ROLES,
  AFFILIATIONS,
  PERSON_COLUMNS,
  shapePerson,
  parseEmail,
  parseWhatsapp,
} from "../_utils.js";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

export async function onRequestDelete({ request, env, params, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  // Clean up references rather than leaving dangling ids behind: past
  // availability for this person is no longer meaningful, and any Friday
  // they were assigned to just reopens rather than pointing at a ghost.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM availability WHERE person_id = ?").bind(id),
    env.DB.prepare("DELETE FROM reminder_log WHERE person_id = ?").bind(id),
    env.DB.prepare("DELETE FROM availability_alerts WHERE person_id = ?").bind(id),
    env.DB.prepare("UPDATE fridays SET primary_khatib_id = NULL WHERE primary_khatib_id = ?").bind(id),
    env.DB.prepare("UPDATE fridays SET secondary_khatib_id = NULL WHERE secondary_khatib_id = ?").bind(id),
    env.DB.prepare("UPDATE fridays SET imam_id = NULL WHERE imam_id = ?").bind(id),
  ]);

  const result = await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return notFound("person not found");
  waitUntil(syncAfterEdit(env)); // they may have held a slot (and been invited)

  return json({ id });
}

export async function onRequestPatch({ request, env, params, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");

  const fields = [];
  const values = [];

  if (typeof body.name === "string" && body.name.trim()) {
    fields.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.country === "string" || body.country === null) {
    fields.push("country = ?");
    values.push(body.country ? body.country.trim() : null);
  }
  if (ROLES.includes(body.role)) {
    fields.push("role = ?");
    values.push(body.role);
  }
  if (AFFILIATIONS.includes(body.affiliation)) {
    fields.push("affiliation = ?");
    values.push(body.affiliation);
  }
  if (["active", "inactive"].includes(body.status)) {
    fields.push("status = ?");
    values.push(body.status);
  }
  if (typeof body.note === "string" || body.note === null) {
    fields.push("note = ?");
    values.push(body.note ? body.note.trim() : null);
  }
  if (typeof body.contact === "string" || body.contact === null) {
    fields.push("contact = ?");
    values.push(body.contact ? body.contact.trim() : null);
  }
  if (body.email !== undefined) {
    const email = parseEmail(body.email);
    if (email.error) return badRequest(email.error);
    fields.push("email = ?");
    values.push(email.value);
  }
  if (body.calendar_email !== undefined) {
    const calendarEmail = parseEmail(body.calendar_email);
    if (calendarEmail.error) return badRequest(calendarEmail.error);
    fields.push("calendar_email = ?");
    values.push(calendarEmail.value);
  }
  if (body.whatsapp !== undefined) {
    const whatsapp = parseWhatsapp(body.whatsapp);
    if (whatsapp.error) return badRequest(whatsapp.error);
    fields.push("whatsapp = ?");
    values.push(whatsapp.value);
  }
  if (typeof body.reminders === "boolean") {
    fields.push("reminders = ?");
    values.push(body.reminders ? 1 : 0);
  }
  if (typeof body.is_admin === "boolean") {
    fields.push("is_admin = ?");
    values.push(body.is_admin ? 1 : 0);
  }

  if (fields.length === 0) return badRequest("nothing to update");

  fields.push("updated_at = datetime('now')");
  values.push(id);

  let result;
  try {
    result = await env.DB.prepare(`UPDATE people SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE")) {
      return badRequest(`"${body.name}" is already on the roster`);
    }
    throw e;
  }

  if (result.meta.changes === 0) return notFound("person not found");
  waitUntil(syncAfterEdit(env)); // name, calendar account, status or reminders may change an invitation

  const person = await env.DB.prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`)
    .bind(id)
    .first();
  return json(shapePerson(person, true));
}
