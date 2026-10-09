import { badRequest, notFound } from "../_utils.js";
// The same file the page and the reminder job use, so the calendar event always
// has the same time and wording as the reminders.
import shared from "../../../public/reminder-message.js";

const { calendarLink, rolesFromCodes } = shared;

// /api/calendar/add?friday=12&roles=pi -> sends the person on to Google
// Calendar with a ready-made event for that Friday (roles: p = primary khatib,
// s = secondary, i = imam). Reminders link here instead of carrying the long
// Google address, and the venue is read when the link is opened, so a venue
// changed after the message went out is still right. It only ever redirects to
// calendar.google.com and uses nothing but the public schedule.
export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("friday"));
  if (!Number.isInteger(id) || id <= 0) return badRequest("friday is required");

  const friday = await env.DB.prepare("SELECT id, date, venue FROM fridays WHERE id = ?").bind(id).first();
  if (!friday) return notFound("friday not found");

  const roles = rolesFromCodes(params.get("roles"));
  return Response.redirect(calendarLink({ friday, roles }), 302);
}
