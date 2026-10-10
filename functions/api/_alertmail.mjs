// The "can't make it" email to the admin. Pure functions, shared by the reminder
// job (which sends it over Gmail SMTP) and by the website's Functions (which can
// send it at once through the Google bridge).
import shared from "../../public/reminder-message.js";

const { formatDateLong, formatDateShort, whenPhrase } = shared;

// "Khatib: A / B (Secondary)" and "Imam: C" lines for a Friday row.
export function lineupLines(friday) {
  const lines = [];
  if (friday.primary_name && friday.secondary_name) {
    lines.push(`Khatib: ${friday.primary_name} / ${friday.secondary_name} (Secondary)`);
  } else if (friday.primary_name) {
    lines.push(`Khatib: ${friday.primary_name}`);
  } else if (friday.secondary_name) {
    lines.push(`Khatib: ${friday.secondary_name} (Secondary)`);
  }
  if (friday.imam_name) lines.push(`Imam: ${friday.imam_name}`);
  return lines;
}

// Who should be told when a scheduled person says they can't make it: active
// admins with an email address who have not switched their reminders off.
export function alertRecipients(people) {
  return people.filter((p) => p.is_admin && p.status === "active" && p.reminders && p.email);
}

// `alert` carries person_name and roles; `friday` the date, venue and the
// current line-up names (primary_name / secondary_name / imam_name).
export function buildAlertEmail({ alert, friday, admin, days, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${admin.reminder_token}`;
  const lineup = lineupLines(friday);
  const text = [
    `Assalamu'alaikum ${admin.name},`,
    "",
    `${alert.person_name} has marked themselves unavailable for ${formatDateLong(friday.date)} (${whenPhrase(days)}).`,
    `They were scheduled as: ${alert.roles}.`,
    "",
    ...(lineup.length ? ["Line-up now:", ...lineup.map((l) => `  ${l}`), ""] : []),
    "A replacement is needed: open the Admin planner, pick someone else for that slot, and send them the reminder.",
    siteUrl,
    "",
    "--",
    "You get this because you are marked as an admin on the NAIST Jumat roster.",
    `Stop these reminders: ${unsubscribeUrl}`,
  ].join("\n");
  return {
    subject: `Jumat alert: ${alert.person_name} can't make it on ${formatDateShort(friday.date)}`,
    text,
    unsubscribeUrl,
  };
}

// One "can't make it" alert with its Friday and the current line-up names. Add
// a WHERE clause (by alert id, or the ones still to be emailed).
export const ALERT_ROW_SELECT = `
  SELECT a.id AS alert_id, a.roles, p.name AS person_name,
         f.id, f.date, f.venue,
         COALESCE(pp.name, f.primary_khatib_name) AS primary_name,
         COALESCE(sp.name, f.secondary_khatib_name) AS secondary_name,
         COALESCE(ip.name, f.imam_name) AS imam_name
  FROM availability_alerts a
  JOIN fridays f ON f.id = a.friday_id
  JOIN people p ON p.id = a.person_id
  LEFT JOIN people pp ON pp.id = f.primary_khatib_id
  LEFT JOIN people sp ON sp.id = f.secondary_khatib_id
  LEFT JOIN people ip ON ip.id = f.imam_id`;
