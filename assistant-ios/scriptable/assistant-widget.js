// Assistant.AI medium Home Screen widget for Scriptable.
// Widget parameter: tasks | calendar | today. Device token lives only in Keychain.
const SITE_URL = "https://assistant-tablet-board-v0.iona-skye-eller.chatgpt.site";
const TOKEN_KEY = "assistant.ai.widget.v1.device-token";
const CONFIG_FILE = "assistant-ai-widget-config.json";
const CACHE_FILE = "assistant-ai-widget-last-success.json";
const TIMEZONE = "Australia/Darwin";
const MODES = { tasks: "/phone/tasks", calendar: "/phone/calendar", today: "/phone/" };
const PALETTE = {
  background: "#17191C", surface: "#202328", text: "#F4F5F6",
  secondary: "#C2C7CE", muted: "#969DA6", accent: "#5DD39E",
  category: "#5F6670", overdue: "#FF7A59",
};

function localDate(instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function localTime(instant) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(instant));
}

function shortDay(date) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short" })
    .format(new Date(`${date}T12:00:00Z`));
}

function nextDate(date) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function taskDue(task, today, now) {
  if (!task.due_at) return "";
  const date = localDate(task.due_at);
  const time = localTime(task.due_at);
  if (Date.parse(task.due_at) < Date.parse(now)) return `OVERDUE · ${time}`;
  if (date === today) return `Today · ${time}`;
  if (date === nextDate(today)) return `Tomorrow · ${time}`;
  return `${date.slice(5)} · ${time}`;
}

function eventTime(event, today, now) {
  const prefix = event.date === today ? "" : `${shortDay(event.date)} `;
  if (event.all_day) return `${prefix}All day`;
  if (Date.parse(event.starts_at) <= Date.parse(now) && Date.parse(event.ends_at) > Date.parse(now)) return "Now";
  return `${prefix}${localTime(event.starts_at)}`;
}

function categoryColor(item) {
  const value = item.category?.color;
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : PALETTE.category;
}

function parseSnapshot(envelope) {
  const value = envelope?.data;
  if (envelope?.ok !== true || !value || value.timezone !== TIMEZONE ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      !Number.isFinite(Date.parse(value.generated_at)) ||
      !Array.isArray(value.tasks) || !Array.isArray(value.events)) {
    throw new Error("Unexpected widget response");
  }
  const tasks = value.tasks.slice(0, 6);
  const events = value.events.slice(0, 3);
  if (tasks.some(item => !item || typeof item.title !== "string" || typeof item.object_id !== "string") ||
      events.some(item => !item || typeof item.title !== "string" || typeof item.object_id !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || (!item.all_day && !Number.isFinite(Date.parse(item.starts_at))))) {
    throw new Error("Unexpected widget response");
  }
  return { date: value.date, generated_at: value.generated_at, tasks, events };
}

function selectRows(snapshot, mode) {
  const events = [...snapshot.events].sort((left, right) =>
    left.date.localeCompare(right.date) || (left.all_day ? 0 : Date.parse(left.starts_at)) -
      (right.all_day ? 0 : Date.parse(right.starts_at)));
  if (mode === "tasks") return { tasks: snapshot.tasks.slice(0, 4), events: [] };
  if (mode === "calendar") return { tasks: [], events: events.slice(0, 3) };
  const next = events.find(event => !event.all_day) ?? events[0];
  return { tasks: snapshot.tasks.slice(0, 2), events: next ? [next] : [] };
}

function modeFromParameter(parameter) {
  const mode = String(parameter ?? "today").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MODES, mode)) throw new Error("Widget parameter must be tasks, calendar, or today");
  return mode;
}

function validEndpoint(value) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/get-client-today$/.test(value);
}

function createText(container, text, size, color, weight = "regular") {
  const label = container.addText(text);
  label.font = weight === "bold" ? Font.boldSystemFont(size) : Font.mediumSystemFont(size);
  label.textColor = new Color(color);
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.8;
  return label;
}

function row(container, item, label, overdue = false, options = {}) {
  const line = container.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.spacing = 7;
  createText(line, "●", 8, categoryColor(item));
  const title = createText(line, item.title, options.titleSize ?? 14, PALETTE.text);
  title.lineLimit = options.titleLines ?? 1;
  title.minimumScaleFactor = options.minimumScaleFactor ?? 0.8;
  line.addSpacer(4);
  if (label) createText(line, label, options.labelSize ?? 11, overdue ? PALETTE.overdue : PALETTE.secondary);
}

function section(widget, title) {
  createText(widget, title.toUpperCase(), 10, PALETTE.muted, "bold");
  widget.addSpacer(5);
}

function snapshotFromCache(raw, endpoint) {
  const saved = JSON.parse(raw);
  if (saved.endpoint !== endpoint) return null;
  return parseSnapshot({ ok: true, data: { ...saved.snapshot, timezone: TIMEZONE } });
}

function canUseCache(problem) {
  return problem.message !== "Device token rejected" &&
    problem.message !== "Open this script in Scriptable to finish setup";
}

function renderWidget(snapshot, mode, { cached = false, now = new Date() } = {}) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(PALETTE.background);
  widget.setPadding(13, 15, 12, 15);
  widget.spacing = 0;
  widget.url = SITE_URL + MODES[mode];

  const header = widget.addStack();
  header.centerAlignContent();
  header.spacing = 6;
  const mark = SFSymbol.named("flame.fill");
  if (mark) {
    const icon = header.addImage(mark.image);
    icon.imageSize = new Size(12, 13);
    icon.tintColor = new Color(PALETTE.accent);
  }
  createText(header, `ASSISTANT · ${mode.toUpperCase()}`, 12, PALETTE.text, "bold");
  header.addSpacer();
  createText(header, new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE, day: "numeric", month: "short",
  }).format(new Date(`${snapshot.date}T12:00:00Z`)), 11, PALETTE.muted);
  widget.addSpacer(9);

  const selected = selectRows(snapshot, mode);
  if (mode !== "calendar") {
    if (mode === "today") section(widget, "Tasks");
    if (!selected.tasks.length) createText(widget, "Nothing needing attention", 14, PALETTE.secondary);
    selected.tasks.forEach((task, index) => {
      if (index) widget.addSpacer(mode === "tasks" ? 12 : 7);
      const label = taskDue(task, snapshot.date, now);
      row(widget, task, label, label.startsWith("OVERDUE"), mode === "tasks"
        ? { titleSize: 17, labelSize: 13, titleLines: 2, minimumScaleFactor: 0.9 }
        : {});
    });
  }
  if (mode === "today") widget.addSpacer(10);
  if (mode !== "tasks") {
    if (mode === "today") section(widget, "Next");
    if (!selected.events.length) createText(widget, "No upcoming events", 14, PALETTE.secondary);
    selected.events.forEach((event, index) => {
      if (index) widget.addSpacer(8);
      row(widget, event, eventTime(event, snapshot.date, now));
    });
  }

  widget.addSpacer();
  const footer = widget.addStack();
  const updated = localTime(snapshot.generated_at);
  createText(footer, `${cached ? "Saved" : "Updated"} ${updated}`, 10, PALETTE.muted);
  return widget;
}

function messageWidget(mode, message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(PALETTE.background);
  widget.setPadding(15, 16, 15, 16);
  widget.url = SITE_URL + MODES[mode];
  createText(widget, "ASSISTANT.AI", 12, PALETTE.accent, "bold");
  widget.addSpacer();
  createText(widget, message, 13, PALETTE.secondary);
  widget.addSpacer();
  return widget;
}

async function alert(title, message) {
  const prompt = new Alert();
  prompt.title = title;
  prompt.message = message;
  prompt.addAction("OK");
  await prompt.presentAlert();
}

async function askEndpoint() {
  const prompt = new Alert();
  prompt.title = "Assistant.AI widget API";
  prompt.message = "Paste the get-client-today URL from your successful API test.";
  prompt.addTextField("https://…supabase.co/functions/v1/get-client-today");
  prompt.addAction("Save");
  prompt.addCancelAction("Cancel");
  if (await prompt.presentAlert() === -1) throw new Error("Setup cancelled");
  const endpoint = prompt.textFieldValue(0).trim();
  if (!validEndpoint(endpoint)) throw new Error("Use the HTTPS get-client-today Supabase URL");
  return endpoint;
}

async function askToken() {
  const prompt = new Alert();
  prompt.title = "Assistant.AI device token";
  prompt.message = "Paste your 64-character widget token. It is saved in Scriptable Keychain.";
  prompt.addSecureTextField("Device token");
  prompt.addAction("Save");
  prompt.addCancelAction("Cancel");
  if (await prompt.presentAlert() === -1) throw new Error("Setup cancelled");
  const token = prompt.textFieldValue(0).trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error("The device token must be 64 hexadecimal characters");
  Keychain.set(TOKEN_KEY, token);
  return token;
}

async function loadData(endpoint, token) {
  const request = new Request(endpoint);
  request.method = "GET";
  request.headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  request.timeoutInterval = 12;
  let raw;
  try { raw = await request.loadString(); }
  catch {
    if ([401, 403].includes(request.response?.statusCode)) throw new Error("Device token rejected");
    throw new Error("Network unavailable");
  }
  const status = request.response?.statusCode;
  if (status === 401 || status === 403) throw new Error("Device token rejected");
  if (status !== 200) throw new Error(`Widget API returned ${status || "an error"}`);
  return parseSnapshot(JSON.parse(raw));
}

async function runScriptable() {
  const interactive = !config.runsInWidget;
  const mode = modeFromParameter(args.widgetParameter);
  const files = FileManager.local();
  const configPath = files.joinPath(files.documentsDirectory(), CONFIG_FILE);
  const cachePath = files.joinPath(files.documentsDirectory(), CACHE_FILE);
  let endpoint;
  let token;
  let snapshot;
  let cached = false;
  let failure;
  let tokenRejected = false;
  try {
    if (files.fileExists(configPath)) {
      try { endpoint = JSON.parse(files.readString(configPath)).endpoint; } catch { /* prompt again */ }
    }
    if (!validEndpoint(endpoint) && interactive) {
      endpoint = await askEndpoint();
      files.writeString(configPath, JSON.stringify({ endpoint }));
    }
    if (Keychain.contains(TOKEN_KEY)) token = Keychain.get(TOKEN_KEY);
    if (!token && interactive) token = await askToken();
    if (!validEndpoint(endpoint) || !token) throw new Error("Open this script in Scriptable to finish setup");
    try {
      snapshot = await loadData(endpoint, token);
    } catch (problem) {
      tokenRejected = problem.message === "Device token rejected";
      if (tokenRejected && interactive) {
        token = await askToken();
        snapshot = await loadData(endpoint, token);
      } else throw problem;
    }
    files.writeString(cachePath, JSON.stringify({ endpoint, snapshot }));
  } catch (problem) {
    failure = problem;
    // Revocation/invalid credentials and missing configuration fail closed.
    if (!tokenRejected && canUseCache(problem) && validEndpoint(endpoint) && token && files.fileExists(cachePath)) {
      try {
        snapshot = snapshotFromCache(files.readString(cachePath), endpoint);
        cached = Boolean(snapshot);
      } catch { /* show restrained status instead */ }
    }
  }
  if (failure && interactive) await alert("Assistant.AI widget", failure.message);
  const widget = snapshot ? renderWidget(snapshot, mode, { cached }) : messageWidget(mode,
    failure?.message === "Device token rejected" ? "Open Scriptable to update your token" : "Open Scriptable to check the widget");
  Script.setWidget(widget);
  if (interactive) await widget.presentMedium();
  Script.complete();
}

// Node tests load the pure helpers; Scriptable executes the native widget entrypoint.
if (typeof ListWidget === "undefined") {
  module.exports = { localDate, localTime, taskDue, eventTime, categoryColor, parseSnapshot,
    selectRows, modeFromParameter, validEndpoint, snapshotFromCache, canUseCache, MODES };
} else {
  runScriptable().catch(async problem => {
    if (!config.runsInWidget) await alert("Assistant.AI widget", problem.message);
    Script.setWidget(messageWidget("today", "Open Scriptable to check the widget"));
    Script.complete();
  });
}
