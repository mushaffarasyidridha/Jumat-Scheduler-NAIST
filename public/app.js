(() => {
  "use strict";

  const LS_WHOAMI = "jumat_whoami_id";
  const LS_ACCESS = "jumat_access_code";

  const state = {
    people: [],
    fridays: [], // all rows, upcoming + history
    availability: [],
    calendarMonth: startOfMonthUTC(new Date()),
    openFridayId: null,
    plannerShowAll: false,
    reminderStatus: null, // admin only: when the daily reminder job last ran
    alerts: [], // admin only: "can't make it" alerts waiting for the admin
  };

  const $ = (sel) => document.querySelector(sel);

  // ---------- API helpers ----------

  let pendingRetry = null;

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json", ...(opts.headers || {}) };
    // Sent on GETs too (not just writes): /api/people only returns each
    // person's contact info when this matches the server's access code.
    const code = localStorage.getItem(LS_ACCESS);
    if (code) headers["x-access-code"] = code;
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

  function hasAccessCode() {
    return !!localStorage.getItem(LS_ACCESS);
  }

  // Roster edit controls only render once editing is unlocked, to keep the
  // roster compact for the (usual) read-only viewer, especially on a phone.
  function updateUnlockUI() {
    const unlocked = hasAccessCode();
    $("#unlock-btn").classList.toggle("hidden", unlocked);
    $("#add-person-btn").classList.toggle("hidden", !unlocked);
    $("#lock-btn").classList.toggle("hidden", !unlocked);
    $("#planner").classList.toggle("hidden", !unlocked);
  }

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
  $("#unlock-btn").addEventListener("click", () => openAccessModal()); // proactive: pendingRetry stays null
  // Hiding a section is not enough: its HTML (WhatsApp links, emails...) would
  // still be in the page for anyone who opens the developer tools. Empty it.
  function clearPrivateDom() {
    $("#planner-list").innerHTML = "";
    $("#person-line").innerHTML = "";
    for (const field of ["contact", "email", "whatsapp"]) $(`#person-${field}`).value = "";
  }

  $("#lock-btn").addEventListener("click", async () => {
    localStorage.removeItem(LS_ACCESS);
    state.reminderStatus = null;
    state.alerts = [];
    clearPrivateDom();
    updateUnlockUI();
    // Reload without the code so contact info and everyone's availability,
    // which were only sent because of it, don't linger on the page.
    await loadAll();
    toast("Editing locked");
  });

  $("#access-save-btn").addEventListener("click", async () => {
    const code = $("#access-code-input").value.trim();
    if (!code) return;
    const retry = pendingRetry;
    pendingRetry = null;

    if (retry) {
      // Reactive: a write already failed with 401. Trust the code enough to
      // retry once - if it's still wrong, that retry throws and we bail below.
      localStorage.setItem(LS_ACCESS, code);
      $("#access-modal").classList.add("hidden");
      try {
        await retry();
        await loadAll(); // now-authorized reads (e.g. contact info) weren't loaded yet
        updateUnlockUI();
      } catch (e) {
        localStorage.removeItem(LS_ACCESS);
        $("#access-error").classList.remove("hidden");
        openAccessModal();
      }
      return;
    }

    // Proactive ("Enter access code" button): nothing to retry, so verify
    // for real before unlocking edit controls the code can't actually use.
    try {
      const { authorized } = await fetch("/api/access-check", { headers: { "x-access-code": code } }).then((r) => r.json());
      if (!authorized) {
        $("#access-error").classList.remove("hidden");
        return;
      }
      localStorage.setItem(LS_ACCESS, code);
      $("#access-modal").classList.add("hidden");
      await loadAll();
      updateUnlockUI();
    } catch (e) {
      toast("Could not verify the code, try again", true);
    }
  });

  // ---------- Loading ----------

  function availabilityUrl() {
    if (hasAccessCode()) return "/api/availability"; // full picture
    const whoamiId = localStorage.getItem(LS_WHOAMI);
    // Without the code, the API only returns availability for a specific
    // person_id anyway - so there's nothing to fetch until one is picked.
    return whoamiId ? `/api/availability?person_id=${whoamiId}` : null;
  }

  // Plain fetch (not api()) so a stale access code can't pop the code dialog
  // for what is only an informational line in the planner.
  async function fetchReminderStatus() {
    if (!hasAccessCode()) return null;
    try {
      const res = await fetch("/api/reminders/status", { headers: { "x-access-code": localStorage.getItem(LS_ACCESS) } });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  // Same reasoning: a plain fetch, and nothing at all without the access code.
  async function fetchAlerts() {
    if (!hasAccessCode()) return [];
    try {
      const res = await fetch("/api/alerts", { headers: { "x-access-code": localStorage.getItem(LS_ACCESS) } });
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }

  async function loadAll() {
    const availUrl = availabilityUrl();
    const [people, fridays, availability, reminderStatus, alerts] = await Promise.all([
      api("/api/people"),
      api("/api/fridays"),
      availUrl ? api(availUrl) : Promise.resolve([]),
      fetchReminderStatus(),
      fetchAlerts(),
    ]);
    state.people = people;
    state.fridays = fridays;
    state.availability = availability;
    state.reminderStatus = reminderStatus;
    state.alerts = alerts;
    updateUnlockUI();
    renderWhoami();
    renderCalendar();
    renderRoster();
    if (state.openFridayId) {
      const friday = state.fridays.find((f) => f.id === state.openFridayId);
      if (friday) renderDayModalBody(friday);
    }
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
  $("#whoami-select").addEventListener("change", async (e) => {
    localStorage.setItem(LS_WHOAMI, e.target.value);
    // Without the access code, availability is fetched scoped to whoever is
    // selected - re-fetch so switching names shows the right person's marks.
    if (!hasAccessCode()) await loadAll();
  });

  // ---------- Formatting / date helpers ----------

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }
  function startOfMonthUTC(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  function todayISO() {
    const n = new Date();
    return isoDate(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  }
  function formatDateLong(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function monthLabel(d) {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  }

  // "naist_student" is the common case (most of the roster), so it's left
  // off the roster line entirely rather than stated on every row.
  const AFFILIATION_LABELS = { naist_staff: "NAIST Staff", dependent: "Dependent", outside: "Outside NAIST" };
  function affiliationLabel(affiliation) {
    return AFFILIATION_LABELS[affiliation] || null;
  }

  // allowedRoles scopes the list to who can actually fill that slot (e.g. the
  // Imam dropdown shouldn't offer someone whose role is plainly "khatib").
  // The currently-selected person always stays listed regardless, even if
  // inactive or their role changed since - so the UI never silently drops
  // the existing assignment from view.
  function peopleOptions(selectedId, allowedRoles) {
    const candidates = state.people.filter(
      (p) => p.id === selectedId || (p.status === "active" && (!allowedRoles || allowedRoles.includes(p.role)))
    );
    return (
      '<option value="">— open —</option>' +
      candidates
        .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("")
    );
  }

  // ---------- Calendar ----------

  function fridaysByDate() {
    const map = {};
    for (const f of state.fridays) map[f.date] = f;
    return map;
  }

  function nextJumatDate() {
    const today = todayISO();
    const upcoming = state.fridays.filter((f) => !f.is_history && f.date >= today).map((f) => f.date).sort();
    return upcoming[0] || null;
  }

  function renderCalendar() {
    $("#calendar-month-label").textContent = monthLabel(state.calendarMonth);

    const byDate = fridaysByDate();
    const nextJumat = nextJumatDate();
    const today = todayISO();

    const year = state.calendarMonth.getUTCFullYear();
    const month = state.calendarMonth.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const startOffset = firstOfMonth.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells = [];
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(Date.UTC(year, month, 1 - (startOffset - i)));
      cells.push({ date: d, otherMonth: true });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: new Date(Date.UTC(year, month, day)), otherMonth: false });
    }
    while (cells.length % 7 !== 0 || cells.length < 35) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last);
      d.setUTCDate(d.getUTCDate() + 1);
      cells.push({ date: d, otherMonth: true });
    }

    $("#calendar-grid").innerHTML = cells
      .map((cell) => {
        const iso = isoDate(cell.date);
        const isFriday = cell.date.getUTCDay() === 5;
        const friday = isFriday ? byDate[iso] : null;
        const classes = ["cal-day"];
        if (cell.otherMonth) classes.push("other-month");
        if (iso === today) classes.push("is-today");
        if (isFriday) classes.push("friday");
        if (friday) classes.push("clickable");

        let summary = "";
        if (friday) {
          const assigned = friday.primary_name || friday.secondary_name;
          const statusClass = friday.is_history ? "unavailable" : assigned ? "available" : "";
          const label = friday.is_history
            ? friday.primary_name || "archived"
            : assigned
            ? [friday.primary_name, friday.secondary_name].filter(Boolean).join(" / ")
            : "open";
          summary = `<span class="cal-day-summary"><span class="chip ${statusClass} name">${escapeHtml(label)}</span></span>`;
        }

        const tag = friday ? "button" : "div";
        const dataAttr = friday ? `data-friday-id="${friday.id}"` : "";
        const typeAttr = friday ? 'type="button"' : "";
        const isNext = friday && friday.date === nextJumat ? ' title="Next Jumat"' : "";
        return `<${tag} class="${classes.join(" ")}" ${dataAttr} ${typeAttr}${isNext}>
          <span class="cal-day-num">${cell.date.getUTCDate()}</span>
          ${summary}
        </${tag}>`;
      })
      .join("");

    $("#calendar-grid").querySelectorAll("button.cal-day").forEach((btn) => {
      btn.addEventListener("click", () => openDayModal(Number(btn.dataset.fridayId)));
    });
  }

  $("#cal-prev-btn").addEventListener("click", () => {
    const d = state.calendarMonth;
    state.calendarMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    renderCalendar();
  });
  $("#cal-next-btn").addEventListener("click", () => {
    const d = state.calendarMonth;
    state.calendarMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    renderCalendar();
  });
  $("#cal-today-btn").addEventListener("click", () => {
    state.calendarMonth = startOfMonthUTC(new Date());
    renderCalendar();
  });

  // ---------- Day detail modal ----------

  function openDayModal(fridayId) {
    const friday = state.fridays.find((f) => f.id === fridayId);
    if (!friday) return;
    state.openFridayId = fridayId;
    renderDayModalBody(friday);
    $("#day-modal").classList.remove("hidden");
  }
  function closeDayModal() {
    $("#day-modal").classList.add("hidden");
    state.openFridayId = null;
  }
  $("#day-modal-close-btn").addEventListener("click", closeDayModal);
  $("#day-modal").addEventListener("click", (e) => {
    if (e.target.id === "day-modal") closeDayModal();
  });

  // ---------- "Can't make it" (opened from the link in a calendar event) ----------

  // The event description links to /?friday=ID. This shows that Friday and one
  // button, so someone scheduled can say they can't come without hunting for the
  // right screen. Marking yourself unavailable needs no access code.
  function renderCantMakeItBody(friday, doneMessage = null) {
    $("#day-modal-title").textContent = "Can't make it?";
    const body = $("#day-modal-body");
    const lineup = [
      ["Khatib", friday.primary_name],
      ["Secondary", friday.secondary_name],
      ["Imam", friday.imam_name],
    ]
      .filter(([, name]) => name)
      .map(([label, name]) => `${label}: ${name}`)
      .join(" · ");

    const passed = friday.is_history || friday.date < todayISO();
    const scheduledIds = [friday.primary_khatib_id, friday.secondary_khatib_id, friday.imam_id].filter(Boolean);
    const active = state.people.filter((p) => p.status === "active");
    const scheduled = active.filter((p) => scheduledIds.includes(p.id));
    const others = active.filter((p) => !scheduledIds.includes(p.id));
    const mine = Number(localStorage.getItem(LS_WHOAMI) || "");
    const option = (p) => `<option value="${p.id}" ${p.id === mine ? "selected" : ""}>${escapeHtml(p.name)}</option>`;

    let action;
    if (doneMessage) {
      action = `<p class="cant-done">${escapeHtml(doneMessage)}</p>`;
    } else if (passed) {
      action = '<p class="muted">This Friday has already passed.</p>';
    } else {
      action = `
        <label class="slot"><span>I am</span>
          <select id="cant-person">
            <option value="">Choose your name…</option>
            ${scheduled.length ? `<optgroup label="Scheduled this Friday">${scheduled.map(option).join("")}</optgroup>` : ""}
            <optgroup label="Everyone else">${others.map(option).join("")}</optgroup>
          </select>
        </label>
        <button id="cant-submit" class="btn btn-primary" type="button">I can't make it</button>
        <p class="small muted">The admin is told right away and will find a replacement.</p>`;
    }

    body.innerHTML = `
      <p class="day-modal-date">${formatDateLong(friday.date)}</p>
      ${lineup ? `<p class="small">${escapeHtml(lineup)}</p>` : ""}
      ${action}
      <p class="small"><button id="cant-full" class="btn btn-ghost btn-sm" type="button">Open this Friday's full details</button></p>`;

    body.querySelector("#cant-full").addEventListener("click", () => openDayModal(friday.id));
    body.querySelector("#cant-submit")?.addEventListener("click", async () => {
      const personId = Number(body.querySelector("#cant-person").value);
      if (!personId) {
        toast("Choose your name first", true);
        return;
      }
      try {
        const row = await api("/api/availability", {
          method: "POST",
          body: JSON.stringify({ person_id: personId, friday_id: friday.id, status: "unavailable" }),
        });
        localStorage.setItem(LS_WHOAMI, String(personId));
        renderWhoami();
        const idx = state.availability.findIndex((a) => a.person_id === row.person_id && a.friday_id === row.friday_id);
        if (idx >= 0) state.availability[idx] = row;
        else state.availability.push(row);
        renderPlanner();
        renderCantMakeItBody(
          friday,
          row.alerted
            ? "Thank you. The admin has been told and will find a replacement."
            : row.scheduled
            ? "Noted. The admin had already been told."
            : "Noted. You are not scheduled for this Friday, so there is nothing to replace; your answer is saved."
        );
      } catch (e) {
        toast(e.message, true);
      }
    });
  }

  function openCantMakeIt(friday) {
    renderCantMakeItBody(friday);
    $("#day-modal").classList.remove("hidden");
  }

  // Runs once after the first load: /?friday=ID opens that Friday's "can't make it" box.
  function openCantMakeItFromUrl() {
    const id = Number(new URLSearchParams(location.search).get("friday"));
    if (!Number.isInteger(id) || id <= 0) return;
    history.replaceState(null, "", location.pathname + location.hash);
    const friday = state.fridays.find((f) => f.id === id);
    if (friday) openCantMakeIt(friday);
    else toast("That Friday was not found", true);
  }

  function renderDayModalBody(friday) {
    $("#day-modal-title").textContent = friday.is_history ? "Archived Jumat" : "Jumat schedule";
    const body = $("#day-modal-body");

    if (friday.is_history) {
      body.innerHTML = `
        <p class="day-modal-date">${formatDateLong(friday.date)}</p>
        <p class="day-modal-readonly-note small muted">Archived entry — read only.</p>
        <p class="small"><strong>Primary:</strong> ${escapeHtml(friday.primary_name || "—")}</p>
        <p class="small"><strong>Secondary:</strong> ${escapeHtml(friday.secondary_name || "—")}</p>
        ${friday.imam_name ? `<p class="small"><strong>Imam:</strong> ${escapeHtml(friday.imam_name)}</p>` : ""}
        ${friday.venue ? `<p class="small"><strong>Venue:</strong> ${escapeHtml(friday.venue)}</p>` : ""}
        ${friday.info ? `<p class="small muted">${escapeHtml(friday.info)}</p>` : ""}
      `;
      return;
    }

    const avail = state.availability.filter((a) => a.friday_id === friday.id);
    const chips = avail.map((a) => `<span class="chip ${a.status}">${escapeHtml(a.person_name)}</span>`).join("");

    body.innerHTML = `
      <p class="day-modal-date">${formatDateLong(friday.date)}</p>
      <div class="slots">
        <div class="slot">
          <label>Primary khatib</label>
          <select data-role="primary_khatib_id">${peopleOptions(friday.primary_khatib_id, ["khatib", "both"])}</select>
        </div>
        <div class="slot">
          <label>Secondary khatib</label>
          <select data-role="secondary_khatib_id">${peopleOptions(friday.secondary_khatib_id, ["khatib", "both"])}</select>
        </div>
        <div class="slot">
          <label>Imam</label>
          <select data-role="imam_id">${peopleOptions(friday.imam_id, ["imam", "both"])}</select>
        </div>
      </div>
      <div class="meta-row">
        <div class="slot">
          <label>Venue</label>
          <input type="text" data-role="venue" value="${escapeHtml(friday.venue || "")}" placeholder="e.g. Assembly Room - SENTAN" />
        </div>
        <div class="slot">
          <label>Info / notes</label>
          <input type="text" data-role="info" value="${escapeHtml(friday.info || "")}" placeholder="optional note" />
        </div>
      </div>
      <div class="avail-row">
        <div class="avail-chips">${chips || '<span class="muted small">No availability marked yet</span>'}</div>
        <div class="avail-actions">
          <button class="btn btn-sm" data-role="mark-available" type="button">I'm available</button>
          <button class="btn btn-sm" data-role="mark-unavailable" type="button">I'm unavailable</button>
          <button class="btn btn-sm btn-ghost" data-role="clear-availability" type="button">Clear my mark</button>
        </div>
      </div>
      <div class="announce-row">
        <button class="btn btn-sm" data-role="generate-announcement" type="button">📢 Generate announcement</button>
      </div>
    `;

    body.querySelectorAll("select[data-role], input[data-role]").forEach((field) => {
      field.addEventListener("change", () => saveFridayField(friday, field.dataset.role, field.value));
    });
    body.querySelector('[data-role="mark-available"]').addEventListener("click", () => setAvailability(friday.id, "available"));
    body.querySelector('[data-role="mark-unavailable"]').addEventListener("click", () => setAvailability(friday.id, "unavailable"));
    body.querySelector('[data-role="clear-availability"]').addEventListener("click", () => clearAvailability(friday.id));
    body.querySelector('[data-role="generate-announcement"]').addEventListener("click", () => openAnnouncementModal(friday));
  }

  async function saveFridayField(friday, role, value) {
    const payload = {};
    if (role === "primary_khatib_id" || role === "secondary_khatib_id" || role === "imam_id") {
      payload[role] = value ? Number(value) : null;
    } else {
      payload[role] = value;
    }
    const whoami = state.people.find((p) => String(p.id) === localStorage.getItem(LS_WHOAMI));
    if (whoami) payload.updated_by = whoami.name;
    try {
      const updated = await api(`/api/fridays/${friday.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      Object.assign(friday, updated);
      renderCalendar();
      renderPlanner();
      toast("Saved");
    } catch (e) {
      toast(e.message, true);
      renderPlanner(); // snap any planner dropdown back to what's actually saved
    }
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
      const friday = state.fridays.find((f) => f.id === fridayId);
      if (friday) renderDayModalBody(friday);
      renderPlanner();
      if (status === "available") toast("Marked available");
      else toast(row.alerted ? "Marked unavailable. The admin has been notified." : "Marked unavailable");
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function clearAvailability(fridayId) {
    const personId = Number(localStorage.getItem(LS_WHOAMI) || "");
    if (!personId) {
      toast("Pick your name from “You are” first", true);
      return;
    }
    try {
      await api(`/api/availability?person_id=${personId}&friday_id=${fridayId}`, { method: "DELETE" });
      state.availability = state.availability.filter((a) => !(a.person_id === personId && a.friday_id === fridayId));
      const friday = state.fridays.find((f) => f.id === fridayId);
      if (friday) renderDayModalBody(friday);
      renderPlanner();
      toast("Cleared your mark");
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------- Admin planner (unlocked only) ----------

  // Two turns closer together than this get a warning marker.
  const CLOSE_GAP_WEEKS = 4;
  const PLANNER_DEFAULT_ROWS = 8;
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const PLANNER_SLOTS = [
    { field: "primary_khatib_id", label: "Primary khatib", turns: "khatib", roles: ["khatib", "both"] },
    { field: "secondary_khatib_id", label: "Secondary khatib", turns: "khatib", roles: ["khatib", "both"] },
    { field: "imam_id", label: "Imam", turns: "imam", roles: ["imam", "both"] },
  ];

  const lineEnabled = () => !!(state.reminderStatus && state.reminderStatus.line_configured);

  // How the automatic reminders can reach this person. null when we don't hold
  // their contact details (no access code), so nothing is shown rather than a
  // wrong "none". LINE is only mentioned when the LINE bot is set up.
  function reminderReach(person) {
    if (!person || !("email" in person)) return null;
    const channels = [];
    if (person.email) channels.push("email");
    if (lineEnabled() && person.line_linked) channels.push("LINE");
    if (!person.reminders) return { text: "🔕 automatic reminders switched off", warn: true };
    if (!channels.length) return { text: `⚠ no ${lineEnabled() ? "email or LINE" : "email"}: send it by hand`, warn: true };
    return { text: `🔔 reminders by ${channels.join(" + ")}`, warn: false };
  }

  // Same text the automatic reminders use, for sending by hand (Copy / WhatsApp).
  function reminderTextFor(friday, person) {
    const shared = window.JumatReminderMessage;
    const roles = shared.ROLE_SLOTS.filter((s) => friday[s.field] === person.id).map((s) => s.label);
    const days = Math.round((Date.parse(friday.date) - Date.parse(todayISO())) / 86400000);
    return shared.chatText({ friday, person, roles, days, siteUrl: location.origin });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard blocked or unavailable: fall back to the old selection trick.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  // "Can't make it" alerts: someone scheduled for a Friday said they can't come.
  // Shown at the top of the planner until the admin dismisses them.
  function alertsHtml() {
    if (!state.alerts.length) return "";
    const items = state.alerts
      .map(
        (a) => `
        <li class="planner-alert-item">
          <span><strong>${escapeHtml(a.person_name)}</strong> can't make it on <strong>${formatDateLong(a.date)}</strong> (${escapeHtml(a.roles)})</span>
          <span class="planner-alert-actions">
            <button class="btn btn-sm" data-alert-goto="${a.friday_id}" type="button">Find a replacement</button>
            <button class="btn btn-sm btn-ghost" data-alert-ack="${a.id}" type="button">Got it</button>
          </span>
        </li>`
      )
      .join("");
    return `<div class="planner-alerts" role="alert">
      <p class="planner-alerts-title">🔔 ${state.alerts.length === 1 ? "1 person" : `${state.alerts.length} people`} can't make it</p>
      <ul>${items}</ul>
    </div>`;
  }

  // The admin's own to-do reminder (send the WhatsApp / Facebook reminders,
  // post the announcement) only works if someone is marked admin AND can be
  // reached, so say so rather than let it silently never arrive.
  function adminStatusHtml() {
    const admins = state.reminderStatus && state.reminderStatus.admins;
    if (!admins || admins.reachable > 0) return "";
    const why =
      admins.total === 0
        ? "No admin is set, so nobody is reminded to send the WhatsApp / Facebook reminders and post the announcement. In the roster, Edit your own name and tick “Admin this period”."
        : "The admin has no email or LINE link, so the to-do reminder can't reach them. In the roster, Edit them and add an email (or a LINE link).";
    return `<p class="small planner-status warn">🛠 ${why}</p>`;
  }

  function reminderStatusHtml() {
    const status = state.reminderStatus;
    if (!status) return "";
    if (!status.last_run) {
      return '<p class="small planner-status warn">🔔 Automatic reminders haven\'t run yet. They start once the daily job is set up (see the README).</p>';
    }
    const last = status.last_run;
    const ranAt = new Date(last.ran_at);
    const stale = Date.now() - ranAt.getTime() > 2 * 24 * 60 * 60 * 1000;
    const when = ranAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const counts = `${last.sent} sent${last.failed ? `, ${last.failed} failed` : ""}`;
    const warning = stale
      ? " That is more than 2 days ago: GitHub switches scheduled jobs off after 60 days without repository activity. Open the repo's Actions tab, choose “Send Jumat reminders” and re-enable it."
      : "";
    return `<p class="small planner-status ${stale || last.failed ? "warn" : ""}">${stale ? "⚠" : "🔔"} Automatic reminders last ran ${escapeHtml(when)} (${counts}).${warning}</p>`;
  }

  function normName(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Archived and guest rows only carry free-text names. Match them to the
  // roster by exact name (or a unique first word when the archive used just a
  // first name); anything ambiguous stays unmatched rather than guessed.
  function rosterIdForName(name) {
    const key = normName(name);
    if (!key) return null;
    const exact = state.people.filter((p) => normName(p.name) === key);
    if (exact.length) return exact.length === 1 ? exact[0].id : null;
    if (!key.includes(" ")) {
      const byFirstWord = state.people.filter((p) => normName(p.name).split(" ")[0] === key);
      if (byFirstWord.length === 1) return byFirstWord[0].id;
    }
    return null;
  }

  // personId -> ascending ISO dates of their turns. Khatib counts the primary
  // only (the person who actually gives the khutbah; secondary is standby).
  function buildTurns(kind) {
    const turns = new Map();
    for (const f of state.fridays) {
      const id =
        kind === "imam"
          ? f.imam_id ?? rosterIdForName(f.imam_name)
          : f.primary_khatib_id ?? rosterIdForName(f.primary_name);
      if (id == null) continue;
      if (!turns.has(id)) turns.set(id, []);
      turns.get(id).push(f.date);
    }
    for (const dates of turns.values()) dates.sort();
    return turns;
  }

  function weeksBetween(fromIso, toIso) {
    return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_WEEK);
  }

  // Weeks from this person's previous turn to `date`, and from `date` to their
  // next one. A turn on `date` itself is the row being edited, so it's skipped.
  function turnGaps(turns, personId, date) {
    let prev = null;
    let next = null;
    for (const d of turns.get(personId) || []) {
      if (d === date) continue;
      if (d < date) prev = d;
      else if (next === null) next = d;
    }
    return {
      prevWeeks: prev === null ? null : weeksBetween(prev, date),
      nextWeeks: next === null ? null : weeksBetween(date, next),
    };
  }

  function plannerOptions(friday, slot, turnsByKind, availability) {
    const selectedId = friday[slot.field];
    const otherKhatibId =
      slot.field === "primary_khatib_id" ? friday.secondary_khatib_id
      : slot.field === "secondary_khatib_id" ? friday.primary_khatib_id
      : null;
    const rank = { available: 0, unavailable: 2 };

    const entries = state.people
      .filter((p) => p.id === selectedId || (p.status === "active" && slot.roles.includes(p.role)))
      .map((p) => {
        const status = availability.get(p.id) || null;
        const gaps = turnGaps(turnsByKind[slot.turns], p.id, friday.date);
        return { p, status, ...gaps };
      })
      .sort(
        (a, b) =>
          (rank[a.status] ?? 1) - (rank[b.status] ?? 1) ||
          (b.prevWeeks ?? Infinity) - (a.prevWeeks ?? Infinity) ||
          a.p.name.localeCompare(b.p.name)
      );

    const options = entries.map(({ p, status, prevWeeks, nextWeeks }) => {
      const mark = status === "available" ? "✓ " : status === "unavailable" ? "✗ " : "";
      const prev = prevWeeks === null ? "no prior record" : `prev ${prevWeeks}w`;
      const next = nextWeeks === null ? "" : ` · next +${nextWeeks}w`;
      const close = (prevWeeks !== null && prevWeeks < CLOSE_GAP_WEEKS) || (nextWeeks !== null && nextWeeks < CLOSE_GAP_WEEKS);
      const dup = otherKhatibId === p.id && p.id !== selectedId ? " · already set as the other khatib" : "";
      const label = `${mark}${p.name} · ${prev}${next}${close ? " ⚠" : ""}${dup}`;
      return `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    });
    return '<option value="">— open —</option>' + options.join("");
  }

  function renderPlanner() {
    const section = $("#planner");
    const unlocked = hasAccessCode();
    section.classList.toggle("hidden", !unlocked);
    if (!unlocked) {
      clearPrivateDom();
      return;
    }

    const list = $("#planner-list");
    // Re-rendering after every save keeps the labels honest (assigning someone
    // changes the gaps shown in every other row), so put focus back afterwards.
    const active = document.activeElement;
    const focusKey = list.contains(active) && active.dataset.slot ? `${active.closest(".planner-row").dataset.id}:${active.dataset.slot}` : null;

    const today = todayISO();
    const upcoming = state.fridays.filter((f) => !f.is_history && f.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const turnsByKind = { khatib: buildTurns("khatib"), imam: buildTurns("imam") };

    const legend = `
      ${alertsHtml()}
      ${reminderStatusHtml()}
      ${adminStatusHtml()}
      <p class="small muted planner-legend">
        Every upcoming Friday in one place — pick directly from each list.
        <strong>✓</strong> available · <strong>✗</strong> unavailable ·
        <strong>prev</strong> / <strong>next</strong> = weeks between that person's turns around that Friday ·
        <strong>⚠</strong> = closer than ${CLOSE_GAP_WEEKS} weeks. Each list shows available people first, then whoever has gone longest since their last turn.
      </p>
      <details class="small muted planner-notes">
        <summary>How these numbers are worked out</summary>
        <p>Khatib turns count the <em>primary</em> khatib only (the one who gives the khutbah); the secondary is standby. "No prior record" only means none was found in the schedule — the archive covers 2025 and the weeks in this app. Archived names are matched to the roster by exact name (or a unique first name), so a differently spelled name won't be counted.</p>
      </details>`;

    if (!upcoming.length) {
      list.innerHTML = legend + '<p class="muted">No upcoming Fridays yet.</p>';
      return;
    }

    // Hidden rows still count toward everyone's prev/next gaps (those come
    // from state.fridays); this only limits how many cards are drawn.
    const visible = state.plannerShowAll ? upcoming : upcoming.slice(0, PLANNER_DEFAULT_ROWS);
    const rows = visible.map((f) => {
      const availability = new Map(state.availability.filter((a) => a.friday_id === f.id).map((a) => [a.person_id, a.status]));
      const chips = (status) =>
        state.availability
          .filter((a) => a.friday_id === f.id && a.status === status)
          .map((a) => `<span class="chip ${status}">${escapeHtml(a.person_name)}</span>`)
          .join("");
      const yes = chips("available");
      const no = chips("unavailable");
      const availHtml =
        yes || no
          ? `${yes ? `<span class="planner-avail-label">Available</span> ${yes}` : ""}${no ? ` <span class="planner-avail-label">Not available</span> ${no}` : ""}`
          : '<span class="muted small">No availability marked yet</span>';

      const selects = PLANNER_SLOTS.map((slot) => {
        const person = state.people.find((p) => p.id === f[slot.field]);
        const reach = reminderReach(person);
        // Manual sending, for people the automatic email can't reach (or any
        // time you'd rather nudge someone yourself). Only for roster people:
        // a free-text guest has no contact details to use.
        let send = "";
        if (person) {
          const waHref = person.whatsapp
            ? window.JumatReminderMessage.whatsappLink(person.whatsapp, reminderTextFor(f, person))
            : null;
          send = `
            <div class="planner-send">
              <button class="btn btn-sm btn-ghost" data-copy-slot="${slot.field}" type="button">📋 Copy reminder</button>
              ${waHref ? `<a class="btn btn-sm btn-ghost" data-wa-slot="${slot.field}" href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>` : ""}
            </div>`;
        }
        return `
          <div class="planner-slot-col">
            <label class="planner-slot">
              <span>${slot.label}</span>
              <select data-slot="${slot.field}">${plannerOptions(f, slot, turnsByKind, availability)}</select>
              ${reach ? `<small class="planner-reach ${reach.warn ? "warn" : ""}">${escapeHtml(reach.text)}</small>` : ""}
            </label>
            ${send}
          </div>`;
      }).join("");

      return `
        <article class="planner-row" data-id="${f.id}">
          <div class="planner-row-head">
            <strong>${formatDateLong(f.date)}</strong>
            ${state.alerts
              .filter((a) => a.friday_id === f.id)
              .map((a) => `<span class="planner-alert-badge">⚠ ${escapeHtml(a.person_name)} can't make it</span>`)
              .join("")}
            <button class="btn btn-sm btn-ghost" data-planner-open type="button">Details &amp; announcement</button>
          </div>
          <div class="planner-slots">${selects}</div>
          <div class="planner-avail">${availHtml}</div>
        </article>`;
    });

    const toggle =
      upcoming.length > PLANNER_DEFAULT_ROWS
        ? `<button class="btn btn-sm btn-ghost planner-more" type="button">${
            state.plannerShowAll ? "Show fewer" : `Show all ${upcoming.length} Fridays`
          }</button>`
        : "";
    list.innerHTML = legend + rows.join("") + toggle;

    list.querySelector(".planner-more")?.addEventListener("click", () => {
      state.plannerShowAll = !state.plannerShowAll;
      renderPlanner();
    });

    list.querySelectorAll("[data-alert-ack]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.alertAck);
        try {
          await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ acknowledged: true }) });
          state.alerts = state.alerts.filter((a) => a.id !== id);
          renderPlanner();
        } catch (e) {
          toast(e.message, true);
        }
      });
    });
    list.querySelectorAll("[data-alert-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.alertGoto;
        let row = list.querySelector(`.planner-row[data-id="${id}"]`);
        if (!row) {
          // That Friday is past the rows shown by default.
          state.plannerShowAll = true;
          renderPlanner();
          row = list.querySelector(`.planner-row[data-id="${id}"]`);
        }
        if (!row) return;
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.add("planner-row-flash");
        setTimeout(() => row.classList.remove("planner-row-flash"), 2000);
      });
    });

    list.querySelectorAll(".planner-row").forEach((row) => {
      const friday = state.fridays.find((f) => f.id === Number(row.dataset.id));
      row.querySelector("[data-planner-open]").addEventListener("click", () => openDayModal(friday.id));
      row.querySelectorAll("select[data-slot]").forEach((select) => {
        select.addEventListener("change", () => saveFridayField(friday, select.dataset.slot, select.value));
      });
      row.querySelectorAll("[data-copy-slot]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const person = state.people.find((p) => p.id === friday[btn.dataset.copySlot]);
          if (!person) return;
          const ok = await copyText(reminderTextFor(friday, person));
          toast(ok ? `Reminder for ${person.name} copied - paste it into any chat` : "Couldn't copy: your browser blocked the clipboard", !ok);
        });
      });
    });

    if (focusKey) {
      const [id, slot] = focusKey.split(":");
      list.querySelector(`.planner-row[data-id="${id}"] select[data-slot="${slot}"]`)?.focus();
    }
  }

  // ---------- Jumat announcement generator ----------

  // The text itself lives in announcement.js, shared with the calendar events
  // (whose description is this same broadcast).
  const announcement = window.JumatAnnouncement;

  let announcementFriday = null;
  let announcementHadith = null;

  function renderAnnouncementText() {
    $("#announcement-text").value = announcement.buildAnnouncementText(announcementFriday, announcementHadith);
  }

  function openAnnouncementModal(friday) {
    announcementFriday = friday;
    announcementHadith = announcement.randomHadith();
    renderAnnouncementText();
    $("#announcement-modal").classList.remove("hidden");
  }
  $("#announcement-close-btn").addEventListener("click", () => $("#announcement-modal").classList.add("hidden"));
  $("#announcement-reroll-btn").addEventListener("click", () => {
    announcementHadith = announcement.randomHadith();
    renderAnnouncementText();
  });
  $("#announcement-copy-btn").addEventListener("click", async () => {
    const text = $("#announcement-text").value;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch (e) {
      $("#announcement-text").select();
      toast("Press Ctrl/Cmd+C to copy (clipboard access was blocked)", true);
    }
  });

  // ---------- Roster ----------

  function renderRoster() {
    const container = $("#roster-list");
    const active = state.people.filter((p) => p.status === "active");
    const inactive = state.people.filter((p) => p.status !== "active");

    const unlocked = hasAccessCode();
    const row = (p) => `
      <div class="roster-row ${p.status !== "active" ? "inactive" : ""}" data-id="${p.id}">
        <div>
          <div class="roster-name">${escapeHtml(p.name)}</div>
          <div class="roster-meta">${[affiliationLabel(p.affiliation), p.country, p.role !== "khatib" ? p.role : null, p.note].filter(Boolean).map(escapeHtml).join(" · ")}</div>
          ${"contact" in p ? `<div class="roster-meta">${p.contact ? "📞 " + escapeHtml(p.contact) : '<span class="muted">no contact on file</span>'}</div>` : ""}
          ${p.whatsapp ? `<div class="roster-meta">💬 ${escapeHtml(p.whatsapp)}</div>` : ""}
          ${reminderReach(p) ? `<div class="roster-meta">${escapeHtml(reminderReach(p).text)}</div>` : ""}
          ${p.is_admin ? '<div class="roster-meta">🛠 Admin this period: gets the to-do reminders</div>' : ""}
        </div>
        ${
          unlocked
            ? `<div class="roster-row-actions">
                <button class="btn btn-sm" data-edit-person type="button">Edit</button>
                <button class="btn btn-sm" data-toggle-status type="button">${p.status === "active" ? "Mark left NAIST" : "Mark active"}</button>
                <button class="btn btn-sm btn-danger" data-delete-person type="button" title="Remove this person entirely (use this for a mistyped or duplicate name, not someone who just left NAIST)">Delete</button>
              </div>`
            : ""
        }
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
          renderCalendar();
          toast("Roster updated");
        } catch (e) {
          toast(e.message, true);
        }
      });
    });

    container.querySelectorAll("[data-edit-person]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.closest(".roster-row").dataset.id);
        openPersonModal(state.people.find((p) => p.id === id));
      });
    });

    container.querySelectorAll("[data-delete-person]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const rowEl = btn.closest(".roster-row");
        const id = Number(rowEl.dataset.id);
        const person = state.people.find((p) => p.id === id);
        if (!confirm(`Delete "${person.name}" from the roster? This can't be undone.`)) return;
        try {
          await api(`/api/people/${id}`, { method: "DELETE" });
          if (localStorage.getItem(LS_WHOAMI) === String(id)) localStorage.removeItem(LS_WHOAMI);
          await loadAll(); // deleting can clear their khatib assignments/availability, so refresh everything
          toast(`${person.name} removed`);
        } catch (e) {
          toast(e.message, true);
        }
      });
    });

    // The planner's dropdowns are built from the same roster, so any roster
    // change (add, edit, left NAIST, delete) has to refresh it too.
    renderPlanner();
  }

  // ---------- Add / edit person modal ----------

  let editingPersonId = null;

  function openPersonModal(person) {
    editingPersonId = person ? person.id : null;
    $("#person-modal-title").textContent = person ? "Edit person" : "Add a person";
    $("#person-save-btn").textContent = person ? "Save" : "Add";
    $("#person-name").value = person ? person.name : "";
    $("#person-affiliation").value = person ? person.affiliation || "naist_student" : "naist_student";
    $("#person-country").value = person ? person.country || "" : "";
    $("#person-role").value = person ? person.role : "khatib";
    $("#person-note").value = person ? person.note || "" : "";
    // Blank (not "no contact") when we don't have read access to it, so
    // saving from this state can't accidentally overwrite it with nothing.
    $("#person-contact").value = person && "contact" in person ? person.contact || "" : "";
    $("#person-email").value = person && "email" in person ? person.email || "" : "";
    $("#person-whatsapp").value = person && "whatsapp" in person ? person.whatsapp || "" : "";
    $("#person-reminders").checked = person && "reminders" in person ? !!person.reminders : true;
    $("#person-admin").checked = person && "is_admin" in person ? !!person.is_admin : false;
    renderPersonLineBox(person);
    $("#person-error").classList.add("hidden");
    $("#person-modal").classList.remove("hidden");
    $("#person-name").focus();
  }

  // LINE can only message people who added the bot, so linking is a handshake:
  // the admin generates a one-time code here, the person sends it to the bot,
  // and the server stores their LINE user id. `codeInfo` is the freshly
  // generated {code, expires_at}, shown until the box is next re-rendered.
  function renderPersonLineBox(person, codeInfo = null) {
    const box = $("#person-line");
    // Not shown at all unless the LINE bot is set up on this site: most
    // installs only use email, and a box about an unavailable channel is noise.
    if (!hasAccessCode() || !lineEnabled()) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");

    if (!person) {
      box.innerHTML = '<p class="muted">LINE reminders: save this person first, then edit them to link LINE.</p>';
      return;
    }
    if (!("line_linked" in person)) {
      box.classList.add("hidden");
      return;
    }

    if (person.line_linked) {
      box.innerHTML = `
        <p><strong>LINE:</strong> ✅ linked — reminders also go to their LINE.</p>
        <div class="line-box-actions"><button class="btn btn-sm btn-danger" data-line-unlink type="button">Unlink LINE</button></div>`;
    } else if (codeInfo) {
      const until = new Date(codeInfo.expires_at).toLocaleDateString(undefined, { dateStyle: "medium" });
      box.innerHTML = `
        <p><strong>LINE:</strong> ask ${escapeHtml(person.name)} to add the LINE bot as a friend, then send the bot this message:</p>
        <div class="line-code">${escapeHtml(codeInfo.code)}</div>
        <p class="muted small">Works once, until ${escapeHtml(until)}.</p>
        <div class="line-box-actions"><button class="btn btn-sm" data-line-check type="button">Check if linked</button></div>`;
    } else {
      box.innerHTML = `
        <p><strong>LINE:</strong> not linked.</p>
        <div class="line-box-actions"><button class="btn btn-sm" data-line-code type="button">Get LINE link code</button></div>`;
    }

    box.querySelector("[data-line-code]")?.addEventListener("click", async () => {
      try {
        renderPersonLineBox(person, await api(`/api/people/${person.id}/line`, { method: "POST" }));
      } catch (e) {
        toast(e.message, true);
      }
    });
    box.querySelector("[data-line-check]")?.addEventListener("click", async () => {
      try {
        const fresh = (await api("/api/people")).find((p) => p.id === person.id);
        if (!fresh) return;
        Object.assign(person, fresh);
        if (person.line_linked) {
          renderRoster();
          toast("LINE linked");
        } else {
          toast("Not linked yet - they haven't sent the code");
        }
        renderPersonLineBox(person, person.line_linked ? null : codeInfo);
      } catch (e) {
        toast(e.message, true);
      }
    });
    box.querySelector("[data-line-unlink]")?.addEventListener("click", async () => {
      if (!confirm(`Unlink ${person.name}'s LINE? They will stop getting LINE reminders.`)) return;
      try {
        await api(`/api/people/${person.id}/line`, { method: "DELETE" });
        person.line_linked = false;
        renderPersonLineBox(person);
        renderRoster();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
  $("#add-person-btn").addEventListener("click", () => openPersonModal(null));
  $("#person-cancel-btn").addEventListener("click", () => $("#person-modal").classList.add("hidden"));
  $("#person-save-btn").addEventListener("click", async () => {
    const name = $("#person-name").value.trim();
    const payload = {
      name,
      affiliation: $("#person-affiliation").value,
      country: $("#person-country").value.trim(),
      role: $("#person-role").value,
      note: $("#person-note").value.trim(),
    };
    const editingPerson = editingPersonId ? state.people.find((p) => p.id === editingPersonId) : null;
    // Only send contact when we actually have it loaded (see openPersonModal),
    // or when adding a brand-new person, so an unauthorized edit never wipes it.
    if (!editingPerson || "contact" in editingPerson) {
      payload.contact = $("#person-contact").value.trim();
    }
    // Same rule for email and the reminders switch: only when we really hold
    // them, so an edit made without access can't blank them.
    if (!editingPerson || "email" in editingPerson) {
      payload.email = $("#person-email").value.trim();
      payload.whatsapp = $("#person-whatsapp").value.trim();
      payload.reminders = $("#person-reminders").checked;
      payload.is_admin = $("#person-admin").checked;
    }
    if (!name) {
      $("#person-error").textContent = "Name is required";
      $("#person-error").classList.remove("hidden");
      return;
    }
    try {
      if (editingPersonId) {
        const updated = await api(`/api/people/${editingPersonId}`, { method: "PATCH", body: JSON.stringify(payload) });
        Object.assign(editingPerson, updated);
        toast(`${name} updated`);
      } else {
        const person = await api("/api/people", { method: "POST", body: JSON.stringify(payload) });
        state.people.push(person);
        toast(`${name} added to the roster`);
      }
      renderRoster();
      renderWhoami();
      renderCalendar();
      $("#person-modal").classList.add("hidden");
    } catch (e) {
      $("#person-error").textContent = e.message;
      $("#person-error").classList.remove("hidden");
    }
  });

  // ---------- Subscribe to the schedule as a calendar ----------

  // The same feed works in Google Calendar, Apple Calendar and Outlook; only the
  // way of adding it differs. The links are built from this page's own address,
  // so they are right on any domain this site is served from.
  function setupSubscribe() {
    const feed = `${location.origin}/api/calendar/jumat.ics`;
    const webcal = feed.replace(/^https?:/, "webcal:");
    $("#subscribe-google").href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    $("#subscribe-webcal").href = webcal;
    $("#subscribe-copy").addEventListener("click", async () => {
      const ok = await copyText(feed);
      toast(ok ? "Calendar link copied: in Google Calendar choose “Other calendars → From URL” and paste it" : "Could not copy the link", !ok);
    });
  }

  setupSubscribe();
  loadAll().then(openCantMakeItFromUrl).catch((e) => toast(e.message, true));
})();
