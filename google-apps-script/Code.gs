/**
 * NAIST Jumat Scheduler - Google Calendar bridge.
 *
 * This small script runs inside the community Google account and does what the
 * website cannot do by itself: keep one Google Calendar event per Friday (with
 * the khatib, imam and the weekly announcement), invite people to it, and send
 * the occasional email. The website talks to it over HTTPS with a shared secret.
 * Setup: see "Google Calendar" in the project README.
 *
 * Script properties (Project Settings -> Script properties):
 *   SECRET       a long random string; the same one goes into the GitHub secret GCAL_BRIDGE_SECRET
 *   CALENDAR_ID  the id of the shared "NAIST Jumat" calendar
 * Services: add "Google Calendar API" (the Calendar service, version v3).
 */

var TIME_ZONE = "Asia/Tokyo";
var MAX_BODY = 8000;

function doGet() {
  return reply_({ ok: true, message: "NAIST Jumat Scheduler bridge. Requests must be POSTed." });
}

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: "bad request" });
  }

  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || request.secret !== secret) return reply_({ ok: false, error: "unauthorized" });

  try {
    switch (request.action) {
      case "ping":
        return reply_(ping_());
      case "upsert":
        return reply_(upsert_(request));
      case "delete":
        return reply_(delete_(request));
      case "mail":
        return reply_(mail_(request));
      default:
        return reply_({ ok: false, error: "unknown action" });
    }
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function reply_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function calendarId_() {
  var id = PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");
  if (!id) throw new Error("CALENDAR_ID is not set in the script properties");
  return id;
}

// Is the connection alive, and which calendar does it write to?
function ping_() {
  var calendar = Calendar.Calendars.get(calendarId_());
  return {
    ok: true,
    calendar_id: calendar.id,
    calendar_name: calendar.summary,
    time_zone: calendar.timeZone,
    mail_quota_left: MailApp.getRemainingDailyQuota(),
  };
}

// One event per Friday, with an id made from the Friday's own id: the same
// Friday can then never end up with two events, even if two updates arrive at the
// same moment. (Google event ids may use the letters a-v and digits.)
function eventId_(fridayId) {
  return "jumat" + String(fridayId).replace(/[^0-9]/g, "");
}

function message_(err) {
  return String(err && err.message ? err.message : err);
}

function isNotFound_(err) {
  return /not found|\b404\b|\b410\b|has been deleted/i.test(message_(err));
}

function isConflict_(err) {
  return /already exists|\b409\b|identifier/i.test(message_(err));
}

// Updates are handled one at a time.
function withLock_(work) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

// Create or update a Friday's event. `guests` are the people invited; guests
// added or removed get an invitation / cancellation, and send_updates "none"
// changes the event quietly (used when only the wording changed).
function upsert_(request) {
  var calendarId = calendarId_();
  var id = eventId_(request.friday_id);
  var resource = {
    summary: request.title,
    description: request.description,
    location: request.location || "",
    start: { dateTime: request.start, timeZone: TIME_ZONE },
    end: { dateTime: request.end, timeZone: TIME_ZONE },
    attendees: (request.guests || []).map(function (email) {
      return { email: email };
    }),
    // The calendar is public: keep the guest list to the organiser.
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    // Also brings back an event somebody deleted by hand in Google Calendar.
    status: "confirmed",
    extendedProperties: { private: { jumatFriday: String(request.friday_id) } },
  };
  var options = { sendUpdates: request.send_updates === "none" ? "none" : "all" };

  return withLock_(function () {
    try {
      var updated = Calendar.Events.patch(resource, calendarId, id, options);
      return { ok: true, created: false, event_id: updated.id };
    } catch (err) {
      if (!isNotFound_(err)) throw err;
    }
    try {
      var withId = JSON.parse(JSON.stringify(resource));
      withId.id = id;
      var created = Calendar.Events.insert(withId, calendarId, options);
      return { ok: true, created: true, event_id: created.id };
    } catch (err) {
      if (!isConflict_(err)) throw err;
    }
    // It exists after all (an earlier request created it a moment ago).
    var again = Calendar.Events.patch(resource, calendarId, id, options);
    return { ok: true, created: false, event_id: again.id };
  });
}

function delete_(request) {
  var calendarId = calendarId_();
  var id = eventId_(request.friday_id);
  return withLock_(function () {
    try {
      Calendar.Events.remove(calendarId, id, { sendUpdates: "all" });
      return { ok: true, deleted: true };
    } catch (err) {
      if (!isNotFound_(err)) throw err;
      return { ok: true, deleted: false };
    }
  });
}

// A plain email from this account (the website uses it to tell the admin that
// someone can't make it, at once).
function mail_(request) {
  var to = String(request.to || "");
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) throw new Error("invalid recipient");
  var subject = String(request.subject || "").replace(/[\r\n]+/g, " ").slice(0, 200);
  var body = String(request.body || "").slice(0, MAX_BODY);
  if (!subject || !body) throw new Error("subject and body are required");
  MailApp.sendEmail({ to: to, subject: subject, body: body, name: "NAIST Jumat Scheduler" });
  return { ok: true };
}
