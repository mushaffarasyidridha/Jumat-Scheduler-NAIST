# Jumat Scheduler — NAIST

A small, always-on, free website for scheduling the Friday prayer (Jumat) khatib
and imam at NAIST. Anyone with the link can view the schedule; anyone with the
community access code can mark their availability, assign themselves or a
friend as khatib for an open slot, and manage the roster — from anywhere, not
just on campus.

Built on the schedule kept in `Friday_prayer_khatib_schedule_NAIST.xlsx`
(2022–2025). That spreadsheet stops at the end of 2025; this app's job going
forward is to keep generating and filling in the upcoming Fridays that the
spreadsheet never covered.

## The guide: flowcharts of the whole system

**https://jumat-scheduler-naist.pages.dev/guide** (also the "📖 How this system works"
link at the bottom of the site). Flowcharts for members, for the admin, for what runs by
itself, for handing over to a new admin and for connecting Google Calendar, plus the exact
list of pages, tables, jobs and settings read from the code. The same guide as Markdown, with
the flowcharts drawn by GitHub, is `docs/GUIDE.md`.

It is kept current on purpose: the flowcharts are in `public/flows/*.mmd`, the wording in
`public/flows/guide.json`, and `npm test` fails if the generated parts (`npm run docs`) or the
descriptions of a new page or setting are missing. Whenever you change how the system behaves,
change the matching flowchart in the same commit (see `CLAUDE.md`).

## How it works

- **Frontend**: static HTML/CSS/vanilla JS in `public/` — no build step, no framework.
- **API**: Cloudflare Pages Functions in `functions/api/` (plain JS, one file per route).
- **Database**: Cloudflare D1 (serverless SQLite), schema in `migrations/`.
- **Hosting**: Cloudflare Pages free tier — no sleep, no inactivity pause, unlike
  most other free hosts (Render/Heroku free dynos sleep; Supabase free
  projects pause after a week of no traffic). This is what makes "always
  online, always free" realistic for a low-traffic community site.

Read access (viewing the schedule and roster) is public. Any request that
changes data (assigning a khatib, marking availability, editing the roster)
must include the shared `ACCESS_CODE` you set below — this keeps randoms who
find the link from editing it, while staying simple enough for a group that
just shares a passcode in their chat.

## One-time setup (all free)

You'll need a free Cloudflare account. Total cost: $0/month for this app's traffic.

1. **Create a Cloudflare account** at https://dash.cloudflare.com/sign-up if you
   don't have one.

2. **Get your Account ID.** In the Cloudflare dashboard, open *Workers & Pages*
   — your Account ID is shown on the right side of that page.

3. **Create an API token.** Go to *My Profile → API Tokens → Create Token*.
   Use the "Edit Cloudflare Workers" template, or a custom token with:
   - Account → D1 → Edit
   - Account → Cloudflare Pages → Edit

4. **Install Wrangler and log in locally** (one-time, to create the database):
   ```bash
   npm install
   npx wrangler login
   ```

5. **Create the D1 database:**
   ```bash
   npx wrangler d1 create jumat-scheduler-naist-db
   ```
   This prints a `database_id`. Paste it into `wrangler.toml` in place of
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`, then commit and push that change.

6. **Create the Pages project:**
   ```bash
   npx wrangler pages project create jumat-scheduler-naist --production-branch=main
   ```

7. **Set your community access code** (pick something easy to share, e.g. in
   your WhatsApp/Telegram group):
   ```bash
   npx wrangler pages secret put ACCESS_CODE --project-name=jumat-scheduler-naist
   ```

8. **Add two GitHub Actions secrets** so pushes auto-deploy: in the GitHub repo,
   go to *Settings → Secrets and variables → Actions* and add:
   - `CLOUDFLARE_API_TOKEN` — the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID` — the ID from step 2

9. **Push to `main`.** The workflow in `.github/workflows/deploy.yml` applies
   the D1 migrations (schema + the seeded roster/history) and deploys the
   site automatically. Every future push to `main` redeploys the same way —
   no manual steps after this.

10. Your site is live at `https://jumat-scheduler-naist.pages.dev` (Cloudflare
    also lets you attach a free custom domain later if you want one).

If the deployed API ever errors with something like "DB is not defined,"
open the Pages project in the Cloudflare dashboard → *Settings → Functions*
and confirm the `DB` D1 binding is attached (it's normally picked up
automatically from `wrangler.toml`, but older Pages projects sometimes need
it set once by hand).

## Subscribe to the schedule (Google Calendar, Apple, Outlook)

The schedule is also published as a calendar feed at `/api/calendar/jumat.ics`. Everyone with a
Google account (NAIST students and staff) can add it once, from the **Add the Jumat schedule to
your calendar** box under the calendar on the home page. The khatib and imam of every Friday then
appear in their own calendar and update by themselves, with no need to open the site.

- Each Friday is one event, **12.35 to 13.05**, titled with the khatib and imam. Its description is
  **the weekly announcement itself** (the same text as *Generate announcement*, with that week's
  hadith) plus a *Can't make it?* link (see below). It covers last week and the next 16 weeks, and
  carries only what the public schedule page already shows (no contact details). The events do not
  mark a subscriber as busy.
- **Google refreshes subscribed calendars only every few hours** (nothing here can force it), so a
  last-minute change can take a while to show there. The home page and the weekly announcement stay
  the source of truth. If Google ever seems stuck, remove and re-add the calendar.
- It is a standard feed, so Apple Calendar and Outlook work too (*Apple / Outlook* button), or paste the
  link under *Other calendars → From URL* in Google Calendar.
- People without a Google account keep using what exists: the home page, the weekly announcement in the
  WhatsApp / Facebook groups, and the reminders by email / LINE / hand.
- This is separate from the per-person *Add to Google Calendar* link in each reminder (see below), which
  puts one specific duty, with its role, on that person's own calendar.
- Once the shared Google Calendar (next section) is connected, the home page offers that calendar first,
  because Google updates it at once; this feed then stays for Apple Calendar and Outlook.

## Google Calendar (a live shared calendar, with invitations)

Besides the read-only feed above, the site can keep a real **Google Calendar** up to date: one event per
Friday, **12.35 to 13.05**, titled with the khatib and imam, whose description is the weekly announcement
plus the *Can't make it?* link. It is public (anyone can open or add it), and:

- **It follows the website.** Assign a khatib, change the venue, rename someone: the event is updated within
  a minute (and the planner says when it last was, with a *Sync now* button). The reminder job re-checks twice
  a day, so a missed update is repaired.
- **It invites people.** In the roster, *Edit* a person and fill in **NAIST Google account**. Whoever is
  scheduled (primary, secondary or imam) with an account saved, and with their reminders on, is invited to
  that Friday; take the account away, move them, or replace them and the invitation is updated or cancelled.
  Changes that only reword the event (a different khatib's name in the title) are made quietly; changes to the
  guests, the time or the venue notify the guests.
- **The guest list is hidden** (guests cannot see each other, and Google's help says guest lists are not shown on
  a public calendar for such events: check it once in a private browser window, see step 9).
- **Reminders for invited people are their own calendar notifications** (Google sets them per person; the
  site cannot). The automatic email / LINE reminders and the *Add to Google Calendar* links work as before.

Google only lets a signed-in account invite people, and a plain Gmail account has no simple "API key" for
that. So the site talks to a tiny **Apps Script** (`google-apps-script/Code.gs`) that runs inside the community
Google account and does the calendar work for it. It needs no Google Cloud project, no OAuth client and no
refresh tokens that expire. Until you set it up, nothing about Google changes on the site.

### Set it up (about 15 minutes, once; sign in as the community Google account)

1. **Create the calendar.** In Google Calendar, *Other calendars* → **+** → *Create new calendar*. Name it
   "NAIST Jumat", time zone *Japan Standard Time*. Open its *Settings and sharing*: under *Access permissions
   for events* tick **Make available to public** and choose **See all event details**. Under *Integrate
   calendar*, copy the **Calendar ID** (it ends in `@group.calendar.google.com`).
2. **Create the script.** At <https://script.google.com> choose *New project*, name it "Jumat bridge", delete the
   sample code and paste in the whole of `google-apps-script/Code.gs`. Save.
3. **Add the Calendar service.** In the left bar next to *Services* press **+**, choose **Google Calendar API**
   and *Add* (leave the identifier `Calendar` and version `v3`).
4. **Script properties.** *Project Settings* (gear) → *Script properties* → add two:
   `SECRET` (a long random text, 40+ characters; you will paste the same text into GitHub) and `CALENDAR_ID`
   (from step 1).
5. **Deploy it as a web app.** *Deploy* → *New deployment* → type **Web app** → *Execute as*: **Me** → *Who has
   access*: **Anyone** → *Deploy*. Google asks you to authorise it (*Review permissions* → your account →
   *Advanced* → *Go to Jumat bridge (unsafe)* → *Allow*: the script is yours, it only needs your calendar and
   to send email). Copy the **Web app URL** (it ends in `/exec`). "Anyone" is needed so the site can call it;
   what protects it is the `SECRET`, which every request must carry.
6. **GitHub secrets** (*Settings → Secrets and variables → Actions*; never paste them into a chat):
   `GCAL_BRIDGE_URL` = the Web app URL, `GCAL_BRIDGE_SECRET` = the `SECRET` text.
7. **Pass them to the website:** *Actions → One-time Cloudflare setup → Run workflow* (it copies the two secrets),
   then *Actions → Deploy to Cloudflare Pages → Run workflow*.
8. **Check it and fill the calendar:** *Actions → Send Jumat reminders → Run workflow*, tick **google_check**.
   The log should say `Google Calendar connection OK` and `N Friday(s) updated`. (From then on the planner
   shows the status and *Sync now*.) If it says *unauthorized*, the two `SECRET` texts differ; if it says the
   bridge "did not answer with JSON", the web app is not deployed for *Anyone*.
9. **Check the privacy once.** Open the calendar's public link (the home page button *Open it in your browser*)
   in a private browser window: you should see the events with the announcement text, and **no guest list**.

Links inside the events (the *Can't make it?* link) always point to `https://jumat-scheduler-naist.pages.dev`,
whichever address someone edited from. If the site ever gets its own domain, set `SITE_URL` to it as a GitHub
*variable* (Settings → Secrets and variables → Actions → Variables) and as an environment variable of the
Cloudflare Pages project.

Changing `Code.gs` later: paste the new code, then *Deploy → Manage deployments → Edit → New version* (the
Web app URL stays the same). Limits worth knowing: a plain Gmail account may send about 100 emails a day through
a script (the alert emails use this), and only what changed is sent to Google, so normal use stays far below
Google's quotas.

## "Can't make it" (and the alert to the admin)

Every calendar event ends with a link, `<site>/?friday=ID`. Whoever is scheduled and can't come opens it,
picks their name and presses **I can't make it**. No access code is needed (marking your own availability
never needs one). From then on:

- **On the website**, the Admin planner shows a red box at the top ("Ahmad can't make it on Friday, 16
  October (Primary khatib)") and a ⚠ badge on that Friday. **Find a replacement** jumps to the Friday;
  **Got it** removes the alert.
- **By email**, every admin (*Admin this period*, with an email address and reminders on) gets a short message
  with the person, the date, the role and the line-up now. With the Google Calendar connection (below) it is
  sent at once; without it, the reminder job sends it with its next run (about 08:23 or 14:23 JST). If an email
  fails it is retried at the next run.
- It is only raised for someone who really is scheduled that Friday, for a Friday that has not passed. If they
  say they are available again, or you put someone else in their slot, the alert disappears by itself.

## Reminders (automatic email, plus copy / WhatsApp by hand)

**Automatic, by email.** Every morning (about 08:30 Japan time, plus a catch-up
run at about 14:30), a GitHub Actions job (`.github/workflows/reminders.yml`)
emails everyone scheduled as primary khatib, secondary khatib (told they are
standby) or imam: **7 days before** their Friday and again **the day before**.
It uses the community Gmail account (app password) and only reaches people who
have an email address in their roster entry.

GitHub starts scheduled jobs when it has capacity, so "about" can mean minutes
or, at busy moments, hours late. Reminders are therefore for the *day before*
(plenty of slack). A reminder for a prayer that is *today* is dropped after
11:00 Japan time, because by then it would be too late to help.

**By hand, for everyone else.** In the **Admin planner**, every assigned person
has two buttons:

- **📋 Copy reminder** puts the reminder text on your clipboard, to paste into
  any chat (LINE, WhatsApp, Facebook, SMS...). It is exactly the text the
  automatic reminders use.
- **💬 WhatsApp** opens WhatsApp with that text already typed for that person;
  you just press send. It appears once you save their WhatsApp number in the
  roster (*Edit → WhatsApp number*, international format with `+`, e.g.
  `+81 90 1234 5678`: leave out the `0` after the country code).

Nothing is automated for WhatsApp, Facebook or LINE: WhatsApp's API bills per
message and needs a Meta business account, Facebook Messenger only lets a Page
message someone who messaged it in the last 24 hours, and LINE needs an Official
Account (which asks for a phone number). The two buttons above avoid all of that.
LINE can still be switched on later (see *LINE (optional)* below); the page hides
everything about it until its two secrets are set.

**Google Calendar.** Every reminder (the emails, the LINE message, and the text from
*Copy reminder* / *WhatsApp*) has an **Add to Google Calendar** link. It opens a ready-made
event (12.35 pm, the venue, the person's role) in their Google Calendar; they press Save, and
Google then reminds them with their own calendar notifications. The link is short
(`/api/calendar/add?friday=…`) and reads the Friday's venue when it is opened, so a venue
changed after the message went out is still right. The event runs 12.35 to 13.05
(`PRAYER_START` and `PRAYER_DURATION_MIN` in `public/reminder-message.js`).
It needs no Google account setup on our side, because the person adds the event themselves.

Nobody is emailed until you give them an address. Every email has a "stop these
reminders" link, and each person has an *automatic email reminders* switch in
Edit. A delivered reminder is logged in the database, so nothing is sent twice.
The two manual buttons always work, whatever that switch says.

### Admin to-do (the reminder for whoever is admin)

Nothing can send WhatsApp or Facebook messages, or post in your WhatsApp / Facebook
groups, for you. So the admin gets a **to-do reminder** instead, by email and/or LINE:

- **A week before** each Friday: who to message by hand (people with no email or LINE,
  or with their reminders switched off, or a guest typed in as free text), and which
  khatib / imam slot is still empty. If there is nothing to do, nothing is sent.
- **The day before**: the same list, plus *post the announcement in the WhatsApp group
  and the Facebook group*.

It goes out with the other reminders (the morning job, with the afternoon run as a
catch-up) and is logged the same way, so it is never sent twice. The buttons to do the
work are in the Admin planner: **Copy reminder / WhatsApp** under each assigned person,
and **Generate announcement** when you open the Friday on the calendar.

Who is admin is a setting, not fixed in the code: in the roster, *Edit* a person and tick
**Admin this period** (they need an email or a LINE link to be reachable). When the role
changes hands, untick the old admin and tick the new one; several admins at once is fine.
The planner shows a warning if nobody is set, or the admin can't be reached. The admin's
*automatic email reminders* switch (and the unsubscribe link) turns these off too.

### Set up email

1. In the community Gmail account, turn on **2-Step Verification** (Google Account → Security).
2. Still under Security → 2-Step Verification, create an **App password** (any name,
   e.g. "Jumat scheduler"). Google shows 16 characters once.
3. In GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   - `GMAIL_USER` — the Gmail address
   - `GMAIL_APP_PASSWORD` — the 16 characters
   Never paste the app password into a chat or commit it; if it leaks, delete it in your Google account.
4. *Actions → Send Jumat reminders → Run workflow*, tick **test_email_to_sender** and run it: one test
   email is sent to the community Gmail itself (open that inbox, and check spam the first time). Nothing to
   type. You can instead type another address in **test_email**, but this repository is public and the run page
   may show what you typed. If you can't see the *Run workflow* button on a phone, try the browser's
   "Desktop site" view. Replies to reminders land in this Gmail inbox.

### LINE (optional, off unless you set it up)

Not needed for email or the manual buttons. LINE can only message people who added your
bot, and creating the bot needs a LINE Official Account, which asks for a phone number.

1. Open <https://developers.line.biz/console/>, create a *Provider*, then a **Messaging API** channel
   (this also creates the LINE Official Account).
2. On the channel's *Basic settings* tab copy the **Channel secret**. On the *Messaging API* tab issue a
   **Channel access token (long-lived)**.
3. Add both as GitHub secrets: `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`.
4. *Actions → One-time Cloudflare setup → Run* (copies the two secrets to the website), then
   *Actions → Deploy to Cloudflare Pages → Run* so the site picks them up.
5. In the LINE console set the **Webhook URL** to `https://jumat-scheduler-naist.pages.dev/api/line/webhook`,
   switch *Use webhook* on and press *Verify*. In LINE Official Account Manager → *Response settings*, turn
   off *Auto-response* and *Greeting message* so LINE doesn't send its own canned replies.
6. For each person: roster → *Edit* → **Get LINE link code**. The person adds the bot (QR code on the
   *Messaging API* tab) and sends it the code. Press *Check if linked* to confirm.

### Checking the automatic email

- *Actions → Send Jumat reminders → Run workflow* with **dry_run** ticked (the default) lists exactly what
  would be sent today, without sending or recording anything.
- The **Admin planner** shows, under each assigned person, whether reminders can reach them, and when the
  daily job last ran.

### Limits worth knowing

- **LINE free plan:** about 200 pushed messages a month in Japan (LINE's docs; check your own account).
  The job checks what is left before sending and reports it if the quota runs out. Replies to people are free.
- **Gmail:** about 500 emails a day for a personal account — far more than this needs.
- **GitHub switches scheduled workflows off after 60 days without repository activity** in a public repo, and
  does it silently. The planner turns red if the job hasn't run for 2 days; fix it under *Actions → Send
  Jumat reminders* (re-enable the workflow).
- **Default branch:** GitHub runs scheduled workflows from the repository's default branch. Set it to `main`
  (*Settings → Branches*). The job always runs the code on `main` regardless.
- **Logs are public** (public repo). The job prints names and counts only — never email addresses, LINE ids or
  unsubscribe links.

## Local development

```bash
npm install
npx wrangler d1 migrations apply jumat-scheduler-naist-db --local
npm run dev
```
Opens the site at `http://localhost:8788` against a local D1 database (no
Cloudflare account needed for this part). Local writes work without an
access code unless you also set one in `.dev.vars` (`ACCESS_CODE=yourcode`).

`npm test` runs the unit tests for the reminder logic. `npm run reminders:dry-run`
runs the reminder job in dry-run mode (needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in your environment, and reads the real database).

## Data notes

The roster and the 2025 archive in `migrations/0002_seed.sql` were extracted
from the original spreadsheet. A few names were spelled inconsistently across
years (e.g. "Ridho" vs "Ridho Priyo", "Rizky" vs "Rizki Pratama"), so the
seeded roster reflects the spreadsheet's most recent "Active Khatib List" /
"List of Khatib and Imam" sheet rather than trying to reconcile every past
year — double-check it once the site is live and edit names/statuses from the
roster panel as needed. "Move out from NAIST" dates from the spreadsheet were
used to seed each person as active/inactive as of today; toggle status
anytime from the roster panel.

The 2022–2024 sheets weren't imported (only 2025, as the most recent
reference) — the goal of this app is scheduling forward, not replaying old
history.
