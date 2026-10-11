import { json, badRequest, requireAccess } from "../_utils.js";
import { todayInJapan } from "../_alerts.mjs";
import { parseRamadan, parseReminderDays, GATHERING_SELECT, shapeGathering, addDays } from "../_ramadan.mjs";

export async function loadRamadan(env) {
  const s = await env.DB.prepare("SELECT start_date, end_date, default_start, kultum_minutes, event_minutes, reminder_days FROM ramadan_settings WHERE id = 1").first();
  const settings = { ...s, reminder_days: parseReminderDays(s.reminder_days) };
  const { results: pattern } = await env.DB.prepare("SELECT weekday, active, place, start_time, kultum, reminders FROM ramadan_pattern ORDER BY weekday").all();
  return { settings, pattern: pattern.map((p) => ({ ...p, active: !!p.active, kultum: !!p.kultum, reminders: !!p.reminders })) };
}

// Public, like the schedule itself: Ramadan's dates, the weekly pattern, and the days
// (from a week ago on). No contact details here, only names already shown on the page.
export async function onRequestGet({ env }) {
  const { settings, pattern } = await loadRamadan(env);
  const from = addDays(todayInJapan(), -7);
  const { results } = await env.DB.prepare(`${GATHERING_SELECT} WHERE g.date >= ? ORDER BY g.date ASC`).bind(from).all();
  return json({ settings, pattern, gatherings: results.map((row) => shapeGathering(row, settings)) });
}

// Admin: save the dates, the times and the weekly pattern.
export async function onRequestPut({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;
  const parsed = parseRamadan(await request.json().catch(() => null));
  if (parsed.error) return badRequest(parsed.error);

  const s = parsed.settings;
  await env.DB.prepare("UPDATE ramadan_settings SET start_date = ?, end_date = ?, default_start = ?, kultum_minutes = ?, event_minutes = ?, reminder_days = ? WHERE id = 1")
    .bind(s.start_date, s.end_date, s.default_start, s.kultum_minutes, s.event_minutes, s.reminder_days)
    .run();
  for (const p of parsed.pattern) {
    await env.DB.prepare("UPDATE ramadan_pattern SET active = ?, place = ?, start_time = ?, kultum = ?, reminders = ? WHERE weekday = ?")
      .bind(p.active, p.place, p.start_time, p.kultum, p.reminders, p.weekday)
      .run();
  }
  return json(await loadRamadan(env));
}
