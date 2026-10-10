# Working on the NAIST Jumat Scheduler

The community uses the guide at `/guide` (`public/guide.html`) to understand the system, to
run it as admin and to hand it over. It must always match what the system does.

## Rule: every behaviour change updates the guide, in the same commit

When you add, remove or change anything a member or admin can see or do, or anything that
runs by itself (a route, a button, a reminder, a job, a secret, a setup step):

1. Change the matching flowchart in `public/flows/*.mmd` (member: `member*.mmd`, admin:
   `admin-*.mmd`, robot: `automation.mmd`, `week.mmd`, `overview.mmd`, handover:
   `handover-*.mmd`, Google setup: `setup-google.mmd`). Colours: blue member, green admin,
   grey robot, orange outside service, red alert or warning.
2. Update `public/flows/guide.json` when a feature appears or disappears (the `features`
   list) or a setup step changes state (`setup`: done, in-progress, todo).
3. A new API route needs a plain-words line in `ROUTE_NOTES`, and a new setting or secret one
   in `SETTING_NOTES`, in `scripts/build-guide.mjs` (the test fails until it exists).
4. Run `npm run docs`, which regenerates `docs/GUIDE.md` and `public/flows/inventory.json`.
   Commit them. Never edit those two by hand.
5. Run `npm test`, then open `/guide` (`npm run dev`, tab by tab) and check every chart
   draws. Keep each chart narrow (about 1000 px or less when drawn): let it flow downward
   rather than fan out sideways.
6. If handing over to a new admin now needs another step (a new secret, a new account), add
   it to `handover-secrets.mmd` / `handover-move.mmd`.

The deploy workflow refreshes the generated inventory and writes the version stamp shown at
the bottom of the guide, so the published list can never be older than the code.

## Other conventions

- Times in messages are Japan time. The prayer starts at 12:35 (`PRAYER_START` in
  `public/reminder-message.js`; the calendar event runs 30 minutes).
- Shared code used by both the browser and Node is UMD in `public/*.js`; helper modules that
  the Functions and the robot job import are `.mjs` under `functions/api/`.
- `npm test` must pass before pushing. Changes go to `main` through a pull request; the
  deploy runs on push to `main` and applies database migrations first.
