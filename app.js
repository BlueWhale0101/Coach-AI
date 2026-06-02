const EVENT_TYPES = [
  "meal",
  "workout",
  "weigh_in",
  "recovery",
  "sleep",
  "note",
  "social_event",
  "alcohol",
  "symptom",
];

const $ = (id) => document.getElementById(id);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function setStatus(id, message, kind = "") {
  const el = $(id);
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

function getSettings() {
  return {
    baseUrl: $("baseUrl").value.trim().replace(/\/+$/, ""),
    actionSecret: $("actionSecret").value,
  };
}

function requireSettings() {
  const { baseUrl, actionSecret } = getSettings();
  if (!baseUrl || !actionSecret) {
    throw new Error("Enter Function Base URL and X-Action-Secret first.");
  }
  return { baseUrl, actionSecret };
}

async function callFunction(name, payload) {
  const { baseUrl, actionSecret } = requireSettings();
  const res = await fetch(`${baseUrl}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Action-Secret": actionSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return json;
}

function saveSettings() {
  const { baseUrl, actionSecret } = getSettings();
  localStorage.setItem("coach_ai_base_url", baseUrl);
  localStorage.setItem("coach_ai_action_secret", actionSecret);
  setStatus("settingsStatus", "Saved locally.", "ok");
}

function loadSettings() {
  const defaultBase = "https://zjgklcigytxvjexiizdn.supabase.co/functions/v1";
  $("baseUrl").value = localStorage.getItem("coach_ai_base_url") || defaultBase;
  $("actionSecret").value = localStorage.getItem("coach_ai_action_secret") || "";
}

function clearSettings() {
  localStorage.removeItem("coach_ai_base_url");
  localStorage.removeItem("coach_ai_action_secret");
  $("actionSecret").value = "";
  setStatus("settingsStatus", "Cleared.", "warn");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
    });
  });
}

function setupEventTypeSelects() {
  ["logsEventType", "searchEventType"].forEach((id) => {
    const select = $(id);
    EVENT_TYPES.forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      select.appendChild(opt);
    });
  });
}

function metaItem(dl, label, value) {
  if (value === undefined || value === null || value === "") return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = typeof value === "object" ? JSON.stringify(value) : String(value);
  dl.append(dt, dd);
}

function renderEvent(event) {
  const tpl = $("eventTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);
  const type = event.event_type || "unknown";

  const pill = node.querySelector(".event-type");
  pill.textContent = type;
  pill.classList.add(type);
  if (event.needs_review) pill.classList.add("review");

  node.querySelector(".event-title").textContent = event.title || event.description || "(untitled)";
  node.querySelector(".event-description").textContent = event.description || "";

  const dl = node.querySelector(".meta-list");
  metaItem(dl, "event_id", event.event_id || event.id);
  metaItem(dl, "date", event.occurred_date);
  metaItem(dl, "time", event.occurred_time);
  metaItem(dl, "source span", event.source_text_span);
  metaItem(dl, "review", event.needs_review);
  metaItem(dl, "facts", event.facts);
  metaItem(dl, "estimates", event.estimates);

  node.querySelector(".json-block").textContent = prettyJson(event);
  node.querySelector(".copy-event").addEventListener("click", async () => {
    await navigator.clipboard.writeText(prettyJson(event));
  });

  const id = event.event_id || event.id;
  if (id) {
    node.addEventListener("dblclick", () => {
      $("editEventId").value = id;
      document.querySelector('[data-tab="edit"]').click();
    });
  }

  return node;
}

function renderLogs(logs) {
  const container = $("logsResults");
  container.innerHTML = "";

  if (!logs.length) {
    container.innerHTML = `<div class="panel">No logs found.</div>`;
    return;
  }

  for (const log of logs) {
    const card = document.createElement("article");
    card.className = "log-card";

    const header = document.createElement("div");
    header.className = "log-header";
    header.innerHTML = `
      <div>
        <h3>${log.occurred_date}${log.occurred_time ? " " + log.occurred_time : ""}</h3>
        <p class="hint">${log.source || ""} · ${log.extraction_status || ""} · review: ${log.needs_review}</p>
      </div>
      <button class="secondary small">Copy log JSON</button>
    `;
    header.querySelector("button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(prettyJson(log));
    });
    card.appendChild(header);

    if (log.raw_text) {
      const raw = document.createElement("div");
      raw.className = "raw-text";
      raw.textContent = log.raw_text;
      card.appendChild(raw);
    }

    const list = document.createElement("div");
    list.className = "event-list";
    (log.events || []).forEach((event) => list.appendChild(renderEvent(event)));
    card.appendChild(list);
    container.appendChild(card);
  }
}

function renderSearchResults(results) {
  const container = $("searchResults");
  container.innerHTML = "";

  if (!results.length) {
    container.innerHTML = `<div class="panel">No events found.</div>`;
    return;
  }

  results.forEach((event) => container.appendChild(renderEvent(event)));
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value ?? "—"}</div></div>`;
}

function renderSummary(summary, meta = {}) {
  const container = $("summaryResults");
  container.innerHTML = "";

  if (!summary) {
    container.innerHTML = `<div class="panel">No summary found.</div>`;
    return;
  }

  const card = document.createElement("article");
  card.className = "summary-card";

  const bodyweight = summary.bodyweight_value
    ? `${summary.bodyweight_value} ${summary.bodyweight_unit || ""}`.trim()
    : "—";

  const calories = summary.calories_low !== null && summary.calories_low !== undefined
    ? `${summary.calories_low}–${summary.calories_high}`
    : "—";

  const protein = summary.protein_g_low !== null && summary.protein_g_low !== undefined
    ? `${summary.protein_g_low}–${summary.protein_g_high}g`
    : "—";

  card.innerHTML = `
    <div class="log-header">
      <div>
        <h3>${summary.summary_date}</h3>
        <p class="hint">generated: ${meta.generated ?? "?"} · stored: ${meta.stored ?? "?"} · events: ${meta.event_count ?? "?"}</p>
      </div>
      <button class="secondary small">Copy summary JSON</button>
    </div>

    <div class="summary-grid">
      ${metric("Bodyweight", bodyweight)}
      ${metric("Calories", calories)}
      ${metric("Protein", protein)}
      ${metric("Workouts", summary.workout_count)}
      ${metric("Training Load", summary.training_load)}
      ${metric("Needs Review", summary.needs_review)}
      ${metric("Flags", (summary.flags || []).join(", ") || "—")}
      ${metric("Generated By", summary.generated_by)}
    </div>

    <p><strong>Workout:</strong> ${summary.workout_summary || "—"}</p>
    <p><strong>Recovery:</strong> ${summary.recovery_summary || "—"}</p>
    <p><strong>Sleep:</strong> ${summary.sleep_summary || "—"}</p>

    <details open>
      <summary>JSON</summary>
      <pre class="json-block">${prettyJson(summary)}</pre>
    </details>
  `;

  card.querySelector("button").addEventListener("click", async () => {
    await navigator.clipboard.writeText(prettyJson(summary));
  });

  container.appendChild(card);
}

async function loadLogs() {
  setStatus("logsStatus", "Loading...");
  try {
    const payload = {
      start_date: $("logsStartDate").value,
      end_date: $("logsEndDate").value,
      include_raw: true,
      include_events: true,
      limit: Number($("logsLimit").value || 100),
      offset: 0,
    };
    if ($("logsEventType").value) payload.event_type = $("logsEventType").value;

    const json = await callFunction("get-logs", payload);
    renderLogs(json.data.logs || []);
    setStatus("logsStatus", `${json.data.count || 0} log(s).`, "ok");
  } catch (err) {
    setStatus("logsStatus", err.message, "err");
  }
}

async function searchEvents() {
  setStatus("searchStatus", "Searching...");
  try {
    const payload = {
      limit: Number($("searchLimit").value || 50),
      offset: 0,
    };

    const query = $("searchQuery").value.trim();
    if (query) payload.query = query;
    if ($("searchEventType").value) payload.event_type = $("searchEventType").value;
    if ($("searchStartDate").value) payload.start_date = $("searchStartDate").value;
    if ($("searchEndDate").value) payload.end_date = $("searchEndDate").value;
    if ($("searchNeedsReview").value) payload.needs_review = $("searchNeedsReview").value === "true";

    const json = await callFunction("search-events", payload);
    renderSearchResults(json.data.results || []);
    setStatus("searchStatus", `${json.data.count || 0} event(s).`, "ok");
  } catch (err) {
    setStatus("searchStatus", err.message, "err");
  }
}

async function loadSummary() {
  setStatus("summaryStatus", "Loading...");
  try {
    const payload = {
      date: $("summaryDate").value,
      generate_if_missing: $("summaryGenerate").value === "true",
    };
    const json = await callFunction("get-day-summary", payload);
    renderSummary(json.data.summary, json.data);
    setStatus("summaryStatus", json.data.summary ? "Summary loaded." : "No summary.", "ok");
  } catch (err) {
    setStatus("summaryStatus", err.message, "err");
  }
}

function applyQuickField() {
  const field = $("quickField").value;
  if (!field) return;

  let changes = {};
  if (field === "needs_review_false") changes = { needs_review: false };
  if (field === "needs_review_true") changes = { needs_review: true };
  if (field === "meal_breakfast") changes = { facts: { meal_label: "breakfast" } };
  if (field === "meal_lunch") changes = { facts: { meal_label: "lunch" } };
  if (field === "meal_dinner") changes = { facts: { meal_label: "dinner" } };

  $("changesJson").value = prettyJson(changes);
}

async function updateEvent() {
  setStatus("editStatus", "Updating...");
  try {
    const eventId = $("editEventId").value.trim();
    if (!eventId) throw new Error("Event ID is required.");

    let changes;
    try {
      changes = JSON.parse($("changesJson").value);
    } catch (_err) {
      throw new Error("Changes JSON is invalid.");
    }

    const payload = {
      event_id: eventId,
      changes,
    };

    const reason = $("changeReason").value.trim();
    if (reason) payload.change_reason = reason;

    const json = await callFunction("update-event", payload);
    $("editResults").innerHTML = `<div class="panel"><h3>Updated</h3><pre class="json-block">${prettyJson(json.data)}</pre></div>`;
    setStatus("editStatus", "Updated.", "ok");
  } catch (err) {
    setStatus("editStatus", err.message, "err");
  }
}

function setupDefaults() {
  const today = todayIso();
  $("logsStartDate").value = today;
  $("logsEndDate").value = today;
  $("searchStartDate").value = "";
  $("searchEndDate").value = "";
  $("summaryDate").value = today;
}

function setupEvents() {
  $("saveSettingsBtn").addEventListener("click", saveSettings);
  $("clearSettingsBtn").addEventListener("click", clearSettings);
  $("loadLogsBtn").addEventListener("click", loadLogs);
  $("loadTodayBtn").addEventListener("click", () => {
    const today = todayIso();
    $("logsStartDate").value = today;
    $("logsEndDate").value = today;
    loadLogs();
  });
  $("searchBtn").addEventListener("click", searchEvents);
  $("needsReviewBtn").addEventListener("click", () => {
    $("searchQuery").value = "";
    $("searchEventType").value = "";
    $("searchNeedsReview").value = "true";
    searchEvents();
  });
  $("summaryBtn").addEventListener("click", loadSummary);
  $("quickField").addEventListener("change", applyQuickField);
  $("formatJsonBtn").addEventListener("click", () => {
    try {
      $("changesJson").value = prettyJson(JSON.parse($("changesJson").value));
      setStatus("editStatus", "Formatted.", "ok");
    } catch (_err) {
      setStatus("editStatus", "Invalid JSON.", "err");
    }
  });
  $("updateEventBtn").addEventListener("click", updateEvent);
}

loadSettings();
setupTabs();
setupEventTypeSelects();
setupDefaults();
setupEvents();



// ---------------- Historical import v0.2 ----------------

let importState = {
  payloads: [],
  results: [],
  nextIndex: 0,
};

function normalizeImportPayload(rawPayload) {
  const payload = { ...rawPayload };
  delete payload.pilot_index;
  delete payload.source_chunk;
  delete payload.source_message_index;
  if (!payload.source) payload.source = "chat_backfill";
  if (!Array.isArray(payload.events)) payload.events = [];
  return payload;
}

function parseImportJsonText() {
  const text = $("importJson").value.trim();
  if (!text) throw new Error("Paste or upload import JSON first.");

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Import JSON must be an array of addLogEntry payloads.");
  }

  const payloads = parsed.map(normalizeImportPayload);

  payloads.forEach((p, i) => {
    if (!p.occurred_date) throw new Error(`Payload ${i + 1} is missing occurred_date.`);
    if (!p.raw_text) throw new Error(`Payload ${i + 1} is missing raw_text.`);
    if (!p.source) throw new Error(`Payload ${i + 1} is missing source.`);
    if (!Array.isArray(p.events)) throw new Error(`Payload ${i + 1} events must be an array.`);
  });

  return payloads;
}

function renderImportSummary() {
  const container = $("importSummary");
  container.innerHTML = "";

  const total = importState.payloads.length;
  const success = importState.results.filter((r) => r.ok).length;
  const failed = importState.results.filter((r) => r.ok === false).length;
  const pending = Math.max(0, total - importState.nextIndex);

  const eventCounts = {};
  for (const p of importState.payloads) {
    for (const e of p.events || []) {
      eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;
    }
  }

  const card = document.createElement("article");
  card.className = "summary-card";
  card.innerHTML = `
    <h3>Import Preview</h3>
    <div class="import-summary-grid">
      ${metric("Payloads", total)}
      ${metric("Next Index", importState.nextIndex)}
      ${metric("Imported", success)}
      ${metric("Failed", failed)}
      ${metric("Pending", pending)}
      ${metric("Events", Object.values(eventCounts).reduce((a,b)=>a+b,0))}
    </div>
    <p><strong>Event counts:</strong> ${Object.entries(eventCounts).map(([k,v]) => `${k}: ${v}`).join(", ") || "—"}</p>
  `;
  container.appendChild(card);

  $("importNextBatchBtn").disabled = !total || importState.nextIndex >= total;
  $("importAllBtn").disabled = !total || importState.nextIndex >= total;
}

function renderImportPayloads(limit = 25) {
  const container = $("importResults");
  container.innerHTML = "";

  if (!importState.payloads.length) {
    container.innerHTML = `<div class="panel">No import payloads loaded.</div>`;
    return;
  }

  const start = Math.max(0, importState.nextIndex - 5);
  const end = Math.min(importState.payloads.length, start + limit);

  for (let i = start; i < end; i++) {
    const p = importState.payloads[i];
    const result = importState.results.find((r) => r.index === i);
    const stateClass = result ? (result.ok ? "imported" : "failed") : "pending";

    const card = document.createElement("article");
    card.className = `import-payload-card ${stateClass}`;

    const events = (p.events || []).map((e) => e.event_type).join(", ") || "none";
    card.innerHTML = `
      <div class="log-header">
        <div>
          <h3>#${i + 1} — ${p.occurred_date}</h3>
          <p class="hint">${p.source || ""} · events: ${events}</p>
        </div>
        <button class="secondary small">Copy JSON</button>
      </div>
      <div class="raw-text">${p.raw_text || ""}</div>
      ${result ? `<p class="${result.ok ? "status ok" : "status err"}">${result.ok ? "Imported" : "Failed"}: ${result.message || ""}</p>` : `<p class="status">Pending</p>`}
      <details>
        <summary>Payload JSON</summary>
        <pre class="json-block">${prettyJson(p)}</pre>
      </details>
      ${result ? `<details><summary>Result JSON</summary><pre class="json-block">${prettyJson(result)}</pre></details>` : ""}
    `;

    card.querySelector("button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(prettyJson(p));
    });

    container.appendChild(card);
  }
}

function parseImport() {
  setStatus("importStatus", "Parsing...");
  try {
    const payloads = parseImportJsonText();
    importState = {
      payloads,
      results: [],
      nextIndex: 0,
    };
    renderImportSummary();
    renderImportPayloads();
    setStatus("importStatus", `Parsed ${payloads.length} payload(s).`, "ok");
  } catch (err) {
    setStatus("importStatus", err.message, "err");
  }
}

async function importPayloadAt(index) {
  const original = importState.payloads[index];
  const payload = normalizeImportPayload(original);
  const json = await callFunction("add-log-entry", payload);
  return json;
}

async function importNextBatch() {
  const total = importState.payloads.length;
  if (!total || importState.nextIndex >= total) {
    setStatus("importStatus", "Nothing left to import.", "warn");
    return;
  }

  const batchSize = Math.max(1, Math.min(50, Number($("importBatchSize").value || 10)));
  const start = importState.nextIndex;
  const end = Math.min(total, start + batchSize);

  setStatus("importStatus", `Importing ${start + 1}–${end}...`);

  for (let i = start; i < end; i++) {
    try {
      const response = await importPayloadAt(i);
      importState.results.push({
        index: i,
        ok: true,
        message: `log_entry_id=${response.log_entry_id || response.data?.log_entry_id || ""}`,
        response,
      });
    } catch (err) {
      importState.results.push({
        index: i,
        ok: false,
        message: err.message,
      });
      // Stop on first failure. Safer for phone/admin import.
      importState.nextIndex = i;
      renderImportSummary();
      renderImportPayloads();
      setStatus("importStatus", `Stopped at #${i + 1}: ${err.message}`, "err");
      return;
    }

    importState.nextIndex = i + 1;
    renderImportSummary();
  }

  renderImportPayloads();
  setStatus("importStatus", `Imported ${start + 1}–${end}.`, "ok");
}

async function importAllRemaining() {
  while (importState.nextIndex < importState.payloads.length) {
    await importNextBatch();
    const last = importState.results[importState.results.length - 1];
    if (last && last.ok === false) return;
    // Tiny pause so mobile browser can breathe.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  setStatus("importStatus", "All remaining payloads imported.", "ok");
}

function resetImport() {
  importState = { payloads: [], results: [], nextIndex: 0 };
  $("importJson").value = "";
  $("importFile").value = "";
  renderImportSummary();
  renderImportPayloads();
  setStatus("importStatus", "Reset.", "warn");
}

function setupImportEvents() {
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      $("importJson").value = text;
      setStatus("importStatus", `Loaded ${file.name}.`, "ok");
    } catch (err) {
      setStatus("importStatus", err.message, "err");
    }
  });

  $("parseImportBtn").addEventListener("click", parseImport);
  $("importNextBatchBtn").addEventListener("click", importNextBatch);
  $("importAllBtn").addEventListener("click", importAllRemaining);
  $("resetImportBtn").addEventListener("click", resetImport);
}

// Run after existing setup.
setupImportEvents();
renderImportSummary();
