import { json, checkAccess } from "./_utils.js";

// Lets the UI verify a code before unlocking edit controls, rather than
// optimistically trusting whatever the person typed until their first
// real write fails.
export async function onRequestGet({ request, env }) {
  return json({ authorized: checkAccess(request, env) });
}
