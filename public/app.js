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
  $("#lock-btn").addEventListener("click", () => {
    localStorage.removeItem(LS_ACCESS);
    updateUnlockUI();
    renderRoster();
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

  async function loadAll() {
    const availUrl = availabilityUrl();
    const [people, fridays, availability] = await Promise.all([
      api("/api/people"),
      api("/api/fridays"),
      availUrl ? api(availUrl) : Promise.resolve([]),
    ]);
    state.people = people;
    state.fridays = fridays;
    state.availability = availability;
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
        </div>
      </div>
    `;

    body.querySelectorAll("select[data-role], input[data-role]").forEach((field) => {
      field.addEventListener("change", () => saveFridayField(friday, field.dataset.role, field.value));
    });
    body.querySelector('[data-role="mark-available"]').addEventListener("click", () => setAvailability(friday.id, "available"));
    body.querySelector('[data-role="mark-unavailable"]').addEventListener("click", () => setAvailability(friday.id, "unavailable"));
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
      toast("Saved");
    } catch (e) {
      toast(e.message, true);
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

    const unlocked = hasAccessCode();
    const row = (p) => `
      <div class="roster-row ${p.status !== "active" ? "inactive" : ""}" data-id="${p.id}">
        <div>
          <div class="roster-name">${escapeHtml(p.name)}</div>
          <div class="roster-meta">${[affiliationLabel(p.affiliation), p.country, p.role !== "khatib" ? p.role : null, p.note].filter(Boolean).map(escapeHtml).join(" · ")}</div>
          ${"contact" in p ? `<div class="roster-meta">${p.contact ? "📞 " + escapeHtml(p.contact) : '<span class="muted">no contact on file</span>'}</div>` : ""}
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
    $("#person-error").classList.add("hidden");
    $("#person-modal").classList.remove("hidden");
    $("#person-name").focus();
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

  loadAll().catch((e) => toast(e.message, true));
})();
