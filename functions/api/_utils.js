export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

// Shared community passcode gate for any mutating request (POST/PATCH/DELETE).
// Reading the schedule stays public; editing it requires the code the mosque
// group shares internally. Set via `wrangler pages secret put ACCESS_CODE`.
export function checkAccess(request, env) {
  const configured = env.ACCESS_CODE;
  if (!configured) return true; // no code configured yet -> leave open
  const provided = request.headers.get("x-access-code") || "";
  return provided === configured;
}

export function requireAccess(request, env) {
  if (!checkAccess(request, env)) {
    return json({ error: "Invalid or missing access code" }, { status: 401 });
  }
  return null;
}

// Next `count` Fridays strictly after `from` (a Date), as ISO yyyy-mm-dd strings.
export function upcomingFridays(from, count) {
  const dates = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const dayOfWeek = d.getUTCDay(); // 0=Sun .. 5=Fri
  let offset = (5 - dayOfWeek + 7) % 7;
  if (offset === 0) offset = 7; // always strictly future, never "today"
  d.setUTCDate(d.getUTCDate() + offset);
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return dates;
}
