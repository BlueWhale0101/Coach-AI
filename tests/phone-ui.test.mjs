import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { node } from "../phone/dom.mjs";
import { createPhoneLoader } from "../phone/load-view.mjs";
import { agendaForDay, attentionTasks, phonePath, phoneRoute, shiftDay, taskActions, todayKey, upcomingEvents } from "../phone/view-model.mjs";
import { getPhoneTodaySnapshot, listTaskView, listWeekEvents } from "../tablet-board/data-provider.mjs";
import { StagedMutationController } from "../tablet-board/mutation-staging.mjs";

const date = "2026-09-27";

test("out-of-order phone loads cannot mutate or render state for any destination", async () => {
  for (const route of ["today", "tasks", "knowledge", "calendar"]) {
    const pending = [];
    const fetch = () => new Promise(resolve => pending.push(resolve));
    const state = {
      route, request: 0, snapshot: { id: "initial" }, items: [{ id: "initial" }],
      query: { tasks: "", knowledge: "" }, status: "open", category: { tasks: "", knowledge: "" }, tag: "", day: date,
    };
    const results = { busy: false, setAttribute() { this.busy = true; }, removeAttribute() { this.busy = false; }, replaceChildren() { throw new Error("stale response rendered"); } };
    let renders = 0;
    const load = createPhoneLoader({
      state, services: { getPhoneTodaySnapshot: fetch, listTaskView: fetch, listKnowledgeView: fetch, listWeekEvents: fetch },
      getResults: () => results, renderResults: () => { renders++; }, empty: () => null, shiftDay,
    });
    const first = load();
    const second = load();
    pending[1](route === "today" ? { id: "B" } : [{ id: "B" }]);
    await second;
    pending[0](route === "today" ? { id: "A" } : [{ id: "A" }]);
    await first;
    assert.equal(route === "today" ? state.snapshot.id : state.items[0].id, "B");
    assert.equal(renders, 1, `${route} rendered only request B`);
    assert.equal(results.busy, false);
  }
});

test("a resolved request from a previous route cannot change current phone state", async () => {
  let finishTasks;
  const state = { route: "tasks", request: 0, items: [], snapshot: null, query: { tasks: "", knowledge: "" }, status: "open", category: { tasks: "", knowledge: "" } };
  let renders = 0;
  const load = createPhoneLoader({
    state,
    services: {
      listTaskView: () => new Promise(resolve => { finishTasks = resolve; }),
      listKnowledgeView: async () => [{ id: "knowledge" }],
    },
    getResults: () => null, renderResults: () => { renders++; }, empty: () => null, shiftDay,
  });
  const first = load();
  state.route = "knowledge";
  await load();
  finishTasks([{ id: "stale task" }]);
  await first;
  assert.deepEqual(state.items, [{ id: "knowledge" }]);
  assert.equal(renders, 1);

  state.route = "tasks";
  const routeOnly = load();
  state.route = "knowledge";
  finishTasks([{ id: "wrong route" }]);
  await routeOnly;
  assert.deepEqual(state.items, [{ id: "knowledge" }]);
  assert.equal(renders, 1);
});

test("phone route and direct loads share the Site while tablet and root stay available", async () => {
  assert.equal(phoneRoute("/phone/"), "today");
  assert.equal(phoneRoute("/phone/tasks/"), "tasks");
  assert.equal(phonePath("calendar"), "/phone/calendar");
  execFileSync(process.execPath, ["scripts/build-tablet-board.mjs"], { cwd: new URL("../", import.meta.url) });
  const worker = (await import(`../dist/server/index.js?${Date.now()}`)).default;
  const request = path => worker.fetch(new Request(`https://assistant.example${path}`), {});
  assert.equal((await request("/phone/")).status, 200);
  assert.match(await (await request("/phone/tasks")).text(), /phone\/phone.mjs/);
  assert.equal((await request("/phone")).status, 308);
  assert.match((await request("/phone?fixtures=1")).headers.get("location"), /\/phone\/\?fixtures=1$/);
  assert.equal((await request("/tablet-board/tasks")).status, 200);
  assert.equal((await request("/")).status, 308);
  assert.equal((await request("/api/phone-today")).status, 405);
  assert.equal((await request("/api/tagged-tasks")).status, 405);
  assert.equal((await worker.fetch(new Request("https://assistant.example/api/phone-today", { method: "POST" }), {})).status, 503);
  assert.equal((await request("/api/client/today")).status, 404);
  assert.equal((await request("/api/arbitrary-function")).status, 404);
  const script = await readFile(new URL("../phone/phone.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /ASSISTANT_ACTION_API_SECRET|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE/);
});

test("Today composition respects task semantics and includes the next few calendar entries", () => {
  const now = "2026-09-27T07:30:00+09:30";
  const tasks = [
    { id: "a", pinned: true, due_at: null },
    { id: "b", deadlineLabel: "OVERDUE" },
    { id: "c", due_at: "2026-09-27T11:00:00+09:30" },
    { id: "d", due_at: "2026-09-29T11:00:00+09:30", surface_reason: "due_soon" },
    { id: "e", due_at: null, surface_reason: "actionable" },
    { id: "f", not_before: "2026-10-01T08:00:00+09:30" },
  ];
  assert.deepEqual(attentionTasks({ now, metadata: { today: date }, tasks }).map(task => task.id), ["a", "b", "c", "e"]);
  const days = [
    { date, allDay: [], events: [{ id: "today", ends_at: now }] },
    { date: "2026-09-28", allDay: [], events: [{ id: "tomorrow", ends_at: "2026-09-28T10:00:00+09:30" }] },
    { date: "2026-09-29", allDay: [{ id: "all" }], events: [] },
  ];
  assert.deepEqual(upcomingEvents(days, now).map(event => event.id), ["tomorrow", "all"]);
});

test("calendar uses Darwin dates and chronological agenda order", async () => {
  assert.equal(todayKey(new Date("2026-09-26T15:00:00Z")), "2026-09-27");
  assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  globalThis.location = { search: "" };
  globalThis.fetch = async (_path, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, data: { events: [] } }) };
  };
  try { await listWeekEvents({ weekStart: date, weekEnd: "2026-09-28" }); }
  finally { globalThis.fetch = previousFetch; globalThis.location = previousLocation; }
  assert.equal(calls[0].timed_overlap_start, "2026-09-26T14:30:00.000Z");
  assert.equal(calls[0].timed_overlap_end, "2026-09-27T14:30:00.000Z");
  assert.equal(calls[1].all_day_overlap_start, date);
  const agenda = agendaForDay([
    { id: "later", time_kind: "timed", starts_at: "2026-09-27T10:00:00+09:30" },
    { id: "day", time_kind: "all_day", start_date: "2026-09-27", end_date: "2026-09-29" },
    { id: "early", time_kind: "timed", starts_at: "2026-09-27T00:15:00+09:30" },
  ], date);
  assert.deepEqual(agenda.timed.map(event => event.id), ["early", "later"]);
  assert.deepEqual(agenda.allDay.map(event => event.id), ["day"]);
});

test("task lifecycle, category search, and safe text rendering", async () => {
  assert.deepEqual(taskActions({ status: "open" }), ["complete", "pin", "edit", "cancel"]);
  for (const status of ["completed", "cancelled"]) {
    assert.equal(taskActions({ status }).includes("complete"), false);
    assert.equal(taskActions({ status }).includes("cancel"), false);
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ set innerHTML(_) { throw new Error("parsed stored HTML"); } }) };
  try {
    const value = '<img src=x onerror="alert(1)">';
    assert.equal(node("strong", "title", value).textContent, value);
  } finally { globalThis.document = previousDocument; }
  const source = await readFile(new URL("../phone/phone.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|\.cancel\(\)/);
  assert.match(source, /clearTimeout\(state\.searchTimer\)/);
  assert.match(source, /renderResults\(\)/);
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  globalThis.location = { search: "" };
  globalThis.fetch = async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({ ok: true, data: { rows: [] } }) };
  };
  try { await listTaskView({ query: "  ring ", status: "completed", categoryId: "category-id" }); }
  finally { globalThis.fetch = previousFetch; globalThis.location = previousLocation; }
  assert.deepEqual(calls, [["/api/category-view", { object_type: "task", category_id: "category-id", status: "completed", query: "ring", limit: 80, offset: 0 }]]);
});

test("phone task tag selection composes filters, clears to All, and keeps decoration batched", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  globalThis.location = { search: "" };
  globalThis.fetch = async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({ ok: true, data: path === "/api/list-tags"
      ? { tags: [{ object_id: "tag-id", name: "Goodbye BBQ" }], has_more: false }
      : { rows: [{ object_id: "task-id", title: "Food", status: "open", classification: { category: null, tags: [{ name: "Goodbye BBQ" }] }, pinned: false }] } }) };
  };
  try {
    const { listTags } = await import("../tablet-board/data-provider.mjs");
    assert.deepEqual((await listTags()).map(tag => tag.name), ["Goodbye BBQ"]);
    await listTaskView({ query: "food", status: "open", categoryId: "cat-id", tagId: "tag-id", limit: 1 });
    assert.deepEqual(calls[1], ["/api/tagged-tasks", {
      tag_id: "tag-id", category_id: "cat-id", status: "open", query: "food", limit: 1, offset: 0,
    }]);
    assert.equal(calls.filter(([path]) => path === "/api/object-decorations").length, 0);
    const source = await readFile(new URL("../phone/phone.mjs", import.meta.url), "utf8");
    assert.match(source, /filterSelect\("Tag"/);
    assert.match(source, /\["", "All tags"\]/);
    assert.match(source, /Tags:.*item\.tags/);
  } finally { globalThis.fetch = previousFetch; globalThis.location = previousLocation; }
  const state = { route: "tasks", request: 0, query: { tasks: "food" }, status: "open", category: { tasks: "cat-id" }, tag: "tag-id", items: [] };
  const options = [];
  const load = createPhoneLoader({ state, services: { listTaskView: async value => { options.push(value); return []; } },
    getResults: () => null, renderResults: () => {}, empty: () => null, shiftDay });
  await load();
  state.tag = "";
  await load();
  assert.deepEqual(options.map(option => option.tagId), ["tag-id", ""]);
  assert.deepEqual(options.map(option => option.categoryId), ["cat-id", "cat-id"]);
  const previous = globalThis.location;
  globalThis.location = { search: "?fixtures=1" };
  try {
    const { listTags } = await import("../tablet-board/data-provider.mjs");
    assert.ok((await listTags()).some(tag => tag.name === "paperwork"));
    assert.deepEqual((await listTaskView({ tagId: "paperwork" })).map(task => task.object_id), ["task-preschool-form"]);
    assert.ok((await listTaskView({ tagId: "" })).length > 1);
  } finally { globalThis.location = previous; }
});

test("phone fixture Today and staged writes remain available across navigation and rapid actions", async () => {
  const previous = globalThis.location;
  globalThis.location = { search: "?fixtures=1" };
  try { assert.ok((await getPhoneTodaySnapshot()).tasks.length > 0); }
  finally { globalThis.location = previous; }
  const scheduled = new Map();
  let nextId = 0;
  const timers = { setTimeout(fn) { const id = ++nextId; scheduled.set(id, fn); return id; }, clearTimeout(id) { scheduled.delete(id); } };
  const staging = new StagedMutationController({ timers });
  const commits = [];
  staging.stage({ restore: "first", commit: async () => { commits.push("first"); } });
  let route = "tasks";
  route = "knowledge";
  assert.equal(route, "knowledge");
  assert.equal(staging.pending.restore, "first");
  staging.stage({ restore: "second", commit: async () => { commits.push("second"); } });
  await staging.commits;
  assert.deepEqual(commits, ["first"]);
  staging.undo();
  assert.deepEqual(commits, ["first"]);
});
