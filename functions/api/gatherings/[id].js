import { json, badRequest, notFound, requireAccess } from "../_utils.js";
import { parseGathering, GATHERING_SELECT, shapeGathering } from "../_ramadan.mjs";
import { loadRamadan } from "../ramadan/index.js";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

// Admin: change one day (place, time, kultum, speaker, reminders, note).
export async function onRequestPatch({ request, env, params, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  if (!(await env.DB.prepare("SELECT id FROM gatherings WHERE id = ?").bind(id).first())) return notFound("day not found");

  const g = parseGathering(await request.json().catch(() => null), { requireDate: false });
  if (g.error) return badRequest(g.error);
  if (g.speaker_id && !(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(g.speaker_id).first())) return badRequest("that person is not on the roster");
  if (g.date && (await env.DB.prepare("SELECT id FROM gatherings WHERE date = ? AND id <> ?").bind(g.date, id).first())) return json({ error: "another day already has that date" }, { status: 409 });

  const fields = Object.keys(g);
  if (!fields.length) return badRequest("nothing to update");
  await env.DB.prepare(`UPDATE gatherings SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...fields.map((f) => g[f]), id)
    .run();
  const { settings } = await loadRamadan(env);
  const row = await env.DB.prepare(`${GATHERING_SELECT} WHERE g.id = ?`).bind(id).first();
  waitUntil(syncAfterEdit(env));
  return json(shapeGathering(row, settings));
}

export async function onRequestDelete({ request, env, params, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const result = await env.DB.prepare("DELETE FROM gatherings WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return notFound("day not found");
  waitUntil(syncAfterEdit(env));
  return json({ ok: true });
}
