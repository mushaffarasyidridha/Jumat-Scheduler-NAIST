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

## Local development

```bash
npm install
npx wrangler d1 migrations apply jumat-scheduler-naist-db --local
npm run dev
```
Opens the site at `http://localhost:8788` against a local D1 database (no
Cloudflare account needed for this part). Local writes work without an
access code unless you also set one in `.dev.vars` (`ACCESS_CODE=yourcode`).

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
