import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const widget = require("../assistant-ios/scriptable/assistant-widget.js");
const endpoint = "https://example-project.supabase.co/functions/v1/get-client-today";
const site = "https://assistant-tablet-board-v0.iona-skye-eller.chatgpt.site";
const generated = "2026-09-27T23:45:00Z"; // 09:15 on 28 September in Darwin.

const response = {
  ok: true,
  data: {
    date: "2026-09-28", timezone: "Australia/Darwin", generated_at: generated,
    tasks: [
      { object_id: "overdue", title: "Pay bill", due_at: "2026-09-27T23:00:00Z", surface_reason: "overdue", category: { color: "#5DD39E" } },
      { object_id: "today", title: "Call school", due_at: "2026-09-28T01:00:00Z", category: null },
      { object_id: "tomorrow", title: "Take recycling", due_at: "2026-09-28T16:00:00Z" },
      { object_id: "no-due", title: "Tidy shed", due_at: null },
      { object_id: "fifth", title: "Extra", due_at: null },
    ],
    events: [
      { object_id: "later", title: "Lunch", date: "2026-09-28", all_day: false, starts_at: "2026-09-28T04:00:00Z", ends_at: "2026-09-28T05:00:00Z" },
      { object_id: "all", title: "Holiday", date: "2026-09-28", all_day: true },
      { object_id: "current", title: "Appointment", date: "2026-09-28", all_day: false, starts_at: "2026-09-27T23:30:00Z", ends_at: "2026-09-28T00:00:00Z" },
    ],
  },
};

test("widget parses only the deployed Today contract and bounds its three views", () => {
  const snapshot = widget.parseSnapshot(response);
  assert.equal(snapshot.date, "2026-09-28");
  assert.deepEqual(widget.selectRows(snapshot, "tasks").tasks.map(task => task.object_id), ["overdue", "today", "tomorrow", "no-due"]);
  assert.deepEqual(widget.selectRows(snapshot, "calendar").events.map(event => event.object_id), ["all", "current", "later"]);
  assert.deepEqual(widget.selectRows(snapshot, "today").tasks.map(task => task.object_id), ["overdue", "today"]);
  assert.deepEqual(widget.selectRows(snapshot, "today").events.map(event => event.object_id), ["current"]);
  for (const invalid of [{ ok: false, data: response.data }, { ok: true, data: { ...response.data, timezone: "UTC" } }, { ok: true, data: { ...response.data, tasks: null } }]) {
    assert.throws(() => widget.parseSnapshot(invalid), /Unexpected widget response/);
  }
});

test("Today prefers a timed event while Calendar retains all-day and timed rows", () => {
  const events = [
    { object_id: "all-1", title: "Holiday", date: "2026-09-28", all_day: true },
    { object_id: "all-2", title: "Closure", date: "2026-09-28", all_day: true },
    { object_id: "next", title: "Visit", date: "2026-09-28", all_day: false, starts_at: "2026-09-28T01:00:00Z", ends_at: "2026-09-28T02:00:00Z" },
  ];
  const snapshot = widget.parseSnapshot({ ok: true, data: { ...response.data, events } });
  assert.deepEqual(widget.selectRows(snapshot, "calendar").events.map(event => event.object_id), ["all-1", "all-2", "next"]);
  assert.deepEqual(widget.selectRows(snapshot, "today").events.map(event => event.object_id), ["next"]);
  assert.deepEqual(widget.selectRows({ ...snapshot, events: events.slice(0, 2) }, "today").events.map(event => event.object_id), ["all-1"]);
});

test("deadline and event labels use Darwin boundaries without manufacturing a due date", () => {
  const [overdue, today, tomorrow, noDue] = response.data.tasks;
  assert.equal(widget.localDate("2026-09-27T14:30:00Z"), "2026-09-28");
  assert.equal(widget.taskDue(overdue, response.data.date, generated), "OVERDUE · 08:30");
  assert.equal(widget.taskDue(today, response.data.date, generated), "Today · 10:30");
  assert.equal(widget.taskDue(tomorrow, response.data.date, generated), "Tomorrow · 01:30");
  assert.equal(widget.taskDue(noDue, response.data.date, generated), "");
  assert.equal(widget.eventTime(response.data.events[1], response.data.date, generated), "All day");
  assert.equal(widget.eventTime(response.data.events[2], response.data.date, generated), "Now");
  assert.equal(widget.eventTime({ ...response.data.events[0], date: "2026-09-29" }, response.data.date, generated), "Tue 13:30");
  assert.equal(widget.categoryColor({ category: { color: "red" } }), "#5F6670");
});

test("last success cache is scoped to the public endpoint and rejects missing auth", () => {
  const snapshot = widget.parseSnapshot(response);
  const cache = JSON.stringify({ endpoint, snapshot });
  assert.deepEqual(widget.snapshotFromCache(cache, endpoint), snapshot);
  assert.equal(widget.snapshotFromCache(cache, "https://different.supabase.co/functions/v1/get-client-today"), null);
  assert.equal(widget.canUseCache(new Error("Network unavailable")), true);
  assert.equal(widget.canUseCache(new Error("Device token rejected")), false);
  assert.equal(widget.canUseCache(new Error("Open this script in Scriptable to finish setup")), false);
  assert.equal(widget.validEndpoint(endpoint), true);
  assert.equal(widget.validEndpoint("http://example-project.supabase.co/functions/v1/get-client-today"), false);
  assert.equal(widget.validEndpoint(`${endpoint}?token=secret`), false);
});

test("one script selects three existing Phone routes and keeps credentials out of source", async () => {
  assert.equal(widget.modeFromParameter(null), "today");
  assert.equal(widget.modeFromParameter(" Calendar "), "calendar");
  assert.throws(() => widget.modeFromParameter("knowledge"));
  assert.deepEqual(widget.MODES, { tasks: "/phone/tasks", calendar: "/phone/calendar", today: "/phone/" });
  const source = await readFile(new URL("../assistant-ios/scriptable/assistant-widget.js", import.meta.url), "utf8");
  assert.ok(source.includes(site));
  assert.match(source, /Keychain\.get\(TOKEN_KEY\)/);
  assert.match(source, /Keychain\.set\(TOKEN_KEY, token\)/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(source, /SERVICE_ROLE_KEY|ACTION_API_SECRET|SUPABASE_SERVICE_ROLE|\/api\/client\/today/);
  assert.doesNotMatch(source, /https:\/\/[a-z0-9]{20}\.supabase\.co/);
});

test("Scriptable entrypoint stores a token in Keychain, uses cached data offline, and hides data after rejection", async () => {
  const source = await readFile(new URL("../assistant-ios/scriptable/assistant-widget.js", import.meta.url), "utf8");
  const files = new Map();
  const keys = new Map();
  let requestStatus = 200;
  let received;
  let rendered;
  let prompts = 0;
  class Layout {
    constructor() { this.text = []; }
    addText(value) { this.text.push(value); return {}; }
    addStack() { const stack = new Layout(); this.text.push(stack); return stack; }
    addSpacer() {}
    setPadding() {}
    centerAlignContent() {}
    layoutHorizontally() {}
    addImage() { return {}; }
    async presentMedium() {}
  }
  class FakeAlert {
    addTextField() {}
    addSecureTextField() {}
    addAction() {}
    addCancelAction() {}
    async presentAlert() { prompts++; return 0; }
    textFieldValue() { return prompts === 1 ? endpoint : "a".repeat(64); }
  }
  const fileManager = {
    documentsDirectory: () => "/local", joinPath: (a, b) => `${a}/${b}`,
    fileExists: path => files.has(path), readString: path => files.get(path),
    writeString: (path, contents) => { files.set(path, contents); },
  };
  const globals = {
    module: { exports: {} }, // Scriptable also defines module; its presence must not disable rendering.
    ListWidget: Layout, Color: class { constructor(value) { this.value = value; } },
    Font: { boldSystemFont: () => ({}), mediumSystemFont: () => ({}) },
    SFSymbol: { named: () => null },
    FileManager: { local: () => fileManager },
    Keychain: { contains: key => keys.has(key), get: key => keys.get(key), set: (key, value) => keys.set(key, value) },
    Alert: FakeAlert, Intl, Date, JSON, Promise, Object, String,
    args: { widgetParameter: "tasks" }, config: { runsInWidget: false },
  };
  const labels = value => value.text.flatMap(item => typeof item === "string" ? [item] : labels(item));
  async function execute() {
    let complete;
    const finished = new Promise(resolve => { complete = resolve; });
    globals.Script = { setWidget(value) { rendered = value; }, complete };
    globals.Request = class {
      constructor(url) { received = { url, headers: null }; this.response = { statusCode: requestStatus }; }
      async loadString() {
        received.headers = this.headers;
        if (requestStatus === 0) throw Error("offline");
        return requestStatus === 200 ? JSON.stringify(response) : JSON.stringify({ ok: false, code: "UNAUTHORIZED" });
      }
    };
    vm.runInNewContext(source, { ...globals });
    await finished;
  }
  await execute();
  assert.equal(received.url, endpoint);
  assert.equal(received.headers.Authorization, `Bearer ${"a".repeat(64)}`);
  assert.equal(keys.size, 1);
  assert.equal(rendered.url, site + "/phone/tasks");
  assert.ok(labels(rendered).includes("Pay bill"));
  assert.equal([...files.values()].some(value => value.includes("a".repeat(64))), false);

  requestStatus = 0;
  globals.config.runsInWidget = true;
  await execute();
  assert.ok(labels(rendered).includes("Pay bill"));
  assert.ok(labels(rendered).some(value => value.startsWith("Saved ")));

  requestStatus = 401;
  await execute();
  assert.equal(labels(rendered).includes("Pay bill"), false);
  assert.ok(labels(rendered).some(value => value.includes("update your token")));
});
