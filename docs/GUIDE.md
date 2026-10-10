# How the NAIST Jumat Scheduler works

> Flowcharts of the whole system: what a member sees, what the admin does, what runs by itself, and what to do when the admin changes. This page is part of the website and is updated whenever the system changes.

**Easiest way to read it:** open https://jumat-scheduler-naist.pages.dev/guide on any phone or computer. This file is the same guide for GitHub, which draws the flowcharts too.

*This file is generated (`npm run docs`). Change the flowcharts in `public/flows/*.mmd` and the words in `public/flows/guide.json`, never this file.*

**Colours:** Members and visitors · Admin actions · Automatic (the website and the robot) · Outside services (email, LINE, Google, WhatsApp) · A problem, an alert or something to be careful with (blue · green · grey · orange · red).

**Contents:** [Big picture](#the-big-picture) · [Members](#for-members) · [Admin](#for-the-admin) · [Behind the scenes](#behind-the-scenes) · [New admin](#when-the-admin-changes) · [Setup](#setup-and-what-is-switched-on)

## The big picture

Everything in one view, and what a normal week looks like.

### The system: people, website, robot and messages

Members, scheduled people and the admin all use the same web page. The robot sends the reminders and keeps things in step; the admin posts the announcement in the WhatsApp and Facebook groups by hand.

```mermaid
flowchart TD
  subgraph people["👥 People"]
    M["Muslim member<br/>any phone or computer"]
    S["Scheduled khatib / imam"]
    A["Admin<br/>knows the access code"]
  end

  DEP["🤖 Deploy<br/>whenever the code changes<br/>GitHub Actions"]
  SITE["🌐 The website - free, always on<br/>the web page, the API behind it and the database<br/>Cloudflare Pages, Functions and D1<br/>roster · schedule · availability · alerts"]
  JOB["🤖 Daily job<br/>08:23 and 14:23 Japan time<br/>GitHub Actions"]

  subgraph out["📬 Where messages and calendars go"]
    ICS["Calendar feed .ics<br/>Apple / Outlook"]
    GC["Google Calendar<br/>public calendar + invitations<br/>needs one-time setup"]
    MSG["Gmail and LINE bot<br/>reminder emails and messages"]
    WA["WhatsApp / Facebook groups<br/>the admin posts the announcement by hand"]
  end

  M --> SITE
  S --> SITE
  A --> SITE
  DEP -->|"publishes it"| SITE
  SITE -->|"the job reads the schedule"| JOB
  SITE --> ICS
  SITE -->|"on every edit"| GC
  SITE -.->|"admin copies the announcement"| WA
  JOB --> MSG
  JOB -->|"safety re-sync"| GC

  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  classDef out fill:#fdf0e1,stroke:#c77b1c,color:#4a2b05
  class M,S member
  class A admin
  class SITE,DEP,JOB robot
  class MSG,GC,ICS,WA out
```

### A normal week

From the first availability mark to the prayer on Friday. Times are Japan time.

```mermaid
flowchart TD
  A["Any day<br/>members mark when they can or cannot come"] --> B["Early in the week<br/>the admin picks khatib, secondary khatib and imam"]
  B --> C["Right away<br/>Google Calendar is updated, if connected"]
  B --> D["7 days before the Friday<br/>first reminder: email / LINE<br/>the admin gets a to-do if anything needs doing"]
  D --> E["Thursday - the day before<br/>second reminder to each person<br/>the admin gets the to-do: who to message by hand, empty slots<br/>the admin posts the announcement in the WhatsApp and Facebook groups"]
  E --> F{"Someone cannot come?"}
  F -->|"yes"| G["They open the link: I can't make it<br/>the admin is alerted and finds a replacement"]
  F -->|"no"| H["Friday 11:00<br/>after this, reminders for that same day are no longer sent"]
  G --> H
  H --> I["Friday 12:35 to 13:05<br/>Jumat prayer"]
  I --> J["The Friday moves into the history<br/>the next Fridays keep appearing automatically (16 weeks ahead)"]

  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A member
  class B,E admin
  class C,D,H,J robot
  class G warn
```

### What the system can do

| Who | Feature | What it does | Status |
| --- | --- | --- | --- |
| Members | See the schedule | A calendar of the Fridays with khatib, imam and venue. | ✅ live |
| Members | Friday details and announcement | Tap a Friday to read it and copy the weekly announcement. | ✅ live |
| Members | Say when you can or cannot come | Choose your name, then I'm available or I'm unavailable. No password. | ✅ live |
| Members | Can't make it link | In every reminder and calendar event: one button that tells the admin you cannot come. | ✅ live |
| Members | Calendar feed | A feed for Apple, Outlook or Google (From URL): 12:35 to 13:05 each Friday with the announcement text. | ✅ live |
| Members | Public Google Calendar | A shared Google Calendar the website keeps up to date within a minute. | 🔧 needs setup |
| Scheduled people | Reminder emails | 7 days before and the day before, to people whose email is on the roster. | ✅ live |
| Scheduled people | Reminder LINE messages | The same reminders on LINE, for people who linked the bot. | ✅ live |
| Scheduled people | Add to Google Calendar link | In every reminder: a ready-made calendar event with their role. | ✅ live |
| Scheduled people | Google Calendar invitation | Invited automatically if their NAIST Google account is on the roster. | 🔧 needs setup |
| Admin | Access code | Unlocks editing. Members never need it. | ✅ live |
| Admin | Roster | Add, edit, mark left NAIST or delete people; their contact details are visible only with the code. | ✅ live |
| Admin | Planner | Pick primary khatib, secondary khatib and imam for every coming Friday, with availability and turns shown. | ✅ live |
| Admin | Copy reminder and WhatsApp buttons | For people the robot cannot reach: copy the text or open WhatsApp with it typed. | ✅ live |
| Admin | Announcement for the groups | Generate and copy the weekly announcement to post in the WhatsApp and Facebook groups. | ✅ live |
| Admin | Admin to-do messages | A week before (only if something needs doing) and the day before: who to message by hand, empty slots, post the announcement. | ✅ live |
| Admin | Can't-make-it alerts | A red box and badge in the planner, and an email, when a scheduled person cannot come. | ✅ live |
| Admin | Google Calendar sync | Status line and a Sync now button in the planner; instant alert emails. | 🔧 needs setup |
| Automatic | Daily job | 08:23 and 14:23 Japan time: reminders, to-dos, alert emails, calendar re-sync. | ✅ live |
| Automatic | Deploy | Every change of the code is published automatically, with its database changes. | ✅ live |

## For members

What anyone can do without a password, and what happens to someone who is scheduled.

### What you can do on the website

No password is needed to look at the schedule, to share the announcement, to add the calendar or to say when you can come.

```mermaid
flowchart TD
  A["Open the website<br/>no password needed"] --> B["See the schedule<br/>a calendar of Fridays with khatib, imam and venue"]
  B --> C{"What do you want to do?"}

  C --> D["Tap a Friday to see its details<br/>read khatib, imam and venue<br/>or generate the announcement and copy it to share"]
  C --> E["Put the schedule in your own calendar<br/>Google Calendar: Add the Jumat calendar<br/>Apple or Outlook: use the calendar feed link"]
  C --> F["Say when you can or cannot come"]
  F --> F1["Choose your name at the top<br/>You are"]
  F1 --> F2["Tap a Friday, then<br/>I'm available · I'm unavailable · Clear my mark"]
  F2 --> F3["The admin sees it when choosing<br/>who will be khatib or imam"]

  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  class A,B,C,D,E,F,F1,F2 member
  class F3 robot
```

### If you are scheduled as khatib or imam

How you are told, and what to do if you cannot come.

```mermaid
flowchart TD
  A["The admin picks you for a Friday"] --> B["You are told in the way the admin can reach you:<br/>Email, if your email is on the roster<br/>LINE, if you linked LINE<br/>a WhatsApp or Facebook message from the admin, if neither<br/>a Google Calendar invitation, if your NAIST Google account is on the roster"]
  B --> C["Reminders: 7 days before and the day before<br/>the secondary khatib is told to be ready to step in"]
  C --> D{"Can you still come?"}
  D -->|"yes"| E["Jumat prayer starts at 12:35<br/>the calendar event runs 12:35 to 13:05"]
  D -->|"no"| F["Open the Can't make it link<br/>in the reminder or in the calendar event"]
  F --> G["Choose your name, then<br/>I can't make it"]
  G --> H["The admin is told at once<br/>in the planner and by email"]
  H --> I["The admin picks someone else<br/>and that person gets their reminders"]

  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef out fill:#fdf0e1,stroke:#c77b1c,color:#4a2b05
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,H,I admin
  class C,D,E member
  class B out
  class F,G warn
```

## For the admin

The weekly routine, how to set up the people, and what to do when someone cannot come.

### The weekly routine

Most of it is picking people. The robot sends the reminders; you only send by hand to people the robot cannot reach, and post the announcement in the groups.

```mermaid
flowchart TD
  A["Open the website<br/>press Enter access code"] --> B["The Admin planner appears"]
  B --> C{"A red box:<br/>someone can't make it?"}
  C -->|"yes"| C1["Press Find a replacement<br/>see the alerts chart"]
  C -->|"no"| D
  C1 --> D["Look at the coming Fridays<br/>a warning mark means an empty slot or two turns too close"]
  D --> E["Pick the primary khatib, secondary khatib and imam<br/>people who are available come first in each list"]
  E --> F["It is saved at once<br/>Google Calendar follows, once connected"]
  F --> G["The robot sends the reminders by itself<br/>7 days before and the day before"]
  G --> H{"Does the person have<br/>an email or LINE?"}
  H -->|"yes"| I["Nothing more to do"]
  H -->|"no"| J["Press Copy reminder or WhatsApp<br/>and send it yourself"]
  G --> K["You also get your own to-do message<br/>if you are marked as admin:<br/>who to message by hand, empty slots"]
  K --> L["The day before:<br/>open the Friday, press Generate announcement<br/>and post it in the WhatsApp and Facebook groups"]
  I --> M["Friday 12:35 - Jumat prayer"]
  J --> M
  L --> M

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,B,D,E,J,L admin
  class F,G,I,K,M robot
  class C1 warn
```

### The roster: people and how to reach them

The more ways a person can be reached, the less you do by hand.

```mermaid
flowchart TD
  A["Roster: + Add person<br/>or Edit on an existing person"] --> B["Name, role (khatib, imam or both),<br/>affiliation, country, note"]
  B --> C["How can this person be reached? Fill in any of these:<br/>Email: automatic reminder emails, keep the reminders box ticked<br/>LINE: press Get LINE link code, the person sends the code to the bot<br/>WhatsApp number like +81 90 1234 5678: a one-tap button in the planner<br/>NAIST Google account: invited to their Friday in Google Calendar<br/>Nothing yet: you copy the reminder and send it by hand"]
  C --> D["Admin this period box<br/>ticked: you get the to-do messages and the can't-make-it alerts<br/>needs an email or a LINE link"]
  D --> G{"Later, if something changes"}
  G -->|"left NAIST"| E["Mark left NAIST<br/>the person stays in the history but is no longer offered"]
  G -->|"added by mistake"| F["Delete<br/>only for a mistake or a duplicate"]

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef out fill:#fdf0e1,stroke:#c77b1c,color:#4a2b05
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,B,D,E,G admin
  class C out
  class F warn
```

### When someone cannot make it

The alert reaches you on the website and by email, so a replacement can be found early.

```mermaid
flowchart TD
  A["A scheduled person opens the Can't make it link<br/>from a reminder or from the calendar event"] --> B["They choose their name, then press<br/>I can't make it"]
  B --> C{"Are they really scheduled for that Friday,<br/>and has the Friday not passed yet?"}
  C -->|"no"| D["Saved as unavailable only<br/>no alert"]
  C -->|"yes"| E["An alert is created"]
  E --> F["Planner: a red box<br/>X can't make it<br/>and a warning badge on that Friday"]
  E --> G["Every admin gets an email<br/>at once when Google is connected,<br/>otherwise with the next daily run"]
  F --> H["You press Find a replacement"]
  H --> I["Pick someone else for that slot"]
  I --> J["The alert closes by itself<br/>the new person gets their reminders<br/>and the calendar follows"]
  F --> K["Got it<br/>removes the alert from the list"]
  B --> L["If they later say I'm available<br/>the alert is withdrawn"]

  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,B,L member
  class H,I,K admin
  class C,D,G,J robot
  class E,F warn
```

## Behind the scenes

What runs by itself, and the exact list of pages, tables, jobs and settings in the code (this list is written by the code itself, so it is always current).

### What runs when

Three triggers: an edit on the website, the twice-daily job, and a change of the code.

```mermaid
flowchart TD
  subgraph t1["⚡ When someone edits on the website"]
    E1["The admin assigns someone, changes the venue or edits a person"] --> E2["Saved in the database at once"]
    E2 --> E3["Google Calendar is updated within a minute<br/>only once connected"]
    U1["A scheduled person presses I can't make it"] --> U2["An alert is saved"]
    U2 --> U3["Admins are emailed at once<br/>only once Google is connected"]
  end

  subgraph t2["⏰ Twice a day - 08:23 and 14:23 Japan time"]
    R1["Who is scheduled in the next 7 days?"] --> R2["Reminders 7 days before and 1 day before<br/>by email and LINE, each sent only once<br/>a reminder for today is dropped after 11:00"]
    R2 --> R3["The admin to-do messages"]
    R3 --> R4["Alert emails that were not sent yet"]
    R4 --> R5["Google Calendar safety re-sync"]
    R5 --> R6["A heartbeat is saved<br/>the planner shows when the job last ran"]
  end

  subgraph t3["🚀 When the code changes on GitHub"]
    D1["Database changes are applied"] --> D2["The website is published again"]
  end

  E3 ~~~ R1
  U3 ~~~ R1
  R6 ~~~ D1

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef robot fill:#eceff3,stroke:#6b7280,color:#1f2937
  classDef member fill:#e8f1fb,stroke:#3b78b8,color:#10253d
  class E1 admin
  class U1 member
  class E2,E3,U2,U3,R1,R2,R3,R4,R5,R6,D1,D2 robot
```

### The exact list, from the code

#### Pages of the API

| Address | What it does | Who can use it |
| --- | --- | --- |
| `/api/access-check` | Checks whether an access code is right, so the page knows to unlock the editing buttons. | GET: public, more with the code |
| `/api/alerts` | The list of can't-make-it alerts waiting for the admin. | GET: access code |
| `/api/alerts/:id` | The admin marks one alert as seen (Got it). | PATCH: access code |
| `/api/availability` | Who can or cannot come on which Friday. Anyone can mark their own. | GET: public, more with the code; POST: public; DELETE: public |
| `/api/calendar/add` | The Add to Google Calendar link in reminders: sends the person to Google with a ready-made event. | GET: public |
| `/api/calendar/info` | Tells the home page whether the shared Google Calendar is connected, to show its buttons. | GET: public |
| `/api/calendar/jumat.ics` | The calendar feed for Apple, Outlook or Google (From URL). | GET: public |
| `/api/calendar/sync` | The planner's Sync now button: makes Google Calendar match the schedule. | POST: access code |
| `/api/fridays` | The schedule: the list of Fridays. It also creates the coming ones. | GET: public |
| `/api/fridays/:id` | Assign khatib and imam, set the venue or a note for one Friday. | PATCH: access code |
| `/api/line/webhook` | Where LINE delivers messages to the bot. This is how a person links their LINE with the code. | POST: LINE signature |
| `/api/people` | The roster: read the list (contact details only with the code) and add a person. | GET: public, more with the code; POST: access code |
| `/api/people/:id` | Edit or delete one person. | DELETE: access code; PATCH: access code |
| `/api/people/:id/line` | Create or remove the code a person uses to link their LINE. | POST: access code; DELETE: access code |
| `/api/reminders/status` | What the planner shows about the reminder job, the admin and Google Calendar. | GET: access code |
| `/api/reminders/unsubscribe` | The stop-these-reminders link at the bottom of every email. | GET: private link; POST: private link |

#### Database tables

| Table | Created by |
| --- | --- |
| `people` | `0001_init.sql` |
| `fridays` | `0001_init.sql` |
| `availability` | `0001_init.sql` |
| `reminder_log` | `0008_reminders.sql` |
| `reminder_runs` | `0008_reminders.sql` |
| `availability_alerts` | `0011_alerts.sql` |
| `gcal_sync` | `0012_gcal.sql` |
| `gcal_state` | `0012_gcal.sql` |

#### Database changes, in order

| File | What it changes |
| --- | --- |
| `0001_init.sql` | Jumat Scheduler NAIST - initial schema |
| `0002_seed.sql` | Jumat Scheduler NAIST - seed data |
| `0003_affiliation_contact.sql` | Broaden the roster beyond NAIST khatib/imam students (outside community |
| `0004_affiliation_categories.sql` | Split the "naist" affiliation into its actual categories: students and |
| `0005_imam.sql` | The original spreadsheet only ever tracked Primary/Secondary khatib per |
| `0006_drop_sensei_role.sql` | "sensei" was added to the role field (prayer-duty capability), but role |
| `0007_backfill_default_venue.sql` | Upcoming Fridays created before the default-venue change were stored with |
| `0008_reminders.sql` | Automatic reminders: where to reach each person, plus a log so nobody gets |
| `0009_whatsapp.sql` | WhatsApp number for the planner's one-tap "send reminder" link. |
| `0010_admin.sql` | Who is the admin this period. |
| `0011_alerts.sql` | "Can't make it" alerts. |
| `0012_gcal.sql` | Google Calendar: one event per Friday on a shared (public) calendar, kept up to |

#### Robot jobs (GitHub Actions)

| Job | When it runs |
| --- | --- |
| Deploy to Cloudflare Pages (`deploy.yml`) | every change on main; by hand |
| Send Jumat reminders (`reminders.yml`) | on a timer: 23:23 UTC = 08:23 JST; on a timer: 05:23 UTC = 14:23 JST; by hand (options: dry_run, google_check, test_email_to_sender, test_email) |
| One-time Cloudflare setup (`setup.yml`) | by hand |

#### Settings and secrets

| Name | Kept in | What it is |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub secret | Which Cloudflare account the website lives in. |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | Lets GitHub deploy the website and read the database. |
| `GCAL_BRIDGE_SECRET` | GitHub secret | The shared secret that the website and the Apps Script both must know. |
| `GCAL_BRIDGE_URL` | GitHub secret | Address of the Google Apps Script that edits the shared Google Calendar. |
| `GMAIL_APP_PASSWORD` | GitHub secret | The Gmail app password (16 characters) used to send those emails. |
| `GMAIL_USER` | GitHub secret | The community Gmail address that sends the reminder emails. |
| `LINE_CHANNEL_ACCESS_TOKEN` | GitHub secret | LINE bot: lets the website and the job send LINE messages. |
| `LINE_CHANNEL_SECRET` | GitHub secret | LINE bot: lets the website check that a message really comes from LINE. |
| `SCHEDULER_ACCESS_CODE` | GitHub secret | The community access code (GitHub keeps it; the setup workflow copies it to the website as ACCESS_CODE). |
| `SITE_URL` | GitHub variable | Optional: the website address used inside calendar events and emails, if the site gets its own domain. |
| `ACCESS_CODE` | Website setting | The community access code, as the website sees it. Anyone who knows it can edit the schedule and roster. |
| `GCAL_BRIDGE_SECRET` | Website setting | The shared secret that the website and the Apps Script both must know. |
| `GCAL_BRIDGE_URL` | Website setting | Address of the Google Apps Script that edits the shared Google Calendar. |
| `LINE_CHANNEL_ACCESS_TOKEN` | Website setting | LINE bot: lets the website and the job send LINE messages. |
| `LINE_CHANNEL_SECRET` | Website setting | LINE bot: lets the website check that a message really comes from LINE. |
| `SITE_URL` | Website setting | Optional: the website address used inside calendar events and emails, if the site gets its own domain. |

## When the admin changes

Three levels, from the everyday handover to moving the whole system.

### 1. Hand over the admin job (about 5 minutes)

The everyday case: another person takes over the weekly work.

```mermaid
flowchart TD
  A["A new admin is agreed"] --> B["Give them the community access code<br/>in a private message, not in a group chat"]
  B --> C["In the roster: make sure the new admin has<br/>an email and or a LINE link"]
  C --> D["Edit the new admin's entry<br/>tick Admin this period"]
  D --> E["Edit the old admin's entry<br/>untick Admin this period"]
  E --> F{"Does the planner show a red line<br/>about the admin?"}
  F -->|"yes"| C
  F -->|"no"| G["The to-do messages and the can't-make-it alerts<br/>now go to the new admin"]
  G --> H{"Is the old admin leaving the team?"}
  H -->|"yes"| I["Do the next chart:<br/>change the keys they knew"]
  H -->|"no"| J["Done"]

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,B,C,D,E,G,H,J admin
  class F,I warn
```

### 2. If the old admin leaves: change the keys they knew

Each key is separate. Change only the ones that person had. Never send a key or password in a chat; give it in a private message or a password manager.

```mermaid
flowchart LR
  B{"Someone who had access<br/>is leaving the admin team.<br/>What did they have?"}
  B --> D1["🔑 The access code<br/>Change the GitHub secret SCHEDULER_ACCESS_CODE<br/>then run Actions: One-time Cloudflare setup<br/>tell the remaining admins the new code"]
  B --> D2["✉️ The community Gmail<br/>sends the emails, owns the calendar and the script<br/>it stays: nothing to move or redo<br/>if needed, change its recovery email<br/>Google Account, Security, Recovery email<br/>anything else (password, app password, script secret):<br/>contact the system owner"]
  B --> D3["🐙 The GitHub repository<br/>Repository Settings, then Collaborators:<br/>remove them, or move the ownership"]
  B --> D4["☁️ The Cloudflare account<br/>Remove them under Members and create a new API token<br/>then update the GitHub secret CLOUDFLARE_API_TOKEN"]
  B --> D5["💬 The LINE Official Account<br/>In LINE Official Account Manager remove their role<br/>issue a new channel access token if needed<br/>update the GitHub secret LINE_CHANNEL_ACCESS_TOKEN<br/>then run One-time Cloudflare setup and Deploy"]

  D1 --> E["Check everything:<br/>Actions: Send Jumat reminders,<br/>a dry run, a test email<br/>and google_check"]
  D2 --> E
  D3 --> E
  D4 --> E
  D5 --> E

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class B warn
  class D1,D2,D3,D4,D5,E admin
```

### 3. Moving everything to the new owner's own accounts (rare)

Not rehearsed yet: treat it as a checklist and ask a developer for steps 4 and 6.

```mermaid
flowchart TD
  A["The whole system moves to the new owner's own accounts<br/>rare, and not rehearsed yet"] --> B["1. Code<br/>transfer the GitHub repository to the new owner<br/>Settings, then Transfer"]
  B --> C["2. Cloudflare<br/>new account, create an API token, note the Account ID"]
  C --> D["3. GitHub secrets<br/>CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SCHEDULER_ACCESS_CODE"]
  D --> E["4. Keep a copy of the old data<br/>a developer exports the database with wrangler d1 export"]
  E --> F["5. Actions: One-time Cloudflare setup<br/>then Deploy to Cloudflare Pages<br/>this creates the new database and website"]
  F --> G["6. Put the old data into the new database<br/>a developer imports the copy"]
  G --> H["7. Redo only what belonged to a person<br/>the community Gmail, its Google Calendar and its script stay as they are:<br/>just copy GMAIL_USER, GMAIL_APP_PASSWORD, GCAL_BRIDGE_URL and GCAL_BRIDGE_SECRET<br/>into the new GitHub secrets (the system owner can help). Redo the LINE bot only if it was in a personal account"]
  H --> I["8. If the website address changed<br/>set SITE_URL and tell every member the new link"]
  I --> J["9. Check<br/>open the site, a dry run, a test email, google_check"]

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A warn
  class B,C,D,E,F,G,H,I,J admin
```

## Setup and what is switched on

The optional parts, which ones are done, and the steps for the Google Calendar connection.

### Connecting Google Calendar (about 15 minutes, once)

Needs the community Gmail account (it stays when admins change) and a computer. Full wording is in the README, section Google Calendar.

```mermaid
flowchart TD
  A["Sign in as the community Gmail account<br/>the one that sends the reminder emails, never a personal account<br/>it stays when admins change, so the calendar and script keep working<br/>use a computer"] --> B["1. Make the calendar<br/>Other calendars, plus, Create new calendar, name NAIST Jumat<br/>time zone Japan, make it public with all event details<br/>copy the Calendar ID"]
  B --> C["2. Make the script<br/>script.google.com, New project, paste google-apps-script/Code.gs"]
  C --> D["3. Add the Calendar service<br/>Services plus, Google Calendar API, Add"]
  D --> E["4. Two settings<br/>Project Settings, Script properties:<br/>SECRET and CALENDAR_ID"]
  E --> F["5. Publish it<br/>Deploy, New deployment, Web app<br/>Execute as Me, access Anyone<br/>copy the Web app URL"]
  F --> G["6. Two GitHub secrets<br/>GCAL_BRIDGE_URL and GCAL_BRIDGE_SECRET"]
  G --> H["7. Actions: One-time Cloudflare setup, then Deploy to Cloudflare Pages"]
  H --> I["8. Actions: Send Jumat reminders<br/>tick google_check, then Run workflow"]
  I --> J{"The log says<br/>Google Calendar connection OK?"}
  J -->|"yes"| K["9. Private window check<br/>open the public calendar without signing in<br/>events visible, no guest list"]
  J -->|"no"| L["Read the message<br/>unauthorized: the two SECRET texts differ<br/>not JSON: the web app is not deployed for Anyone"]
  L --> G

  classDef admin fill:#e3f4ec,stroke:#1f7a5c,color:#12372a
  classDef out fill:#fdf0e1,stroke:#c77b1c,color:#4a2b05
  classDef warn fill:#fbe9e7,stroke:#b3261e,color:#4a0f0b
  class A,G,H,I,K admin
  class B,C,D,E,F out
  class J,L warn
```

### What is switched on

| Part | Status | Notes |
| --- | --- | --- |
| Website, database and automatic deploy | ✅ done | Live on Cloudflare Pages. |
| Community access code | ✅ done | Set. Change it with the handover chart if an admin leaves. |
| Reminder emails (community Gmail) | ✅ done | Test email received. Add each person's email in the roster to start their reminders. |
| LINE reminders | ✅ done | Bot connected. Each person links with a code from the roster. |
| Google Calendar connection | ⏳ in progress | Not connected yet: follow the chart below. Until then the calendar feed is used. |
| An admin marked in the roster | ☐ to do | Edit your own entry and tick Admin this period (needs an email or LINE link). |
| GitHub default branch set to main | ☐ to do | Recommended: Settings, Branches. The scheduled job runs the code on main either way. |
