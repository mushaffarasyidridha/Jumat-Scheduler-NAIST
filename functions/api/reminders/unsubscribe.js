// Target of the "stop these reminders" link in every email.
//
// GET only shows a confirmation button, because mail scanners and link
// previewers fetch links automatically and must not unsubscribe anyone. The
// POST does the work; it also serves mail clients' one-click unsubscribe
// (RFC 8058), which POSTs straight to the URL in the List-Unsubscribe header.
// The token is a per-person secret carried in the query string.

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(body, status = 200) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jumat reminders</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  button { font: inherit; padding: .6rem 1.2rem; border-radius: 8px; border: 1px solid #1f7a5c; background: #1f7a5c; color: #fff; cursor: pointer; }
  .muted { opacity: .7; font-size: .9rem; }
</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}

const invalid = () => page("<h1>Link not valid</h1><p>This unsubscribe link isn't valid. Please contact the coordinator.</p>", 404);

function tokenOf(request) {
  const token = new URL(request.url).searchParams.get("t") || "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function onRequestGet({ request, env }) {
  const token = tokenOf(request);
  if (!token) return invalid();
  const person = await env.DB.prepare("SELECT name, reminders FROM people WHERE reminder_token = ?").bind(token).first();
  if (!person) return invalid();

  if (!person.reminders) {
    return page(`<h1>Already stopped</h1><p>${escapeHtml(person.name)} isn't receiving Jumat reminders.</p>`);
  }
  return page(`
    <h1>Stop Jumat reminders?</h1>
    <p>You will no longer get khatib/imam reminders for <strong>${escapeHtml(person.name)}</strong>. You can still be put on the schedule, and the coordinator can switch reminders back on.</p>
    <form method="post" action="/api/reminders/unsubscribe?t=${token}"><button type="submit">Stop reminders</button></form>`);
}

export async function onRequestPost({ request, env }) {
  const token = tokenOf(request);
  if (!token) return invalid();
  const result = await env.DB.prepare("UPDATE people SET reminders = 0, updated_at = datetime('now') WHERE reminder_token = ?")
    .bind(token)
    .run();
  if (result.meta.changes === 0) return invalid();
  return page(`<h1>Done</h1><p>You won't get Jumat reminders anymore.</p><p class="muted">Changed your mind? Ask the coordinator to switch them back on.</p>`);
}
