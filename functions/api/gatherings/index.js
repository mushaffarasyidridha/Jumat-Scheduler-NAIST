import { json, badRequest, requireAccess } from "../_utils.js";
import { parseGathering, GATHERING_SELECT, shapeGathering } from "../_ramadan.mjs";
import { loadRamadan } from "../ramadan/index.js";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

// Admin: add one extra day by hand (a day the pattern does not cover).
export async function onRequestPost({ request, env, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const g = parseGathering(await request.json().catch(() => null), { requireDate: true });
  if (g.error) return badRequest(g.error);
  const { settings, pattern } = await loadRamadan(env);

  const same = await env.DB.prepare("SELECT id FROM gatherings WHERE date = ?").bind(g.date).first();
  if (same) return json({ error: "that day already exists" }, { status: 409 });
  const weekday = new Date(`${g.date}T00:00:00Z`).getUTCDay();
  const row = pattern.find((p) => p.weekday === weekday);
  const result = await env.DB.prepare("INSERT INTO gatherings (date, place, start_time, kultum, reminders) VALUES (?, ?, ?, ?, ?)")
    .bind(g.date, g.place ?? row?.place ?? null, g.start_time ?? row?.start_time ?? settings.default_start, g.kultum ?? (row?.kultum ? 1 : 0), g.reminders ?? 1)
    .run();
  const created = await env.DB.prepare(`${GATHERING_SELECT} WHERE g.id = ?`).bind(result.meta.last_row_id).first();
  waitUntil(syncAfterEdit(env));
  return json(shapeGathering(created, settings), { status: 201 });
}
