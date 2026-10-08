import { json, requireAccess, sqliteUtcToIso } from "../_utils.js";

// What the admin planner needs to know about the reminder system: when the
// daily job last ran (so a silently stopped schedule is visible) and whether
// the LINE bot is configured on this deployment.
export async function onRequestGet({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const run = await env.DB.prepare("SELECT ran_at, sent, failed FROM reminder_runs ORDER BY id DESC LIMIT 1").first();
  return json({
    last_run: run ? { ran_at: sqliteUtcToIso(run.ran_at), sent: run.sent, failed: run.failed } : null,
    line_configured: !!(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
  });
}
