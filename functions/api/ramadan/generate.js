import { json, badRequest, requireAccess } from "../_utils.js";
import { gatheringsToCreate } from "../_ramadan.mjs";
import { loadRamadan } from "./index.js";
import { syncAfterEdit } from "../_gcal_runtime.mjs";

// Admin: make the days from the dates and the weekly pattern. Days that already
// exist (maybe edited, maybe with a speaker) are never touched. With prune, days
// outside the dates (Ramadan moved, a typo) are removed.
export async function onRequestPost({ request, env, waitUntil }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));

  const { settings, pattern } = await loadRamadan(env);
  if (!settings.start_date || !settings.end_date) return badRequest("set the first and the last day of Ramadan first");

  const { results: existing } = await env.DB.prepare("SELECT date FROM gatherings").all();
  const rows = gatheringsToCreate({ settings, pattern, existingDates: existing.map((r) => r.date) });
  for (const g of rows) {
    await env.DB.prepare("INSERT INTO gatherings (date, place, start_time, kultum, reminders) VALUES (?, ?, ?, ?, ?)")
      .bind(g.date, g.place, g.start_time, g.kultum, g.reminders)
      .run();
  }
  let removed = 0;
  if (body && body.prune === true) {
    const r = await env.DB.prepare("DELETE FROM gatherings WHERE date < ? OR date > ?").bind(settings.start_date, settings.end_date).run();
    removed = r.meta.changes;
  }
  const outside = await env.DB.prepare("SELECT COUNT(*) AS n FROM gatherings WHERE date < ? OR date > ?").bind(settings.start_date, settings.end_date).first();
  waitUntil(syncAfterEdit(env));
  return json({ created: rows.length, already: existing.length, removed, outside: outside.n });
}
