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
    joinRequests: [], // admin only: "my name isn't listed" requests waiting to be added
    places: [], // the places the admin manages; the venue dropdown
    ramadan: { settings: { start_date: null, end_date: null, default_start: "19:30", kultum_minutes: 7, event_minutes: 90, reminder_days: [3, 2, 1, 0] }, pattern: [], gatherings: [] },
    openCards: { places: false, ramadan: false }, // planner cards the admin has open (kept across redraws)
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
    if (state.people.length) renderWhoami(); // the admin may switch names, a member may not
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
    for (const field of ["contact", "email", "whatsapp", "calendar-email"]) $(`#person-${field}`).value = "";
  }

  $("#lock-btn").addEventListener("click", async () => {
    localStorage.removeItem(LS_ACCESS);
    state.reminderStatus = null;
    state.alerts = [];
    state.joinRequests = [];
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

  async function fetchJoinRequests() {
    if (!hasAccessCode()) return [];
    try {
      const res = await fetch("/api/join-requests", { headers: { "x-access-code": localStorage.getItem(LS_ACCESS) } });
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }

  async function loadAll() {
    const availUrl = availabilityUrl();
    const [people, fridays, availability, reminderStatus, alerts, joinRequests, places, ramadan] = await Promise.all([
      api("/api/people"),
      api("/api/fridays"),
      availUrl ? api(availUrl) : Promise.resolve([]),
      fetchReminderStatus(),
      fetchAlerts(),
      fetchJoinRequests(),
      api("/api/places").catch(() => []),
      api("/api/ramadan").catch(() => null),
    ]);
    state.people = people;
    state.fridays = fridays;
    state.availability = availability;
    state.reminderStatus = reminderStatus;
    state.alerts = alerts;
    state.joinRequests = joinRequests;
    state.places = places;
    if (ramadan) state.ramadan = ramadan;
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

  // Once someone has chosen their name it is fixed on this device: a member cannot
  // switch to another name (which would let them mark - or look at - somebody else's
  // availability). Whoever holds the access code (the admin) can still change it.
  // This is a guard in the page, not a login: the site has no accounts.
  function nameLocked() {
    if (hasAccessCode()) return false;
    const current = localStorage.getItem(LS_WHOAMI);
    return !!current && state.people.some((p) => p.status === "active" && String(p.id) === current);
  }

  function renderWhoami() {
    const select = $("#whoami-select");
    const current = localStorage.getItem(LS_WHOAMI) || "";
    const active = state.people.filter((p) => p.status === "active");
    select.innerHTML =
      '<option value="">— select your name —</option>' +
      active.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    select.value = current;
    const locked = nameLocked();
    select.disabled = locked;
    $("#join-open-btn").classList.toggle("hidden", locked || hasAccessCode()); // the admin adds people directly
    $("#whoami-note").textContent = locked
      ? "🔒 Your name is set on this device. Wrong name? Ask the admin."
      : hasAccessCode()
      ? "Admin: you can switch names while editing is unlocked."
      : "Pick your name once: it cannot be changed afterwards without the admin.";
  }
  $("#whoami-select").addEventListener("change", async (e) => {
    if (nameLocked()) return renderWhoami(); // a disabled select should not get here; belt and braces
    const select = e.target;
    const value = select.value;
    if (value && !hasAccessCode()) {
      const name = select.options[select.selectedIndex].textContent;
      if (!confirm(`You are "${name}"?\n\nYou cannot change this afterwards on this device; only the admin can.`)) {
        select.value = localStorage.getItem(LS_WHOAMI) || "";
        return;
      }
    }
    localStorage.setItem(LS_WHOAMI, value);
    renderWhoami();
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
  function peopleOptions(selectedId, allowedRoles, guestName = "") {
    const candidates = state.people.filter(
      (p) => p.id === selectedId || (p.status === "active" && (!allowedRoles || allowedRoles.includes(p.role)))
    );
    return (
      '<option value="">— open —</option>' +
      (guestName ? `<option value="__guest" selected>${escapeHtml(`Guest: ${guestName}`)}</option>` : "") +
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

    // Ramadan days (Isha + Tarawih) by date. While the month has any, the weekday columns are equal.
    const gByDate = new Map(state.ramadan.gatherings.map((g) => [g.date, g]));
    const anyGathering = cells.some((c) => gByDate.has(isoDate(c.date)));
    $("#calendar-grid").classList.toggle("has-gatherings", anyGathering);
    document.querySelector(".calendar-weekdays").classList.toggle("has-gatherings", anyGathering);

    $("#calendar-grid").innerHTML = cells
      .map((cell) => {
        const iso = isoDate(cell.date);
        const g = gByDate.get(iso);
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

        const chip = g
          ? `<span class="gathering-chip" data-gathering-id="${g.id}" title="Isha + Tarawih ${escapeHtml(g.start_time)}${g.kultum ? ", with kultum" : ""}">🌙 ${escapeHtml(g.start_time)}${g.kultum ? " 🎤" : ""}</span>`
          : "";
        if (g && !friday) classes.push("clickable", "gathering-day");
        const tag = friday || g ? "button" : "div";
        const dataAttr = friday ? `data-friday-id="${friday.id}"` : g ? `data-gathering-id="${g.id}"` : "";
        const typeAttr = friday || g ? 'type="button"' : "";
        const isNext = friday && friday.date === nextJumat ? ' title="Next Jumat"' : "";
        return `<${tag} class="${classes.join(" ")}" ${dataAttr} ${typeAttr}${isNext}>
          <span class="cal-day-num">${cell.date.getUTCDate()}</span>
          ${summary}
          ${chip}
        </${tag}>`;
      })
      .join("");

    $("#calendar-grid").querySelectorAll("button.cal-day").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.fridayId) openDayModal(Number(btn.dataset.fridayId));
        else if (btn.dataset.gatheringId) openGatheringModal(Number(btn.dataset.gatheringId));
      });
    });
    // The Tarawih chip on a Friday opens the Tarawih day, not the Friday prayer.
    $("#calendar-grid").querySelectorAll("button.cal-day[data-friday-id] [data-gathering-id]").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        openGatheringModal(Number(chip.dataset.gatheringId));
      });
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
          <select id="cant-person" ${nameLocked() ? "disabled" : ""}>
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
          <select data-role="primary_khatib_id">${peopleOptions(friday.primary_khatib_id, ["khatib", "both"], friday.primary_khatib_id == null ? friday.primary_name : "")}</select>
        </div>
        <div class="slot">
          <label>Secondary khatib</label>
          <select data-role="secondary_khatib_id">${peopleOptions(friday.secondary_khatib_id, ["khatib", "both"], friday.secondary_khatib_id == null ? friday.secondary_name : "")}</select>
        </div>
        <div class="slot">
          <label>Imam</label>
          <select data-role="imam_id">${peopleOptions(friday.imam_id, ["imam", "both"], friday.imam_id == null ? friday.imam_name : "")}</select>
        </div>
      </div>
      <div class="meta-row">
        <div class="slot">
          <label>Venue</label>
          ${venueFieldHtml(friday)}
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
      field.addEventListener("change", () => {
        if (field.value === "__guest") return; // that is the guest already saved
        if (field.dataset.role === "venue-select") {
          if (field.value === "__other") {
            const other = body.querySelector('[data-role="venue-other"]');
            other.classList.remove("hidden");
            other.focus();
            return;
          }
          return saveFridayField(friday, "venue", field.value);
        }
        if (field.dataset.role === "venue-other") return saveFridayField(friday, "venue", field.value.trim());
        saveFridayField(friday, field.dataset.role, field.value);
      });
    });
    body.querySelector('[data-role="mark-available"]').addEventListener("click", () => setAvailability(friday.id, "available"));
    body.querySelector('[data-role="mark-unavailable"]').addEventListener("click", () => setAvailability(friday.id, "unavailable"));
    body.querySelector('[data-role="clear-availability"]').addEventListener("click", () => clearAvailability(friday.id));
    body.querySelector('[data-role="generate-announcement"]').addEventListener("click", () => openAnnouncementModal(friday));
  }

  // The venue: pick one of the admin's places (or "Other" to type something one-off).
  function venueFieldHtml(friday) {
    const current = (friday.venue || "").trim();
    const known = state.places.some((p) => p.name.toLowerCase() === current.toLowerCase());
    const options = [
      `<option value="">— to be announced —</option>`,
      ...state.places.map((p) => `<option value="${escapeHtml(p.name)}" ${p.name.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${escapeHtml(p.name)}</option>`),
      current && !known ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (not in the list)</option>` : "",
      `<option value="__other">Other place…</option>`,
    ].join("");
    const place = state.places.find((p) => p.name.toLowerCase() === current.toLowerCase());
    const detail = place && (place.details || place.maps_url)
      ? `<p class="small muted venue-detail">${escapeHtml(place.details || "")}${place.maps_url ? ` <a href="${escapeHtml(place.maps_url)}" target="_blank" rel="noopener noreferrer">map</a>` : ""}</p>`
      : "";
    return `<select data-role="venue-select">${options}</select>
      <input type="text" data-role="venue-other" class="hidden" maxlength="120" placeholder="Type the place" />${detail}`;
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
      // A new place has its own details and map link: redraw the open Friday window.
      if (role === "venue" && state.openFridayId === friday.id) renderDayModalBody(friday);
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
    { field: "primary_khatib_id", label: "Primary khatib", turns: "khatib", roles: ["khatib", "both"], name: "primary_name", guest: "primary_khatib_name" },
    { field: "secondary_khatib_id", label: "Secondary khatib", turns: "khatib", roles: ["khatib", "both"], name: "secondary_name", guest: "secondary_khatib_name", notify: false },
    { field: "imam_id", label: "Imam", turns: "imam", roles: ["imam", "both"], name: "imam_name", guest: "imam_name" },
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

  // Google Calendar: connected or not, and how the last update went.
  function googleStatusHtml() {
    const g = state.reminderStatus && state.reminderStatus.google;
    if (!g) return "";
    if (!g.configured) {
      return '<p class="small muted planner-status">📆 Google Calendar is not connected yet, so events are only in the calendar feed. How to connect it: see “Google Calendar” in the README.</p>';
    }
    const when = g.last_ok_at ? new Date(g.last_ok_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
    const text = g.last_error
      ? `the last update failed: ${escapeHtml(g.last_error)}`
      : when
      ? `last updated ${escapeHtml(when)}; it follows every change made here`
      : "connected, nothing sent yet: press “Sync now” to fill the calendar";
    const status = `<p class="small planner-status ${g.last_error ? "warn" : ""}">📆 Google Calendar: ${text}. <button class="btn btn-sm btn-ghost" data-gcal-sync type="button">Sync now</button></p>`;

    // Test mode: invite only the typed address(es) until it is turned off, so the
    // invitations can be tried on yourself before anyone else receives one.
    const only = g.invite_only || [];
    const saved = new Set(
      state.people
        .filter((p) => p.status === "active" && p.reminders && (p.calendar_email || p.email))
        .map((p) => (p.calendar_email || p.email).trim().toLowerCase())
    );
    const matching = only.filter((a) => saved.has(a)).length;
    const testMode = only.length
      ? `<p class="small planner-status warn">🧪 Invitation test mode is ON: only <strong>${escapeHtml(only.join(", "))}</strong> receives Google invitations, nobody else.
           <button class="btn btn-sm" data-gcal-test-off type="button">Turn off</button></p>
         ${
           matching
             ? ""
             : '<p class="small planner-status warn">⚠ That address is not the Email (or Google Calendar address) saved on anybody in the roster, so <strong>nobody is being invited</strong>. Type the exact address below.</p>'
         }
         <div class="planner-guest planner-test">
           <input type="email" data-gcal-test-input value="${escapeHtml(only.join(", "))}" aria-label="Address to invite in test mode" autocomplete="off" />
           <button class="btn btn-sm" data-gcal-test-on type="button">Change</button>
         </div>`
      : `<details class="small planner-notes planner-test"><summary>Test the Google invitations on yourself first</summary>
           <p class="muted">While test mode is on, only the address you type below is invited. Everyone else is left out until you turn it off.</p>
           <div class="planner-guest">
             <input type="email" data-gcal-test-input placeholder="the address to invite, as saved on your roster entry" autocomplete="off" aria-label="Address to invite in test mode" />
             <button class="btn btn-sm" data-gcal-test-on type="button">Turn on</button>
           </div>
         </details>`;
    return status + testMode;
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

  // The places the admin manages (the venue dropdown). Edit, delete, add.
  function placesHtml() {
    const items = state.places
      .map((p) => {
        const bits = [p.details, p.maps_url && "map link saved", p.kultum_usual && "kultum usual"].filter(Boolean);
        return `<li class="planner-place-item">
          <span><strong>${escapeHtml(p.name)}</strong><span class="muted small">${escapeHtml(bits.join(" · "))}</span></span>
          <span class="planner-alert-actions">
            <button class="btn btn-sm btn-ghost" data-place-edit="${p.id}" type="button">Edit</button>
            <button class="btn btn-sm btn-ghost" data-place-delete="${p.id}" type="button">Delete</button>
          </span>
        </li>`;
      })
      .join("");
    return `<details class="small planner-notes planner-places" data-card="places" ${state.openCards.places ? "open" : ""}><summary>📍 Places (${state.places.length}): the venue dropdown</summary>
      <ul>${items || '<li class="muted">No places yet.</li>'}</ul>
      <button class="btn btn-sm" data-place-add type="button">+ Add place</button>
    </details>`;
  }

  // "My name isn't listed": people who typed their details, waiting for the admin to
  // add them. "Add to roster" opens the usual Add person form, filled in.
  function joinRequestsHtml() {
    if (!state.joinRequests.length) return "";
    const who = { naist_student: "NAIST student", naist_staff: "NAIST staff", dependent: "dependent", outside: "outside NAIST" };
    const roles = { khatib: "khatib", imam: "imam", both: "khatib & imam" };
    const items = state.joinRequests
      .map((r) => {
        const bits = [who[r.affiliation], r.country, r.role && `can serve as ${roles[r.role]}`, r.email, r.whatsapp, r.note].filter(Boolean);
        return `
        <li class="planner-join-item">
          <span><strong>${escapeHtml(r.name)}</strong> asks to be added<span class="muted small">${escapeHtml(bits.join(" · "))}</span></span>
          <span class="planner-alert-actions">
            <button class="btn btn-sm btn-primary" data-join-add="${r.id}" type="button">Add to roster</button>
            <button class="btn btn-sm btn-ghost" data-join-dismiss="${r.id}" type="button">Dismiss</button>
          </span>
        </li>`;
      })
      .join("");
    return `<div class="planner-join">
      <p class="planner-join-title">🙋 ${state.joinRequests.length === 1 ? "1 person" : `${state.joinRequests.length} people`} could not find their name</p>
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

  // A slot can hold a guest typed in by name (e.g. "Prof. Arai") instead of a roster person:
  // then the id is empty and only the free-text name is set.
  const GUEST_VALUE = "__guest"; // same text as in peopleOptions
  const guestNameFor = (friday, slot) => (friday[slot.field] == null && friday[slot.name] ? friday[slot.name] : "");

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
    const guest = guestNameFor(friday, slot);
    return (
      '<option value="">— open —</option>' +
      (guest ? `<option value="${GUEST_VALUE}" selected>${escapeHtml(`Guest: ${guest}`)}</option>` : "") +
      options.join("")
    );
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

    // A redraw (after any save) must not wipe a guest name that is half typed.
    const typedGuests = new Map(
      [...list.querySelectorAll("input[data-guest]")]
        .filter((i) => i.value !== i.defaultValue)
        .map((i) => [`${i.closest(".planner-row").dataset.id}:${i.dataset.guest}`, i.value])
    );

    const today = todayISO();
    const upcoming = state.fridays.filter((f) => !f.is_history && f.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const turnsByKind = { khatib: buildTurns("khatib"), imam: buildTurns("imam") };

    const legend = `
      ${joinRequestsHtml()}
      ${alertsHtml()}
      ${placesHtml()}
      ${ramadanHtml()}
      ${reminderStatusHtml()}
      ${googleStatusHtml()}
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
        // The secondary khatib gets no automatic reminder (usually next week's khatib), so no "reached by" line.
        const reach = slot.notify === false ? null : reminderReach(person);
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
            <div class="planner-guest">
              <input type="text" maxlength="80" data-guest="${slot.guest}" value="${escapeHtml(guestNameFor(f, slot))}" placeholder="or a guest, e.g. Prof. Arai" aria-label="Guest name for ${escapeHtml(slot.label)}" autocomplete="off" />
              <button class="btn btn-sm btn-ghost" data-guest-set="${slot.guest}" type="button">Set</button>
            </div>
            ${guestNameFor(f, slot) && slot.notify !== false ? '<small class="planner-reach">Guest: no reminders can be sent, message them yourself.</small>' : ""}
            ${slot.notify === false ? '<small class="planner-reach">Standby: no automatic reminder or invitation.</small>' : ""}
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
    for (const [key, value] of typedGuests) {
      const [id, field] = key.split(":");
      const input = list.querySelector(`.planner-row[data-id="${id}"] input[data-guest="${field}"]`);
      if (input) input.value = value;
    }

    list.querySelector(".planner-more")?.addEventListener("click", () => {
      state.plannerShowAll = !state.plannerShowAll;
      renderPlanner();
    });

    list.querySelector("[data-gcal-sync]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const r = await api("/api/calendar/sync", { method: "POST", body: "{}" });
        if (!r.configured) toast("Google Calendar is not connected", true);
        else if (r.failed) toast(`Google Calendar: ${r.synced} updated, ${r.failed} failed (${r.errors[0]?.message || "see the planner"})`, true);
        else toast(r.synced ? `Google Calendar: ${r.synced} Friday(s) updated` : "Google Calendar was already up to date");
      } catch (err) {
        toast(err.message, true);
      }
      state.reminderStatus = await fetchReminderStatus();
      renderPlanner();
    });

    const setTestMode = async (inviteOnly) => {
      try {
        const r = await api("/api/calendar/test-mode", { method: "POST", body: JSON.stringify({ invite_only: inviteOnly }) });
        toast(r.invite_only.length ? `Test mode on: only ${r.invite_only.join(", ")} will be invited` : "Test mode off: everyone scheduled who has an email is invited");
      } catch (err) {
        toast(err.message, true);
      }
      state.reminderStatus = await fetchReminderStatus();
      renderPlanner();
    };
    list.querySelector("[data-gcal-test-on]")?.addEventListener("click", () => {
      const address = list.querySelector("[data-gcal-test-input]").value.trim();
      if (!address) return toast("Type your own address first", true);
      setTestMode(address);
    });
    list.querySelector("[data-gcal-test-off]")?.addEventListener("click", () => {
      if (confirm("Turn test mode off? Everyone scheduled who has an email saved (and reminders on) will then be invited to their Friday.")) setTestMode("");
    });

    list.querySelectorAll("details[data-card]").forEach((d) => d.addEventListener("toggle", () => (state.openCards[d.dataset.card] = d.open)));
    wireRamadanCard(list);
    list.querySelector("[data-place-add]")?.addEventListener("click", () => openPlaceModal(null));
    list.querySelectorAll("[data-place-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openPlaceModal(state.places.find((p) => p.id === Number(btn.dataset.placeEdit))));
    });
    list.querySelectorAll("[data-place-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const place = state.places.find((p) => p.id === Number(btn.dataset.placeDelete));
        if (!place) return;
        const used = state.fridays.filter((f) => !f.is_history && (f.venue || "").toLowerCase() === place.name.toLowerCase()).length;
        const warning = used ? `\n\n${used} coming Friday(s) use it; they keep the name as text.` : "";
        if (!confirm(`Delete the place "${place.name}"?${warning}`)) return;
        try {
          await api(`/api/places/${place.id}`, { method: "DELETE" });
          state.places = state.places.filter((p) => p.id !== place.id);
          renderPlanner();
          toast(`${place.name} deleted`);
        } catch (e) {
          toast(e.message, true);
        }
      });
    });

    list.querySelectorAll("[data-join-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const request = state.joinRequests.find((r) => r.id === Number(btn.dataset.joinAdd));
        if (request) openPersonModalFromRequest(request);
      });
    });
    list.querySelectorAll("[data-join-dismiss]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.joinDismiss);
        const request = state.joinRequests.find((r) => r.id === id);
        if (!request || !confirm(`Dismiss the request from ${request.name}? They are not added to the roster.`)) return;
        try {
          await api(`/api/join-requests/${id}`, { method: "PATCH", body: JSON.stringify({ resolution: "dismissed" }) });
          state.joinRequests = state.joinRequests.filter((r) => r.id !== id);
          renderPlanner();
        } catch (e) {
          toast(e.message, true);
        }
      });
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
        select.addEventListener("change", () => {
          if (select.value === GUEST_VALUE) return; // that is the guest already saved
          saveFridayField(friday, select.dataset.slot, select.value);
        });
      });
      row.querySelectorAll("input[data-guest]").forEach((input) => {
        const slot = PLANNER_SLOTS.find((x) => x.guest === input.dataset.guest);
        const save = () => {
          const name = input.value.trim().replace(/\s+/g, " ");
          if (!name && !guestNameFor(friday, slot)) return toast("Type the guest's name first", true);
          input.value = input.defaultValue = name; // saved text is no longer "half typed"
          saveFridayField(friday, input.dataset.guest, name);
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        });
        input.closest(".planner-guest").querySelector("[data-guest-set]").addEventListener("click", save);
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
    $("#announcement-text").value = announcement.buildAnnouncementText(announcementFriday, announcementHadith, state.places);
  }

  function openAnnouncementModal(friday) {
    $("#announcement-reroll-btn").classList.remove("hidden");
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
          ${p.reminders && (p.calendar_email || p.email) ? `<div class="roster-meta">📆 calendar invites to ${escapeHtml(p.calendar_email || p.email)}</div>` : ""}
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
  let pendingJoinId = null; // set while the Add person form was opened from a "my name isn't listed" request

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
    $("#person-calendar-email").value = person && "calendar_email" in person ? person.calendar_email || "" : "";
    $("#person-reminders").checked = person && "reminders" in person ? !!person.reminders : true;
    $("#person-admin").checked = person && "is_admin" in person ? !!person.is_admin : false;
    renderPersonLineBox(person);
    $("#person-error").classList.add("hidden");
    $("#person-modal").classList.remove("hidden");
    $("#person-name").focus();
  }

  // The Add person form, filled in from what the person typed. Saving it adds them
  // and closes the request; cancelling leaves the request waiting.
  function openPersonModalFromRequest(r) {
    openPersonModal(null);
    pendingJoinId = r.id;
    $("#person-name").value = r.name;
    $("#person-affiliation").value = r.affiliation || "naist_student";
    $("#person-country").value = r.country || "";
    $("#person-role").value = r.role || "khatib";
    $("#person-email").value = r.email || "";
    $("#person-whatsapp").value = r.whatsapp || "";
    $("#person-note").value = r.note || "";
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
  $("#add-person-btn").addEventListener("click", () => {
    openPersonModal(null);
    pendingJoinId = null;
  });
  $("#person-cancel-btn").addEventListener("click", () => {
    pendingJoinId = null;
    $("#person-modal").classList.add("hidden");
  });
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
      payload.calendar_email = $("#person-calendar-email").value.trim();
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
        if (pendingJoinId) {
          const id = pendingJoinId;
          pendingJoinId = null;
          try {
            await api(`/api/join-requests/${id}`, { method: "PATCH", body: JSON.stringify({ resolution: "added" }) });
          } catch {
            // The person is added either way; the request would just stay listed until dismissed.
          }
          state.joinRequests = state.joinRequests.filter((r) => r.id !== id);
          renderPlanner();
        }
        toast(`${name} added to the roster. Tell them to pick their name under “You are”.`);
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

  // ---------- Ramadan: Isha + Tarawih days ----------

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

  function gatheringPlaceSelectHtml(current, role) {
    const known = state.places.some((p) => p.name.toLowerCase() === (current || "").toLowerCase());
    return `<select data-g="${role}">
      <option value="">— to be announced —</option>
      ${state.places.map((p) => `<option value="${escapeHtml(p.name)}" ${p.name.toLowerCase() === (current || "").toLowerCase() ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      ${current && !known ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (not in the list)</option>` : ""}
    </select>`;
  }

  function gatheringSummaryLines(g) {
    const place = state.places.find((p) => p.name.toLowerCase() === (g.place || "").toLowerCase());
    const lines = [
      `<p class="small"><strong>Time:</strong> ${escapeHtml(g.start_time)} (Isha, then Tarawih)</p>`,
      `<p class="small"><strong>Place:</strong> ${g.place ? escapeHtml(g.place) : "to be announced"}${place && place.maps_url ? ` · <a href="${escapeHtml(place.maps_url)}" target="_blank" rel="noopener noreferrer">map</a>` : ""}</p>`,
    ];
    if (place && place.details) lines.push(`<p class="small muted">${escapeHtml(place.details)}</p>`);
    lines.push(
      g.kultum
        ? `<p class="small"><strong>Kultum (${g.kultum_minutes} minutes):</strong> ${g.speaker ? escapeHtml(g.speaker) : "speaker to be announced"}</p>`
        : '<p class="small"><strong>Kultum:</strong> none that day</p>'
    );
    if (g.info) lines.push(`<p class="small muted">${escapeHtml(g.info)}</p>`);
    return lines.join("");
  }

  function openGatheringModal(id) {
    const g = state.ramadan.gatherings.find((x) => x.id === id);
    if (!g) return;
    $("#gathering-title").textContent = `Isha + Tarawih · ${formatDateLong(g.date)}`;
    renderGatheringBody(g);
    $("#gathering-modal").classList.remove("hidden");
  }

  function renderGatheringBody(g) {
    const body = $("#gathering-body");
    const admin = hasAccessCode();
    const announce = '<button class="btn btn-sm" data-g-announce type="button">📢 Generate announcement</button>';
    if (!admin) {
      body.innerHTML = `${gatheringSummaryLines(g)}<div class="announce-row">${announce}</div>`;
    } else {
      const people = state.people.filter((p) => p.status === "active");
      const speakerOptions =
        '<option value="">— none —</option>' +
        (g.speaker_id == null && g.speaker ? `<option value="__guest" selected>Guest: ${escapeHtml(g.speaker)}</option>` : "") +
        people.map((p) => `<option value="${p.id}" ${p.id === g.speaker_id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
      body.innerHTML = `<div class="gathering-form">
        <label>Place ${gatheringPlaceSelectHtml(g.place, "place")}</label>
        <label>Start time (Isha / Tarawih) <input type="time" data-g="start_time" value="${escapeHtml(g.start_time)}" /></label>
        <label class="check-row"><input type="checkbox" data-g="kultum" ${g.kultum ? "checked" : ""} /><span>There is a kultum (7-minute talk) this day</span></label>
        <div data-g-kultum-box class="${g.kultum ? "" : "hidden"}">
          <label>Kultum speaker <select data-g="speaker_id">${speakerOptions}</select></label>
          <label>or a guest, e.g. Prof. Arai <input type="text" maxlength="80" data-g="speaker_name" value="${g.speaker_id == null && g.speaker ? escapeHtml(g.speaker) : ""}" placeholder="type a name" /></label>
          <label>Kultum minutes <input type="number" min="1" max="60" data-g="kultum_minutes" value="${g.kultum_minutes}" /></label>
        </div>
        <label class="check-row"><input type="checkbox" data-g="reminders" ${g.reminders ? "checked" : ""} /><span>Send the speaker reminders for this day</span></label>
        <label>Note <input type="text" maxlength="300" data-g="info" value="${escapeHtml(g.info)}" placeholder="optional" /></label>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-g-delete type="button">Delete this day</button>
          ${announce}
          <button class="btn btn-primary" data-g-save type="button">Save</button>
        </div>
        <p class="error small hidden" data-g-error></p>
      </div>`;
      body.querySelector('[data-g="kultum"]').addEventListener("change", (e) => body.querySelector("[data-g-kultum-box]").classList.toggle("hidden", !e.target.checked));
      // A speaker is a roster person or a typed guest, never both: choosing one clears the other.
      const speakerSelect = body.querySelector('[data-g="speaker_id"]');
      const guestInput = body.querySelector('[data-g="speaker_name"]');
      guestInput.addEventListener("input", () => {
        if (guestInput.value.trim()) speakerSelect.value = speakerSelect.querySelector('option[value="__guest"]') ? "__guest" : "";
      });
      speakerSelect.addEventListener("change", () => {
        if (speakerSelect.value && speakerSelect.value !== "__guest") guestInput.value = "";
      });
      body.querySelector("[data-g-save]").addEventListener("click", () => saveGathering(g, body));
      body.querySelector("[data-g-delete]").addEventListener("click", async () => {
        if (!confirm(`Delete ${formatDateLong(g.date)} from Ramadan?`)) return;
        try {
          await api(`/api/gatherings/${g.id}`, { method: "DELETE" });
          state.ramadan.gatherings = state.ramadan.gatherings.filter((x) => x.id !== g.id);
          $("#gathering-modal").classList.add("hidden");
          renderCalendar();
          renderPlanner();
        } catch (e) {
          toast(e.message, true);
        }
      });
    }
    body.querySelector("[data-g-announce]").addEventListener("click", () => openGatheringAnnouncement(g));
  }

  async function saveGathering(g, body) {
    const val = (name) => body.querySelector(`[data-g="${name}"]`);
    const payload = {
      place: val("place").value,
      start_time: val("start_time").value,
      kultum: val("kultum").checked,
      reminders: val("reminders").checked,
      info: val("info").value,
    };
    if (payload.kultum) {
      const minutes = val("kultum_minutes").value;
      payload.kultum_minutes = minutes === "" ? null : Number(minutes);
      const guest = val("speaker_name").value.trim();
      const chosen = val("speaker_id").value;
      if (guest && (!chosen || chosen === "__guest")) {
        payload.speaker_id = null;
        payload.speaker_name = guest;
      } else if (chosen && chosen !== "__guest") {
        payload.speaker_id = Number(chosen);
      } else if (!chosen) {
        payload.speaker_id = null;
        payload.speaker_name = "";
      }
    }
    try {
      const updated = await api(`/api/gatherings/${g.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      Object.assign(g, updated);
      renderCalendar();
      renderPlanner();
      renderGatheringBody(g);
      toast("Saved");
    } catch (e) {
      const box = body.querySelector("[data-g-error]");
      box.textContent = e.message;
      box.classList.remove("hidden");
    }
  }
  $("#gathering-close-btn").addEventListener("click", () => $("#gathering-modal").classList.add("hidden"));

  // The Tarawih text has no hadith, so the "new hadith" button hides until a Friday is opened again.
  function openGatheringAnnouncement(g) {
    $("#announcement-text").value = announcement.buildGatheringText(g, { places: state.places, settings: state.ramadan.settings });
    $("#announcement-reroll-btn").classList.add("hidden");
    $("#announcement-modal").classList.remove("hidden");
  }

  // The planner's Ramadan card: the dates, the weekly pattern, and the days.
  function ramadanHtml() {
    const r = state.ramadan;
    const s = r.settings;
    const placeOptions = (current) =>
      `<option value="">— place —</option>${state.places
        .map((p) => `<option value="${escapeHtml(p.name)}" ${p.name === current ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("")}${current && !state.places.some((p) => p.name === current) ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>` : ""}`;
    const rowFor = (wd) => {
      const p = r.pattern.find((x) => x.weekday === wd) || { active: false, place: "", start_time: "", kultum: false, reminders: true };
      return `<tr data-weekday="${wd}">
        <td><label><input type="checkbox" class="rm-active" ${p.active ? "checked" : ""} /> ${WEEKDAY_NAMES[wd]}</label></td>
        <td><select class="rm-place">${placeOptions(p.place || "")}</select></td>
        <td><input type="time" class="rm-time" value="${escapeHtml(p.start_time || "")}" /></td>
        <td><label><input type="checkbox" class="rm-kultum" ${p.kultum ? "checked" : ""} /> kultum</label></td>
        <td><label><input type="checkbox" class="rm-reminders" ${p.reminders ? "checked" : ""} /> remind</label></td>
      </tr>`;
    };
    const remindBoxes = [4, 3, 2, 1, 0]
      .map((d) => `<label><input type="checkbox" class="rm-remind" value="${d}" ${s.reminder_days.includes(d) ? "checked" : ""} /> ${d === 0 ? "the day itself" : `${d} day${d > 1 ? "s" : ""} before`}</label>`)
      .join(" ");
    const today = todayISO();
    const upcoming = r.gatherings.filter((g) => g.date >= today);
    const days = upcoming
      .map(
        (g) => `<li class="ramadan-day">
          <span><strong>${escapeHtml(formatDateLong(g.date))}</strong> · ${escapeHtml(g.start_time)} · ${g.place ? escapeHtml(g.place) : "<em>no place</em>"}
            <span class="muted small">${g.kultum ? `· kultum: ${g.speaker ? escapeHtml(g.speaker) : "⚠ no speaker yet"}` : "· no kultum"}</span></span>
          <button class="btn btn-sm btn-ghost" data-rm-edit="${g.id}" type="button">Edit</button>
        </li>`
      )
      .join("");
    const range = s.start_date && s.end_date ? `${formatDateLong(s.start_date)} to ${formatDateLong(s.end_date)}` : "not set";
    return `<details class="small planner-notes planner-ramadan" data-card="ramadan" ${state.openCards.ramadan ? "open" : ""}><summary>🌙 Ramadan (${escapeHtml(range)})</summary>
      <div class="ramadan-fields">
        <label>First day <input type="date" id="rm-start" value="${escapeHtml(s.start_date || "")}" /></label>
        <label>Last day <input type="date" id="rm-end" value="${escapeHtml(s.end_date || "")}" /></label>
        <label>Usual Isha / Tarawih start <input type="time" id="rm-default" value="${escapeHtml(s.default_start)}" /></label>
        <label>Kultum minutes <input type="number" id="rm-kultum-min" min="1" max="60" value="${s.kultum_minutes}" /></label>
        <label>Calendar event length (minutes) <input type="number" id="rm-event-min" min="15" max="360" value="${s.event_minutes}" /></label>
      </div>
      <p class="muted">Which weekdays have a gathering, where, and when (leave the time empty for the usual start):</p>
      <table class="ramadan-grid"><thead><tr><th>Weekday</th><th>Place</th><th>Start</th><th></th><th></th></tr></thead><tbody>${MONDAY_FIRST.map(rowFor).join("")}</tbody></table>
      <p class="muted">Remind the kultum speaker: ${remindBoxes}</p>
      <div class="ramadan-actions">
        <button class="btn btn-sm" data-rm-save type="button">Save settings</button>
        <button class="btn btn-sm btn-primary" data-rm-generate type="button">Save and create the days</button>
        <button class="btn btn-sm btn-ghost" data-rm-prune type="button">Remove days outside the dates</button>
      </div>
      <p class="muted">Creating the days never changes a day that already exists. Add a single extra day:
        <input type="date" id="rm-add-date" /> <button class="btn btn-sm btn-ghost" data-rm-add type="button">Add this day</button></p>
      <ul class="ramadan-days">${days || '<li class="muted">No Ramadan days yet.</li>'}</ul>
    </details>`;
  }

  function readRamadanForm(root) {
    return {
      start_date: root.querySelector("#rm-start").value || null,
      end_date: root.querySelector("#rm-end").value || null,
      default_start: root.querySelector("#rm-default").value,
      kultum_minutes: Number(root.querySelector("#rm-kultum-min").value),
      event_minutes: Number(root.querySelector("#rm-event-min").value),
      reminder_days: [...root.querySelectorAll(".rm-remind:checked")].map((b) => Number(b.value)),
      pattern: [...root.querySelectorAll("tr[data-weekday]")].map((tr) => ({
        weekday: Number(tr.dataset.weekday),
        active: tr.querySelector(".rm-active").checked,
        place: tr.querySelector(".rm-place").value,
        start_time: tr.querySelector(".rm-time").value || null,
        kultum: tr.querySelector(".rm-kultum").checked,
        reminders: tr.querySelector(".rm-reminders").checked,
      })),
    };
  }

  async function reloadRamadan() {
    state.ramadan = await api("/api/ramadan");
    renderCalendar();
    renderPlanner();
  }

  function wireRamadanCard(root) {
    const card = root.querySelector(".planner-ramadan");
    if (!card) return;
    const save = async () => {
      const saved = await api("/api/ramadan", { method: "PUT", body: JSON.stringify(readRamadanForm(card)) });
      state.ramadan.settings = saved.settings;
      state.ramadan.pattern = saved.pattern;
    };
    card.querySelector("[data-rm-save]").addEventListener("click", async () => {
      try {
        await save();
        await reloadRamadan();
        toast("Ramadan settings saved");
      } catch (e) {
        toast(e.message, true);
      }
    });
    card.querySelector("[data-rm-generate]").addEventListener("click", async () => {
      try {
        await save();
        const r = await api("/api/ramadan/generate", { method: "POST", body: "{}" });
        await reloadRamadan();
        toast(r.created ? `${r.created} day(s) created` : "No new days: they already exist");
        if (r.outside) toast(`${r.outside} existing day(s) are outside the dates: use “Remove days outside the dates”`);
      } catch (e) {
        toast(e.message, true);
      }
    });
    card.querySelector("[data-rm-prune]").addEventListener("click", async () => {
      if (!confirm("Remove every Ramadan day that is outside the first and last day above?")) return;
      try {
        await save();
        const r = await api("/api/ramadan/generate", { method: "POST", body: JSON.stringify({ prune: true }) });
        await reloadRamadan();
        toast(`${r.removed} day(s) removed`);
      } catch (e) {
        toast(e.message, true);
      }
    });
    card.querySelector("[data-rm-add]").addEventListener("click", async () => {
      const date = card.querySelector("#rm-add-date").value;
      if (!date) return toast("Pick the date to add", true);
      try {
        await api("/api/gatherings", { method: "POST", body: JSON.stringify({ date }) });
        await reloadRamadan();
        toast("Day added");
      } catch (e) {
        toast(e.message, true);
      }
    });
    card.querySelectorAll("[data-rm-edit]").forEach((btn) => btn.addEventListener("click", () => openGatheringModal(Number(btn.dataset.rmEdit))));
    // Choosing a place that usually has a kultum ticks the kultum box, as a convenience.
    card.querySelectorAll("tr[data-weekday] .rm-place").forEach((select) =>
      select.addEventListener("change", () => {
        const place = state.places.find((p) => p.name === select.value);
        if (place && place.kultum_usual) select.closest("tr").querySelector(".rm-kultum").checked = true;
      })
    );
  }

  // ---------- Places (admin) ----------

  let editingPlaceId = null;
  function openPlaceModal(place) {
    editingPlaceId = place ? place.id : null;
    $("#place-modal-title").textContent = place ? "Edit place" : "Add a place";
    $("#place-save-btn").textContent = place ? "Save" : "Add";
    $("#place-name").value = place ? place.name : "";
    $("#place-details").value = place ? place.details : "";
    $("#place-maps").value = place ? place.maps_url : "";
    $("#place-kultum").checked = place ? place.kultum_usual : false;
    $("#place-error").classList.add("hidden");
    $("#place-modal").classList.remove("hidden");
    $("#place-name").focus();
  }
  $("#place-cancel-btn").addEventListener("click", () => $("#place-modal").classList.add("hidden"));
  $("#place-save-btn").addEventListener("click", async () => {
    const payload = {
      name: $("#place-name").value,
      details: $("#place-details").value,
      maps_url: $("#place-maps").value,
      kultum_usual: $("#place-kultum").checked,
    };
    try {
      if (editingPlaceId) {
        const updated = await api(`/api/places/${editingPlaceId}`, { method: "PATCH", body: JSON.stringify(payload) });
        const old = state.places.find((p) => p.id === editingPlaceId);
        // A rename follows onto the coming Fridays: reload them so the dropdowns match.
        const renamed = old && old.name !== updated.name;
        Object.assign(old, updated);
        if (renamed) state.fridays = await api("/api/fridays");
      } else {
        state.places.push(await api("/api/places", { method: "POST", body: JSON.stringify(payload) }));
      }
      state.places.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      $("#place-modal").classList.add("hidden");
      renderPlanner();
      renderCalendar();
      toast("Place saved");
    } catch (e) {
      $("#place-error").textContent = e.message;
      $("#place-error").classList.remove("hidden");
    }
  });

  // ---------- "My name isn't listed" (public form) ----------

  function openJoinModal() {
    for (const id of ["name", "country", "email", "whatsapp", "note", "website"]) $(`#join-${id}`).value = "";
    $("#join-affiliation").value = "naist_student";
    $("#join-role").value = "khatib";
    $("#join-error").classList.add("hidden");
    $("#join-form").classList.remove("hidden");
    $("#join-done").classList.add("hidden");
    $("#join-modal").classList.remove("hidden");
    $("#join-name").focus();
  }
  const closeJoinModal = () => $("#join-modal").classList.add("hidden");
  $("#join-open-btn").addEventListener("click", openJoinModal);
  $("#join-cancel-btn").addEventListener("click", closeJoinModal);
  $("#join-close-btn").addEventListener("click", closeJoinModal);
  $("#join-send-btn").addEventListener("click", async () => {
    const error = (message) => {
      $("#join-error").textContent = message;
      $("#join-error").classList.remove("hidden");
    };
    const name = $("#join-name").value.trim();
    if (name.length < 2) return error("Please type your name.");
    const button = $("#join-send-btn");
    button.disabled = true;
    try {
      // A plain fetch: this is open to everyone, no access code involved.
      const res = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          affiliation: $("#join-affiliation").value,
          country: $("#join-country").value.trim(),
          role: $("#join-role").value,
          email: $("#join-email").value.trim(),
          whatsapp: $("#join-whatsapp").value.trim(),
          note: $("#join-note").value.trim(),
          website: $("#join-website").value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return error(data.error || "Could not send. Please try again, or ask the admin.");
      $("#join-form").classList.add("hidden");
      $("#join-done").classList.remove("hidden");
    } catch {
      error("Could not send. Check your connection and try again.");
    } finally {
      button.disabled = false;
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

  // When the shared Google calendar is connected, offer it first: unlike the
  // feed above it is updated by the website at once, and carries the invitations.
  async function showGoogleCalendar() {
    try {
      const res = await fetch("/api/calendar/info");
      const { google } = res.ok ? await res.json() : {};
      if (!google || !google.calendar_id) return;
      const id = encodeURIComponent(google.calendar_id);
      $("#subscribe-gcal-add").href = `https://calendar.google.com/calendar/r?cid=${id}`;
      $("#subscribe-gcal-view").href = `https://calendar.google.com/calendar/embed?src=${id}&ctz=Asia%2FTokyo`;
      $("#subscribe-google-calendar-actions").classList.remove("hidden");
      $("#subscribe-google").classList.add("hidden"); // the live calendar replaces the slower feed button
      $("#subscribe-intro").textContent =
        "The khatib and imam of every Friday are on the shared Jumat calendar, each event with the weekly announcement. Add it to Google Calendar once and it follows the schedule.";
      $("#subscribe-note").textContent =
        "Changes made on this website reach that calendar within a minute or so. If you are scheduled and your email is on the roster, you also get an invitation. Apple / Outlook: use the buttons above. No Google account? Use this page, or the announcement posted in the WhatsApp / Facebook groups.";
    } catch {
      // Not connected, or offline: the feed buttons stay.
    }
  }

  setupSubscribe();
  showGoogleCalendar();
  loadAll().then(openCantMakeItFromUrl).catch((e) => toast(e.message, true));
})();
