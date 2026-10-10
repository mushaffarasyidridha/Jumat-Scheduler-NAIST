// The guide page: draws the flowcharts in public/flows/*.mmd (Mermaid), one tab per
// audience. Everything it shows comes from public/flows/ - guide.json for the
// words, the .mmd files for the charts, inventory.json for the list that the code
// writes about itself - so changing the system means changing those files.
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATUS = {
    live: ["✅", "live"],
    "needs-setup": ["🔧", "needs setup"],
    done: ["✅", "done"],
    "in-progress": ["⏳", "in progress"],
    todo: ["☐", "to do"],
  };

  let manifest = null;
  let inventory = null;
  let activeId = null;
  let renderCount = 0;

  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  function initMermaid() {
    const d = dark();
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true, padding: 12 },
      themeVariables: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: "15px",
        lineColor: d ? "#9aa1ac" : "#6b7280",
        textColor: d ? "#eef0f3" : "#1a1d23",
        primaryColor: d ? "#2a3038" : "#eef7f2",
        primaryBorderColor: "#1f7a5c",
        primaryTextColor: d ? "#eef0f3" : "#1a1d23",
        clusterBkg: d ? "#1c1f26" : "#f7f8fa",
        clusterBorder: d ? "#3a404a" : "#c8ccd4",
        edgeLabelBackground: d ? "#1c1f26" : "#ffffff",
        titleColor: d ? "#eef0f3" : "#1a1d23",
      },
    });
  }

  // ---------- one chart ----------

  // scale 1 = "fit": what Mermaid chose (never wider than the page). Zooming multiplies
  // that width; in full screen scale 1 is the chart's natural size, scrolled if it is
  // wider than the screen, so it is readable on a phone.
  function applyZoom(card) {
    const svg = $("svg", card);
    if (!svg) return;
    const scale = Number(card.dataset.scale || 1);
    const full = card.classList.contains("guide-full");
    svg.style.width = "";
    svg.style.maxWidth = svg.dataset.fitMax || "";
    if (!full && scale === 1) return;
    const base = full ? svg.viewBox.baseVal.width : svg.getBoundingClientRect().width;
    svg.style.maxWidth = "none";
    svg.style.width = `${Math.round(base * scale)}px`;
  }

  function setFull(card, on) {
    card.classList.toggle("guide-full", on);
    document.body.classList.toggle("guide-noscroll", on);
    $("[data-full]", card).textContent = on ? "✕ Close" : "⤢ Full screen";
    card.dataset.scale = "1";
    applyZoom(card);
  }

  async function drawChart(card, diagram) {
    const holder = $(".guide-chart", card);
    let source = "";
    try {
      const res = await fetch(`flows/${diagram.file}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`could not load ${diagram.file} (HTTP ${res.status})`);
      source = await res.text();
      const { svg } = await window.mermaid.render(`guide-chart-${++renderCount}`, source);
      holder.innerHTML = svg;
      const drawing = $("svg", holder);
      drawing.dataset.fitMax = drawing.style.maxWidth;
      if (drawing.getBoundingClientRect().width < drawing.viewBox.baseVal.width * 0.8) $(".guide-hint", card).hidden = false;
      holder.setAttribute("role", "img");
      holder.setAttribute("aria-label", `${diagram.title}. ${diagram.caption}`);
      $("[data-source]", card).textContent = source;
      card.dataset.drawn = "yes";
    } catch (e) {
      holder.innerHTML =
        `<p class="guide-error">This flowchart could not be drawn (${escapeHtml(e.message || e)}). ` +
        `Its text is below, and GitHub draws it in docs/GUIDE.md.</p><pre class="guide-pre">${escapeHtml(source)}</pre>`;
      card.dataset.drawn = "failed";
    }
  }

  function chartCard(diagram) {
    const card = document.createElement("article");
    card.className = "guide-card";
    card.innerHTML = `
      <h3>${escapeHtml(diagram.title)}</h3>
      <p class="muted small">${escapeHtml(diagram.caption)}</p>
      <div class="guide-controls" role="group" aria-label="Zoom">
        <button type="button" class="btn btn-sm btn-ghost" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="btn btn-sm btn-ghost" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" class="btn btn-sm btn-ghost" data-zoom="fit">Reset</button>
        <button type="button" class="btn btn-sm btn-ghost" data-full>⤢ Full screen</button>
      </div>
      <p class="small muted guide-hint" hidden>The text is small here. Press ⤢ Full screen (or +) to read it at full size, then scroll sideways.</p>
      <div class="guide-chart" tabindex="0"><p class="muted small">Drawing…</p></div>
      <details class="small guide-text"><summary>Show this chart as text</summary><pre class="guide-pre" data-source></pre></details>`;

    const zoom = (factor) => {
      const next = Math.min(4, Math.max(0.5, Number(card.dataset.scale || 1) * factor));
      card.dataset.scale = String(next);
      applyZoom(card);
    };
    $("[data-zoom='in']", card).addEventListener("click", () => zoom(1.25));
    $("[data-zoom='out']", card).addEventListener("click", () => zoom(0.8));
    $("[data-zoom='fit']", card).addEventListener("click", () => {
      card.dataset.scale = "1";
      applyZoom(card);
    });
    $("[data-full]", card).addEventListener("click", () => setFull(card, !card.classList.contains("guide-full")));
    return card;
  }

  // ---------- tables ----------

  function table(headers, rows) {
    const wrap = document.createElement("div");
    wrap.className = "guide-table-wrap";
    wrap.innerHTML =
      `<table class="guide-table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
      "</tbody></table>";
    return wrap;
  }

  const badge = (status) => {
    const [icon, text] = STATUS[status] || ["", status];
    return `<span class="guide-badge guide-badge-${escapeHtml(status)}">${icon} ${escapeHtml(text)}</span>`;
  };
  const code = (text) => `<code>${escapeHtml(text)}</code>`;

  function heading(text) {
    const h = document.createElement("h3");
    h.className = "guide-h3";
    h.textContent = text;
    return h;
  }

  function featuresBlock() {
    const frag = document.createDocumentFragment();
    frag.append(heading("What the system can do"));
    frag.append(
      table(
        ["Who", "Feature", "What it does", "Status"],
        manifest.features.map((f) => [escapeHtml(f.audience), `<strong>${escapeHtml(f.name)}</strong>`, escapeHtml(f.what), badge(f.status)])
      )
    );
    return frag;
  }

  function setupBlock() {
    const frag = document.createDocumentFragment();
    frag.append(heading("What is switched on"));
    frag.append(table(["Part", "Status", "Notes"], manifest.setup.map((s) => [`<strong>${escapeHtml(s.name)}</strong>`, badge(s.status), escapeHtml(s.detail)])));
    return frag;
  }

  function inventoryBlock() {
    const frag = document.createDocumentFragment();
    if (!inventory) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "The list from the code could not be loaded.";
      frag.append(p);
      return frag;
    }
    frag.append(heading("The exact list, from the code"));
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Written by the code itself every time the system changes, so it cannot be out of date.";
    frag.append(note);

    frag.append(heading("Pages of the API"));
    frag.append(
      table(
        ["Address", "What it does", "Who can use it"],
        inventory.routes.map((r) => [code(r.route), escapeHtml(r.note), escapeHtml(r.methods.map((m) => `${m.method}: ${m.access}`).join("; "))])
      )
    );
    frag.append(heading("Database tables"));
    frag.append(table(["Table", "Created by"], inventory.tables.map((t) => [code(t.name), code(t.migration)])));
    frag.append(heading("Database changes, in order"));
    frag.append(table(["File", "What it changes"], inventory.migrations.map((m) => [code(m.file), escapeHtml(m.note)])));
    frag.append(heading("Robot jobs (GitHub Actions)"));
    frag.append(table(["Job", "When it runs"], inventory.workflows.map((w) => [`${escapeHtml(w.name)} ${code(w.file)}`, escapeHtml(w.when.join("; "))])));
    frag.append(heading("Settings and secrets"));
    frag.append(table(["Name", "Kept in", "What it is"], inventory.settings.map((s) => [code(s.name), escapeHtml(s.where), escapeHtml(s.note)])));
    return frag;
  }

  // ---------- tabs ----------

  async function showTab(id) {
    const section = manifest.sections.find((s) => s.id === id) || manifest.sections[0];
    activeId = section.id;
    for (const button of document.querySelectorAll(".guide-tab")) {
      const on = button.dataset.id === section.id;
      button.classList.toggle("active", on);
      button.setAttribute("aria-selected", String(on));
    }
    const view = $("#guide-view");
    view.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = section.title;
    const blurb = document.createElement("p");
    blurb.className = "muted";
    blurb.textContent = section.blurb;
    view.append(title, blurb);

    const cards = section.diagrams.map((d) => ({ card: chartCard(d), d }));
    for (const { card } of cards) view.append(card);
    const show = section.show || [];
    if (show.includes("setup")) view.append(setupBlock());
    if (show.includes("features")) view.append(featuresBlock());
    if (show.includes("inventory")) view.append(inventoryBlock());

    initMermaid();
    for (const { card, d } of cards) {
      if (activeId !== section.id) return; // the visitor moved on
      await drawChart(card, d);
    }
  }

  function buildTabs() {
    const nav = $("#guide-tabs");
    nav.innerHTML = "";
    for (const s of manifest.sections) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "guide-tab";
      button.dataset.id = s.id;
      button.setAttribute("role", "tab");
      button.textContent = s.tab;
      button.addEventListener("click", () => {
        history.replaceState(null, "", `#${s.id}`);
        showTab(s.id);
      });
      nav.append(button);
    }
  }

  function buildLegend() {
    $("#guide-legend").innerHTML = manifest.legend
      .map((l) => `<span class="guide-key"><i style="background:${escapeHtml(l.color)}"></i>${escapeHtml(l.text)}</span>`)
      .join("");
  }

  async function showVersion() {
    try {
      const res = await fetch("flows/version.json", { cache: "no-cache" });
      if (!res.ok) return;
      const v = await res.json();
      $("#guide-version").textContent = `Guide updated ${v.date} · version ${v.commit}`;
    } catch {
      // Only deployed copies have a version stamp.
    }
  }

  async function start() {
    try {
      const [m, inv] = await Promise.all([
        fetch("flows/guide.json", { cache: "no-cache" }).then((r) => r.json()),
        fetch("flows/inventory.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      manifest = m;
      inventory = inv;
    } catch (e) {
      $("#guide-intro").textContent = "The guide could not be loaded. Try again, or read docs/GUIDE.md on GitHub.";
      return;
    }
    if (!window.mermaid) {
      $("#guide-intro").textContent = "The chart drawing library did not load. The same guide is in docs/GUIDE.md on GitHub.";
    } else {
      $("#guide-intro").textContent = manifest.intro;
    }
    $("#guide-title").textContent = `📖 ${manifest.title}`;
    buildLegend();
    buildTabs();
    showVersion();
    await showTab(location.hash.slice(1));
  }

  window.addEventListener("hashchange", () => manifest && showTab(location.hash.slice(1)));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = $(".guide-card.guide-full");
    if (open) setFull(open, false);
  });
  // Colours follow the phone's light / dark setting.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => manifest && showTab(activeId));

  start();
})();
