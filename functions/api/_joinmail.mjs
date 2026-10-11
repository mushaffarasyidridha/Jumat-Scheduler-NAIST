// The "someone asks to be added to the roster" email to the admin. Pure functions,
// shared by the reminder job (Gmail SMTP) and the website's Functions (at once,
// through the Google bridge).
export const AFFILIATION_LABELS = {
  naist_student: "NAIST student",
  naist_staff: "NAIST staff",
  dependent: "Dependent (e.g. spouse of a student)",
  outside: "Outside NAIST",
};
export const ROLE_LABELS = { khatib: "Khatib", imam: "Imam", both: "Khatib and imam" };

// Same people as the "can't make it" alert: active admins with an email and reminders on.
export function joinRecipients(people) {
  return people.filter((p) => p.is_admin && p.status === "active" && p.reminders && p.email);
}

// `request` is a join_requests row. Contains the requester's own details, so it
// goes only to the admins and is never printed in the job's log.
export function buildJoinEmail({ request, admin, siteUrl }) {
  const unsubscribeUrl = `${siteUrl}/api/reminders/unsubscribe?t=${admin.reminder_token}`;
  const line = (label, value) => (value ? [`  ${label}: ${value}`] : []);
  const text = [
    `Assalamu'alaikum ${admin.name},`,
    "",
    `${request.name} could not find their name on the Jumat website and sent these details to be added to the roster:`,
    "",
    ...line("Name", request.name),
    ...line("Who", AFFILIATION_LABELS[request.affiliation]),
    ...line("Country", request.country),
    ...line("Can serve as", ROLE_LABELS[request.role]),
    ...line("Email", request.email),
    ...line("WhatsApp", request.whatsapp),
    ...line("Note", request.note),
    "",
    "To add them: open the Admin planner, find the box \"asks to be added\", press Add to roster, check the details and save. Then tell them to pick their name under \"You are\".",
    siteUrl,
    "",
    "--",
    "You get this because you are marked as an admin on the NAIST Jumat roster.",
    `Stop these emails: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Jumat: ${request.name} asks to be added to the roster`, text, unsubscribeUrl };
}

export const JOIN_ROW_SELECT = "SELECT id, name, affiliation, country, role, email, whatsapp, note FROM join_requests";
