import { json, requireAccess, sqliteUtcToIso } from "../_utils.js";
import { SQL } from "../_gcal.mjs";
import { bridgeFrom } from "../_gcal_runtime.mjs";

// What the admin planner needs to know about the reminder system: when the
// daily job last ran (so a silently stopped schedule is visible) and whether
// the LINE bot is configured on this deployment.
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const run = await env.DB.prepare("SELECT ran_at, sent, failed FROM reminder_runs ORDER BY id DESC LIMIT 1").first();
  // An admin only gets the to-do reminders if there is somewhere to send them,
  // so the planner can say so instead of the reminders silently not arriving.
  const admins = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(reminders = 1 AND (email IS NOT NULL OR line_user_id IS NOT NULL)), 0) AS reachable
     FROM people WHERE is_admin = 1 AND status = 'active'`
  ).first();
  // Google Calendar: connected at all, and how the last sync went.
  const google = { configured: !!bridgeFrom(env) };
  if (google.configured) {
    const state = (await env.DB.prepare(SQL.state).first()) || {};
    google.last_ok_at = sqliteUtcToIso(state.last_ok_at);
    google.last_error = state.last_error || null;
    google.last_error_at = sqliteUtcToIso(state.last_error_at);
  }
  return json({
    google,
    last_run: run ? { ran_at: sqliteUtcToIso(run.ran_at), sent: run.sent, failed: run.failed } : null,
    admins: { total: admins.total, reachable: admins.reachable },
    line_configured: !!(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
  });
}
