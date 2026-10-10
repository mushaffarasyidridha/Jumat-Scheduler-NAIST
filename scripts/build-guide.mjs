#!/usr/bin/env node
// Builds the parts of the guide that must follow the code, so they cannot go stale:
//
//   public/flows/inventory.json  every page of the API, database table, migration,
//                                workflow and setting, read from the code itself
//   docs/GUIDE.md                the whole guide as Markdown (GitHub draws the
//                                flowcharts), from public/flows/guide.json + the .mmd files
//
//   node scripts/build-guide.mjs          write both files   (npm run docs)
//   node scripts/build-guide.mjs --check  only compare; exit 1 if they are out of date
//                                         (npm test runs the same comparison)
//
// The flowcharts themselves (public/flows/*.mmd) and the wording (guide.json) are
// written by hand: when behaviour changes, change them in the same commit.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://jumat-scheduler-naist.pages.dev";

// What each setting is, in plain words. A new setting without an entry fails the
// test: that is the reminder to describe it (and to update the guide).
export const SETTING_NOTES = {
  SCHEDULER_ACCESS_CODE: "The community access code (GitHub keeps it; the setup workflow copies it to the website as ACCESS_CODE).",
  ACCESS_CODE: "The community access code, as the website sees it. Anyone who knows it can edit the schedule and roster.",
  CLOUDFLARE_API_TOKEN: "Lets GitHub deploy the website and read the database.",
  CLOUDFLARE_ACCOUNT_ID: "Which Cloudflare account the website lives in.",
  GMAIL_USER: "The community Gmail address that sends the reminder emails.",
  GMAIL_APP_PASSWORD: "The Gmail app password (16 characters) used to send those emails.",
  LINE_CHANNEL_SECRET: "LINE bot: lets the website check that a message really comes from LINE.",
  LINE_CHANNEL_ACCESS_TOKEN: "LINE bot: lets the website and the job send LINE messages.",
  GCAL_BRIDGE_URL: "Address of the Google Apps Script that edits the shared Google Calendar.",
  GCAL_BRIDGE_SECRET: "The shared secret that the website and the Apps Script both must know.",
  SITE_URL: "Optional: the website address used inside calendar events and emails, if the site gets its own domain.",
};

// What each page of the API does, in plain words (the guide is for people who do
// not read code). A new page without an entry fails the test: that is the
// reminder to describe it, and to update the flowcharts.
export const ROUTE_NOTES = {
  "/api/access-check": "Checks whether an access code is right, so the page knows to unlock the editing buttons.",
  "/api/alerts": "The list of can't-make-it alerts waiting for the admin.",
  "/api/alerts/:id": "The admin marks one alert as seen (Got it).",
  "/api/availability": "Who can or cannot come on which Friday. Anyone can mark their own.",
  "/api/calendar/add": "The Add to Google Calendar link in reminders: sends the person to Google with a ready-made event.",
  "/api/calendar/info": "Tells the home page whether the shared Google Calendar is connected, to show its buttons.",
  "/api/calendar/jumat.ics": "The calendar feed for Apple, Outlook or Google (From URL).",
  "/api/calendar/sync": "The planner's Sync now button: makes Google Calendar match the schedule.",
  "/api/fridays": "The schedule: the list of Fridays. It also creates the coming ones.",
  "/api/fridays/:id": "Assign khatib and imam, set the venue or a note for one Friday.",
  "/api/line/webhook": "Where LINE delivers messages to the bot. This is how a person links their LINE with the code.",
  "/api/people": "The roster: read the list (contact details only with the code) and add a person.",
  "/api/people/:id": "Edit or delete one person.",
  "/api/people/:id/line": "Create or remove the code a person uses to link their LINE.",
  "/api/reminders/status": "What the planner shows about the reminder job, the admin and Google Calendar.",
  "/api/reminders/unsubscribe": "The stop-these-reminders link at the bottom of every email.",
};

const read = (path) => readFileSync(join(ROOT, path), "utf8");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const firstSentence = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = flat.match(/^(.+?[.!?])(\s|$)/);
  return (match ? match[1] : flat).slice(0, 220);
};

// ---------- the API pages ----------

function routeOf(file) {
  const parts = relative("functions", file).replace(/\.(m?js)$/, "").split("/");
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.map((p) => p.replace(/^\[(.+)\]$/, ":$1")).join("/");
}

function accessOf(body) {
  if (/requireAccess\(/.test(body)) return "access code";
  if (/x-line-signature/.test(body)) return "LINE signature";
  if (/searchParams\.get\("t"\)|reminder_token/.test(body)) return "private link";
  if (/checkAccess\(/.test(body)) return "public, more with the code";
  return "public";
}

function noteAbove(source, index) {
  const lines = source.slice(0, index).split("\n");
  lines.pop(); // the partial line the match starts on
  const comment = [];
  while (lines.length && /^\s*\/\//.test(lines[lines.length - 1])) comment.unshift(lines.pop().replace(/^\s*\/\/\s?/, ""));
  return comment.join(" ");
}

function routes() {
  const found = new Map();
  for (const file of walk("functions")) {
    if (!/\.m?js$/.test(file) || basename(file).startsWith("_")) continue;
    const source = read(file);
    const handlers = [...source.matchAll(/export\s+async\s+function\s+onRequest(Get|Post|Patch|Put|Delete)?\b/g)];
    if (!handlers.length) continue;
    const route = routeOf(file);
    const entry = found.get(route) || { route, file: file.replace(/\\/g, "/"), methods: [], note: "" };
    handlers.forEach((match, i) => {
      const end = i + 1 < handlers.length ? handlers[i + 1].index : source.length;
      entry.methods.push({ method: (match[1] || "ANY").toUpperCase(), access: accessOf(source.slice(match.index, end)) });
      if (!entry.note) entry.note = firstSentence(noteAbove(source, match.index));
    });
    if (ROUTE_NOTES[route]) entry.note = ROUTE_NOTES[route]; // the plain-language note wins over the code comment
    found.set(route, entry);
  }
  return [...found.values()].sort((a, b) => a.route.localeCompare(b.route));
}

// ---------- the database ----------

function migrations() {
  return readdirSync(join(ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const sql = read(join("migrations", file));
      const comment = sql.split("\n").find((l) => /^--\s*\S/.test(l)) || "";
      return { file, note: firstSentence(comment.replace(/^--\s*/, "")) };
    });
}

function tables() {
  const list = [];
  for (const { file } of migrations()) {
    for (const m of read(join("migrations", file)).matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi)) {
      list.push({ name: m[1], migration: file });
    }
  }
  return list;
}

// ---------- the robot ----------

function workflows() {
  return readdirSync(join(ROOT, ".github/workflows"))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const text = read(join(".github/workflows", file));
      const name = (text.match(/^name:\s*(.+)$/m) || [, file])[1].trim();
      const when = [];
      if (/^\s*push:/m.test(text) && /branches:\s*\[?\s*main/.test(text)) when.push("every change on main");
      for (const m of text.matchAll(/-\s*cron:\s*"([^"]+)"(?:\s*#\s*(.*))?/g)) {
        when.push(`on a timer: ${m[2] ? m[2].trim() : m[1]}`);
      }
      if (/^\s*workflow_dispatch:/m.test(text)) {
        const block = text.split(/^\s*workflow_dispatch:/m)[1] || "";
        const inputs = [...(block.split(/^\S/m)[0] || "").matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
        when.push(inputs.length ? `by hand (options: ${inputs.join(", ")})` : "by hand");
      }
      return { file, name, when };
    });
}

// ---------- settings and secrets ----------

function settings() {
  const found = new Map();
  const add = (name, where, file) => {
    const key = `${where}:${name}`;
    const entry = found.get(key) || { name, where, usedIn: [], note: SETTING_NOTES[name] || "" };
    if (!entry.usedIn.includes(file)) entry.usedIn.push(file);
    found.set(key, entry);
  };
  for (const file of walk(".github/workflows").filter((f) => /\.ya?ml$/.test(f))) {
    const text = read(file);
    for (const m of text.matchAll(/secrets\.([A-Z][A-Z0-9_]+)/g)) add(m[1], "GitHub secret", basename(file));
    for (const m of text.matchAll(/vars\.([A-Z][A-Z0-9_]+)/g)) add(m[1], "GitHub variable", basename(file));
  }
  for (const file of walk("functions").filter((f) => /\.m?js$/.test(f))) {
    for (const m of read(file).matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) {
      if (m[1] !== "DB") add(m[1], "Website setting", file.replace(/\\/g, "/"));
    }
  }
  return [...found.values()].sort((a, b) => a.where.localeCompare(b.where) || a.name.localeCompare(b.name));
}

export function inventory() {
  return { routes: routes(), tables: tables(), migrations: migrations(), workflows: workflows(), settings: settings() };
}

// ---------- the Markdown guide ----------

const esc = (text) => String(text).replace(/\|/g, "\\|");
const STATUS = { live: "✅ live", "needs-setup": "🔧 needs setup", done: "✅ done", "in-progress": "⏳ in progress", todo: "☐ to do" };

function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}

export function diagramFiles() {
  return readdirSync(join(ROOT, "public/flows")).filter((f) => f.endsWith(".mmd")).sort();
}

export function manifest() {
  return JSON.parse(read("public/flows/guide.json"));
}

function inventoryMarkdown(inv) {
  return [
    "#### Pages of the API",
    table(
      ["Address", "What it does", "Who can use it"],
      inv.routes.map((r) => [`\`${r.route}\``, r.note || "", r.methods.map((m) => `${m.method}: ${m.access}`).join("; ")])
    ),
    "#### Database tables",
    table(["Table", "Created by"], inv.tables.map((t) => [`\`${t.name}\``, `\`${t.migration}\``])),
    "#### Database changes, in order",
    table(["File", "What it changes"], inv.migrations.map((m) => [`\`${m.file}\``, m.note])),
    "#### Robot jobs (GitHub Actions)",
    table(["Job", "When it runs"], inv.workflows.map((w) => [`${w.name} (\`${w.file}\`)`, w.when.join("; ")])),
    "#### Settings and secrets",
    table(["Name", "Kept in", "What it is"], inv.settings.map((s) => [`\`${s.name}\``, s.where, s.note])),
  ].join("\n\n");
}

export function guideMarkdown(m, inv) {
  const out = [];
  out.push(`# ${m.title}`);
  out.push(`> ${m.intro}`);
  out.push(
    `**Easiest way to read it:** open ${SITE}/guide on any phone or computer. This file is the same guide for GitHub, which draws the flowcharts too.\n\n` +
      "*This file is generated (`npm run docs`). Change the flowcharts in `public/flows/*.mmd` and the words in `public/flows/guide.json`, never this file.*"
  );
  out.push("**Colours:** " + m.legend.map((l) => l.text).join(" · ") + " (blue · green · grey · orange · red).");
  out.push("**Contents:** " + m.sections.map((s) => `[${s.tab}](#${s.title.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-")})`).join(" · "));
  for (const s of m.sections) {
    out.push(`## ${s.title}`);
    out.push(s.blurb);
    for (const d of s.diagrams) {
      out.push(`### ${d.title}`);
      out.push(d.caption);
      out.push("```mermaid\n" + read(join("public/flows", d.file)).trimEnd() + "\n```");
    }
    if ((s.show || []).includes("features")) {
      out.push("### What the system can do");
      out.push(table(["Who", "Feature", "What it does", "Status"], m.features.map((f) => [f.audience, f.name, f.what, STATUS[f.status] || f.status])));
    }
    if ((s.show || []).includes("setup")) {
      out.push("### What is switched on");
      out.push(table(["Part", "Status", "Notes"], m.setup.map((x) => [x.name, STATUS[x.status] || x.status, x.detail])));
    }
    if ((s.show || []).includes("inventory")) {
      out.push("### The exact list, from the code");
      out.push(inventoryMarkdown(inv));
    }
  }
  return out.join("\n\n") + "\n";
}

// ---------- write / check ----------

export function buildAll() {
  const inv = inventory();
  return {
    "public/flows/inventory.json": JSON.stringify(inv, null, 2) + "\n",
    "docs/GUIDE.md": guideMarkdown(manifest(), inv),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const files = buildAll();
  let stale = 0;
  for (const [path, content] of Object.entries(files)) {
    const current = existsSync(join(ROOT, path)) ? read(path) : null;
    if (current === content) continue;
    stale++;
    if (check) {
      console.error(`OUT OF DATE: ${path} (run: npm run docs)`);
    } else {
      mkdirSync(dirname(join(ROOT, path)), { recursive: true });
      writeFileSync(join(ROOT, path), content);
      console.log(`wrote ${path}`);
    }
  }
  if (check && stale) process.exit(1);
  if (!stale) console.log("the guide is up to date");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
