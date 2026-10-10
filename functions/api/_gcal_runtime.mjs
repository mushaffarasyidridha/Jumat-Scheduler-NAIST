// Glue between the Pages Functions (env.DB, request, env secrets) and the Google
// sync code in _gcal.mjs.
import { createBridge, syncUpcoming, emailAlertViaBridge } from "./_gcal.mjs";
import { todayInJapan } from "./_alerts.mjs";
import { siteUrlFrom } from "./_site.mjs";

// null until both secrets are set: until then nothing here does anything, so
// the site works exactly as before.
export function bridgeFrom(env) {
  return env.GCAL_BRIDGE_URL && env.GCAL_BRIDGE_SECRET
    ? createBridge({ url: env.GCAL_BRIDGE_URL, secret: env.GCAL_BRIDGE_SECRET })
    : null;
}

export function dbFrom(env) {
  return {
    async all(sql, params = []) {
      return (await env.DB.prepare(sql).bind(...params).all()).results;
    },
    async run(sql, params = []) {
      const result = await env.DB.prepare(sql).bind(...params).run();
      return { changes: result.meta.changes };
    },
  };
}

// Bring Google up to date after something changed on the website. Meant for
// waitUntil(): the edit is already saved, and a failure here is only recorded
// (the planner shows it, and the reminder job retries at its next run).
export async function syncAfterEdit(env) {
  const bridge = bridgeFrom(env);
  if (!bridge) return;
  try {
    await syncUpcoming({
      bridge,
      db: dbFrom(env),
      siteUrl: siteUrlFrom(env),
      today: todayInJapan(),
    });
  } catch (e) {
    console.error("Google Calendar sync failed:", e?.message || e);
  }
}

export async function emailAlertNow(env, alertId) {
  const bridge = bridgeFrom(env);
  if (!bridge) return false;
  try {
    return await emailAlertViaBridge({
      bridge,
      db: dbFrom(env),
      alertId,
      siteUrl: siteUrlFrom(env),
      today: todayInJapan(),
    });
  } catch (e) {
    console.error("Alert email via the Google bridge failed:", e?.message || e);
    return false;
  }
}
