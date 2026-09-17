(() => {
  "use strict";

  const LS_WHOAMI = "jumat_whoami_id";
  const LS_ACCESS = "jumat_access_code";

  const state = {
    people: [],
    upcoming: [],
    history: [],
    availability: [],
    historyLoaded: false,
  };

  const $ = (sel) => document.querySelector(sel);

  // ---------- API helpers ----------

  let pendingRetry = null;

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json", ...(opts.headers || {}) };
    const method = (opts.method || "GET").toUpperCase();
    if (method !== "GET") {
      const code = localStorage.getItem(LS_ACCESS);
      if (code) headers["x-access-code"] = code;
    }
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) {
      return new Promise((resolve, reject) => {
        pendingRetry = () => api(path, opts).then(resolve, reject);
        openAccessModal();
      });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 3000);
  }

  // ---------- Access code modal ----------

  function openAccessModal() {
    $("#access-error").classList.add("hidden");
    $("#access-code-input").value = "";
    $("#access-modal").classList.remove("hidden");
    $("#access-code-input").focus();
  }
  function closeAccessModal() {
    $("#access-modal").classList.add("hidden");
    pendingRetry = null;
  }
  $("#access-cancel-btn").addEventListener("click", closeAccessModal);
  $("#access-save-btn").addEventListener("click", async () => {
    const code = $("#access-code-input").value.trim();
    if (!code) return;
    localStorage.setItem(LS_ACCESS, code);
    const retry = pendingRetry;
    pendingRetry = null;
    $("#access-modal").classList.add("hidden");
    if (retry) {
      try {
        await retry();
      } catch (e) {
        localStorage.removeItem(LS_ACCESS);
        $("#access-error").classList.remove("hidden");
        openAccessModal();
      }
    }
  });

  // ---------- Loading ----------

  async function loadAll() {
    const [people, upcoming, availability] = await Promise.all([
      api("/api/people"),
      api("/api/fridays?scope=upcoming"),
      api("/api/availability"),
    ]);
    state.people = people;
    state.upcoming = upcoming;
    state.availability = availability;
    renderWhoami();
    renderUpcoming();
    renderRoster();
  }

  async function loadHistory() {
    state.history = await api("/api/fridays?scope=history");
    state.historyLoaded = true;
    renderHistory();
  }

  // ---------- Who am I ----------

  function renderWhoami() {
    const select = $("#whoami-select");
    const current = localStorage.getItem(LS_WHOAMI) || "";
    const active = state.people.filter((p) => p.status === "active");
    select.innerHTML =
      '<option value="">— select your name —</option>' +
      active.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    select.value = current;
  }
  $("#whoami-select").addEventListener("change", (e) => {
    localStorage.setItem(LS_WHOAMI, e.target.value);
  });

  // ---------- Formatting ----------

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  function isNextFriday(iso, list) {
    const upcomingSorted = list.map((f) => f.date).sort();
    return upcomingSorted.length && upcomingSorted[0] === iso;
  }

  function peopleOptions(selectedId) {
    const active = state.people.filter((p) => p.status === "active" || p.id === selectedId);
    return (
      '<option value="">— open —</option>' +
      active
        .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("")
    );
  }

  // ---------- Upcoming schedule ----------

  function renderUpcoming() {
    const container = $("#upcoming-list");
    if (!state.upcoming.length) {
      container.innerHTML = '<p class="muted">No upcoming Fridays loaded yet.</p>';
      return;
    }
    container.innerHTML = state.upcoming.map((f) => renderWeekRow(f)).join("");
    attachWeekRowHandlers(container, state.upcoming);
  }

  function renderWeekRow(f) {
    const next = isNextFriday(f.date, state.upcoming);
    const avail = state.availability.filter((a) => a.friday_id === f.id);
    const chips = avail
      .map((a) => `<span class="chip ${a.status}">${escapeHtml(a.person_name)}</span>`)
      .join("");

    return `
    <article class="week-row ${next ? "is-next" : ""}" data-id="${f.id}">
      <div class="week-row-head">
        <span class="week-date">${formatDate(f.date)}</span>
        ${next ? '<span class="week-badge">Next Jumat</span>' : ""}
      </div>
      <div class="slots">
        <div class="slot">
          <label>Primary khatib</label>
          <select data-role="primary_khatib_id">${peopleOptions(f.primary_khatib_id)}</select>
        </div>
        <div class="slot">
          <label>Secondary khatib</label>
          <select data-role="secondary_khatib_id">${peopleOptions(f.secondary_khatib_id)}</select>
        </div>
      </div>
      <div class="meta-row">
        <div class="slot">
          <label>Venue</label>
          <input type="text" data-role="venue" value="${escapeHtml(f.venue || "")}" placeholder="e.g. Assembly Room - SENTAN" />
        </div>
        <div class="slot">
          <label>Info / notes</label>
          <input type="text" data-role="info" value="${escapeHtml(f.info || "")}" placeholder="optional note" />
        </div>
      </div>
      <div class="avail-row">
        <div class="avail-chips">${chips || '<span class="muted small">No availability marked yet</span>'}</div>
        <div class="avail-actions">
          <button class="btn btn-sm" data-role="mark-available" type="button">I'm available</button>
          <button class="btn btn-sm" data-role="mark-unavailable" type="button">I'm unavailable</button>
        </div>
      </div>
    </article>`;
  }

  function attachWeekRowHandlers(container, list) {
    container.querySelectorAll(".week-row").forEach((row) => {
      const fridayId = Number(row.dataset.id);
      const friday = list.find((f) => f.id === fridayId);

      row.querySelectorAll("select[data-role], input[data-role]").forEach((field) => {
        const role = field.dataset.role;
        const eventName = field.tagName === "SELECT" ? "change" : "change";
        field.addEventListener(eventName, async () => {
          const payload = {};
          if (role === "primary_khatib_id" || role === "secondary_khatib_id") {
            payload[role] = field.value ? Number(field.value) : null;
          } else {
            payload[role] = field.value;
          }
          const whoami = state.people.find((p) => String(p.id) === localStorage.getItem(LS_WHOAMI));
          if (whoami) payload.updated_by = whoami.name;
          try {
            const updated = await api(`/api/fridays/${fridayId}`, { method: "PATCH", body: JSON.stringify(payload) });
            Object.assign(friday, updated);
            toast("Saved");
          } catch (e) {
            toast(e.message, true);
          }
        });
      });

      row.querySelector('[data-role="mark-available"]').addEventListener("click", () => setAvailability(fridayId, "available"));
      row.querySelector('[data-role="mark-unavailable"]').addEventListener("click", () => setAvailability(fridayId, "unavailable"));
    });
  }

  async function setAvailability(fridayId, status) {
    const personId = Number(localStorage.getItem(LS_WHOAMI) || "");
    if (!personId) {
      toast("Pick your name from “You are” first", true);
      return;
    }
    try {
      const row = await api("/api/availability", {
        method: "POST",
        body: JSON.stringify({ person_id: personId, friday_id: fridayId, status }),
      });
      const idx = state.availability.findIndex((a) => a.person_id === row.person_id && a.friday_id === row.friday_id);
      if (idx >= 0) state.availability[idx] = row;
      else state.availability.push(row);
      renderUpcoming();
      toast(status === "available" ? "Marked available" : "Marked unavailable");
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------- Roster ----------

  function renderRoster() {
    const container = $("#roster-list");
    const active = state.people.filter((p) => p.status === "active");
    const inactive = state.people.filter((p) => p.status !== "active");

    const row = (p) => `
      <div class="roster-row ${p.status !== "active" ? "inactive" : ""}" data-id="${p.id}">
        <div>
          <div class="roster-name">${escapeHtml(p.name)}</div>
          <div class="roster-meta">${[p.country, p.role !== "khatib" ? p.role : null, p.note].filter(Boolean).map(escapeHtml).join(" · ")}</div>
        </div>
        <button class="btn btn-sm" data-toggle-status type="button">${p.status === "active" ? "Mark left NAIST" : "Mark active"}</button>
      </div>`;

    container.innerHTML =
      `<div class="roster-group-title">Active (${active.length})</div>` +
      active.map(row).join("") +
      `<div class="roster-group-title">No longer at NAIST (${inactive.length})</div>` +
      inactive.map(row).join("");

    container.querySelectorAll("[data-toggle-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const rowEl = btn.closest(".roster-row");
        const id = Number(rowEl.dataset.id);
        const person = state.people.find((p) => p.id === id);
        const nextStatus = person.status === "active" ? "inactive" : "active";
        try {
          const updated = await api(`/api/people/${id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
          Object.assign(person, updated);
          renderRoster();
          renderWhoami();
          renderUpcoming();
          toast("Roster updated");
        } catch (e) {
          toast(e.message, true);
        }
      });
    });
  }

  // ---------- Add person modal ----------

  function openAddPersonModal() {
    $("#new-person-name").value = "";
    $("#new-person-country").value = "";
    $("#new-person-role").value = "khatib";
    $("#add-person-error").classList.add("hidden");
    $("#add-person-modal").classList.remove("hidden");
    $("#new-person-name").focus();
  }
  $("#add-person-btn").addEventListener("click", openAddPersonModal);
  $("#add-person-cancel-btn").addEventListener("click", () => $("#add-person-modal").classList.add("hidden"));
  $("#add-person-save-btn").addEventListener("click", async () => {
    const name = $("#new-person-name").value.trim();
    const country = $("#new-person-country").value.trim();
    const role = $("#new-person-role").value;
    if (!name) {
      $("#add-person-error").textContent = "Name is required";
      $("#add-person-error").classList.remove("hidden");
      return;
    }
    try {
      const person = await api("/api/people", { method: "POST", body: JSON.stringify({ name, country, role }) });
      state.people.push(person);
      renderRoster();
      renderWhoami();
      renderUpcoming();
      $("#add-person-modal").classList.add("hidden");
      toast(`${name} added to the roster`);
    } catch (e) {
      $("#add-person-error").textContent = e.message;
      $("#add-person-error").classList.remove("hidden");
    }
  });

  // ---------- History ----------

  function renderHistory() {
    const container = $("#history-list");
    if (!state.history.length) {
      container.innerHTML = '<p class="muted">No archived rows.</p>';
      return;
    }
    container.innerHTML = state.history
      .map(
        (f) => `
      <article class="week-row">
        <div class="week-row-head"><span class="week-date">${formatDate(f.date)}</span></div>
        <p class="small">
          <strong>Primary:</strong> ${escapeHtml(f.primary_name || "—")} &nbsp;|&nbsp;
          <strong>Secondary:</strong> ${escapeHtml(f.secondary_name || "—")}
          ${f.venue ? ` &nbsp;|&nbsp; <strong>Venue:</strong> ${escapeHtml(f.venue)}` : ""}
        </p>
        ${f.info ? `<p class="small muted">${escapeHtml(f.info)}</p>` : ""}
      </article>`
      )
      .join("");
  }

  $("#toggle-history-btn").addEventListener("click", async () => {
    const list = $("#history-list");
    const btn = $("#toggle-history-btn");
    const showing = !list.classList.contains("hidden");
    if (showing) {
      list.classList.add("hidden");
      btn.textContent = "Show";
      return;
    }
    if (!state.historyLoaded) await loadHistory();
    list.classList.remove("hidden");
    btn.textContent = "Hide";
  });

  $("#refresh-btn").addEventListener("click", () => loadAll().catch((e) => toast(e.message, true)));

  loadAll().catch((e) => toast(e.message, true));
})();
