import { json, requireAccess } from "../_utils.js";
import { syncUpcoming } from "../_gcal.mjs";
import { bridgeFrom, dbFrom } from "../_gcal_runtime.mjs";
import { todayInJapan } from "../_alerts.mjs";
import { siteUrlFrom } from "../_site.mjs";

// The admin's "Sync now": make Google match the schedule right away, and say how
// it went. Also the way to fill the calendar the first time.
export async function onRequestPost({ request, env }) {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const bridge = bridgeFrom(env);
  if (!bridge) return json({ configured: false });

  const result = await syncUpcoming({
    bridge,
    db: dbFrom(env),
    siteUrl: siteUrlFrom(env),
    today: todayInJapan(),
    forcePing: true,
  });
  return json({ configured: true, ...result });
}
