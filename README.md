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

- It carries only what the public schedule page already shows: the date, 12.35 pm, the venue and
  who is khatib / imam (no contact details), for last week and the next 16 weeks. The events do not
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
changed after the message went out is still right. The event is set to last 45 minutes
(`PRAYER_DURATION_MIN` in `public/reminder-message.js`; only the start time is announced).
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
4. *Actions → Send Jumat reminders → Run workflow*, type your own address in **test_email**:
   you should get a test email (check spam the first time). Replies to reminders land in this Gmail inbox.

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
