// The guide (public/guide.html, flowcharts in public/flows/*.mmd, docs/GUIDE.md) must
// follow the system: these tests fail when it has drifted, and say what to do.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll, inventory, manifest, diagramFiles, ROUTE_NOTES, SETTING_NOTES } from "./build-guide.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const STATUSES = new Set(["live", "needs-setup", "done", "in-progress", "todo"]);

test("generated guide files are current (run: npm run docs)", () => {
  for (const [path, content] of Object.entries(buildAll())) {
    assert.ok(existsSync(join(ROOT, path)), `${path} is missing: run npm run docs`);
    assert.equal(read(path), content, `${path} is out of date: run npm run docs and commit it`);
  }
});

test("every route and setting in the code is described in plain words", () => {
  const inv = inventory();
  const missingRoutes = inv.routes.filter((r) => !ROUTE_NOTES[r.route]).map((r) => r.route);
  assert.deepEqual(missingRoutes, [], "add a line to ROUTE_NOTES in scripts/build-guide.mjs, and check the flowcharts still match");
  const missingSettings = inv.settings.filter((s) => !SETTING_NOTES[s.name]).map((s) => s.name);
  assert.deepEqual(missingSettings, [], "add a line to SETTING_NOTES in scripts/build-guide.mjs, and check the flowcharts still match");
  const staleRoutes = Object.keys(ROUTE_NOTES).filter((r) => !inv.routes.some((x) => x.route === r));
  assert.deepEqual(staleRoutes, [], "these pages no longer exist: remove them from ROUTE_NOTES");
});

test("inventory sees the pieces of the system", () => {
  const inv = inventory();
  assert.ok(inv.routes.length >= 15, "routes");
  assert.ok(inv.tables.some((t) => t.name === "people"), "people table");
  assert.ok(inv.migrations.length >= 12, "migrations");
  assert.deepEqual(inv.workflows.map((w) => w.file).sort(), ["deploy.yml", "reminders.yml", "setup.yml"].sort());
  assert.ok(inv.settings.some((s) => s.name === "GMAIL_APP_PASSWORD"), "settings");
});

test("every flowchart file is in the guide and every listed flowchart exists", () => {
  const listed = manifest().sections.flatMap((s) => s.diagrams.map((d) => d.file)).sort();
  assert.deepEqual(listed, diagramFiles(), "add the new .mmd to a section of public/flows/guide.json (or delete it)");
  assert.equal(new Set(listed).size, listed.length, "a flowchart is listed twice");
});

test("flowcharts are well formed", () => {
  for (const file of diagramFiles()) {
    const text = read(`public/flows/${file}`);
    assert.match(text, /^flowchart (TD|LR)\n/, `${file}: must start with "flowchart TD" or "flowchart LR"`);
    assert.ok(!text.includes("\t"), `${file}: no tab characters`);
    const opens = (text.match(/^\s*subgraph\b/gm) || []).length;
    const ends = (text.match(/^\s*end\s*$/gm) || []).length;
    assert.equal(opens, ends, `${file}: every subgraph needs an end`);
    const classes = new Set([...text.matchAll(/^\s*classDef (\w+)/gm)].map((m) => m[1]));
    for (const m of text.matchAll(/^\s*class [\w,]+ (\w+)\s*$/gm)) assert.ok(classes.has(m[1]), `${file}: class ${m[1]} is not defined`);
    assert.ok(text.length < 8000, `${file}: too long for one chart; split it`);
  }
});

test("guide.json is complete", () => {
  const m = manifest();
  assert.ok(m.title && m.intro, "title and intro");
  assert.equal(m.legend.length, 5, "five colours");
  assert.deepEqual(m.sections.map((s) => s.id), ["overview", "members", "admin", "behind", "newadmin", "setup"]);
  for (const s of m.sections) {
    assert.ok(s.tab && s.title && s.blurb, `${s.id}: tab, title and blurb`);
    assert.ok(Array.isArray(s.diagrams), `${s.id}: diagrams`);
    for (const d of s.diagrams) assert.ok(d.file && d.title && d.caption, `${s.id}: ${d.file} needs file, title, caption`);
  }
  for (const f of m.features) {
    assert.ok(f.audience && f.name && f.what, `feature ${f.name}`);
    assert.ok(STATUSES.has(f.status), `feature ${f.name}: status ${f.status}`);
  }
  for (const s of m.setup) {
    assert.ok(s.name && s.detail, `setup ${s.name}`);
    assert.ok(STATUSES.has(s.status), `setup ${s.name}: status ${s.status}`);
  }
});

test("the three charts the community asked for exist", () => {
  const files = diagramFiles();
  for (const needed of ["member.mmd", "admin-week.mmd", "handover-role.mmd", "handover-secrets.mmd", "handover-move.mmd"]) {
    assert.ok(files.includes(needed), `${needed} is missing`);
  }
});

test("the site links to the guide and the guide page loads its pieces", () => {
  assert.match(read("public/index.html"), /href="guide"/);
  const html = read("public/guide.html");
  for (const part of ["vendor/mermaid-11.17.2.min.js", "guide.js", "guide-view", "guide-tabs"]) assert.ok(html.includes(part), `guide.html lacks ${part}`);
  assert.ok(existsSync(join(ROOT, "public/vendor/mermaid-11.17.2.min.js")), "vendored Mermaid is missing");
});
