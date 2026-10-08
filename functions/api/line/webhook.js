import { json, badRequest, parseLinkCode } from "../_utils.js";

// LINE calls this URL whenever someone adds the bot, blocks it, or messages
// it. Its only job is linking a LINE account to a roster person: the person
// sends the one-time code the admin generated, and we store their LINE userId
// so the daily job can push reminders to them. Set the channel's Webhook URL to
// https://<your-site>/api/line/webhook.

const HELP_TEXT =
  "Assalamu'alaikum! This bot sends Jumat prayer reminders for NAIST.\n\n" +
  "To get them, ask the coordinator for your link code and send it here. It looks like: JMT-ABCD-2345";

// Anyone on the internet can POST here, so every request must carry a valid
// HMAC-SHA256 signature of the exact body, made with the channel secret.
// crypto.subtle.verify compares in constant time.
async function validSignature(rawBody, signature, secret) {
  let signatureBytes;
  try {
    signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(rawBody));
}

// Replies are free and don't count toward the monthly message quota. A failed
// reply must never fail the webhook (LINE would retry), so errors are swallowed.
async function reply(env, replyToken, text) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !replyToken) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
  } catch {
    // ignore
  }
}

async function handleEvent(event, env) {
  // One-to-one chats only; a bot dropped into a group can't link anyone.
  const userId = event.source?.type === "user" ? event.source.userId : null;
  if (!userId) return;

  if (event.type === "unfollow") {
    // Blocked or removed the bot: pushing to them would only fail.
    await env.DB.prepare("UPDATE people SET line_user_id = NULL WHERE line_user_id = ?").bind(userId).run();
    return;
  }

  if (event.type === "follow") {
    await reply(env, event.replyToken, HELP_TEXT);
    return;
  }

  if (event.type === "message" && event.message?.type === "text") {
    const code = parseLinkCode(event.message.text);
    if (!code) {
      await reply(env, event.replyToken, HELP_TEXT);
      return;
    }
    const person = await env.DB.prepare(
      "SELECT id, name FROM people WHERE line_link_code = ? AND line_link_expires > datetime('now')"
    )
      .bind(code)
      .first();
    if (!person) {
      await reply(env, event.replyToken, "That code isn't valid or has expired. Please ask the coordinator for a new one.");
      return;
    }
    await env.DB.prepare(
      "UPDATE people SET line_user_id = ?, line_link_code = NULL, line_link_expires = NULL WHERE id = ?"
    )
      .bind(userId, person.id)
      .run();
    await reply(
      env,
      event.replyToken,
      `✅ Linked! Hi ${person.name}, you'll get your Jumat khatib/imam reminders here.`
    );
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.LINE_CHANNEL_SECRET) return json({ error: "LINE is not configured" }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") || "";
  if (!(await validSignature(rawBody, signature, env.LINE_CHANNEL_SECRET))) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return badRequest("invalid body");
  }

  // The console's "Verify" button sends an empty events list.
  for (const event of payload.events || []) {
    try {
      await handleEvent(event, env);
    } catch {
      // One bad event must not block the rest or trigger a LINE retry storm.
    }
  }
  return json({ ok: true });
}
