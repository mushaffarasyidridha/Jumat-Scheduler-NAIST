import { json } from "../_utils.js";
import { ensureUpcomingRows, FRIDAY_SELECT as SELECT } from "../_fridays.js";

export async function onRequestGet({ request, env }) {
  await ensureUpcomingRows(env);

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope"); // "history" | "upcoming" | omitted = both

  let where = "";
  if (scope === "history") where = "WHERE f.is_history = 1";
  if (scope === "upcoming") where = "WHERE f.is_history = 0";

  const { results } = await env.DB.prepare(`${SELECT} ${where} ORDER BY f.date ASC`).all();
  return json(results);
}
