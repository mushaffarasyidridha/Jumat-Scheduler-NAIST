import { json } from "../_utils.js";
import { SQL } from "../_gcal.mjs";
import { bridgeFrom } from "../_gcal_runtime.mjs";

// Public: is the shared Google calendar connected, and which one is it? The home
// page uses it to offer "Add to Google Calendar" for the public calendar. The id
// of a public calendar is public anyway (it is in every link to it).
export async function onRequestGet({ env }) {
  if (!bridgeFrom(env)) return json({ google: null });
  const state = await env.DB.prepare(SQL.state).first();
  return json({ google: state && state.calendar_id ? { calendar_id: state.calendar_id } : null });
}
