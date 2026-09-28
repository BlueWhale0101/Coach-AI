import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWidgetTodayHandler } from "../supabase/functions/_shared/widget-today-api.mjs";

const token = "a".repeat(64);
const now = "2026-09-27T23:45:00Z"; // 09:15 on 28 September in Darwin.
const board = {
  metadata: { today: "2026-09-28", now, generated_at: now },
  tasks: [
    { object_id: "task-1", title: "Pay bill", due_at: "2026-09-27T22:00:00Z", surface_reason: "overdue", pinned: false, category: { name: "Home", color: "#7C9CFF" }, description: "private" },
    { object_id: "task-2", title: "Due today", due_at: "2026-09-28T10:00:00Z", surface_reason: "due_soon", pinned: false, category: null },
    { object_id: "task-3", title: "Tomorrow", due_at: "2026-09-28T16:00:00Z", surface_reason: "due_soon", pinned: false, category: null },
  ],
  days: [{ date: "2026-09-28", all_day_events: [{ object_id: "all-1", title: "Holiday", category: null }], timed_events: [
    { object_id: "past", title: "Finished", ends_at: "2026-09-27T23:00:00Z", starts_at: "2026-09-27T22:00:00Z" },
    { object_id: "next", title: "Appointment", starts_at: "2026-09-28T00:00:00Z", ends_at: "2026-09-28T01:00:00Z", category: { name: "Health", color: "#FF6FAE" }, description: "private" },
  ] }],
};

test("widget authorizes a revocable, scoped token and returns a bounded Darwin-local presentation contract", async () => {
  let calls = 0;
  const handler = createWidgetTodayHandler({
    repository: { async getPhoneToday(options) { calls++; assert.equal(options.timezone, "Australia/Darwin"); assert.equal(Date.parse(options.now), Date.parse(now)); return board; } },
    credentials: { async find(hash) { assert.match(hash, /^[0-9a-f]{64}$/); assert.notEqual(hash, token); return { scope: "widget:today:read" }; } },
    actionSecret: "site-only", clock: () => new Date(now),
  });
  const request = new Request("https://site.example/api/client/today", { headers: { authorization: `Bearer ${token}`, "x-action-secret": "site-only" } });
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { data } = await response.json();
  assert.equal(data.date, "2026-09-28");
  assert.equal(data.generated_at, now);
  assert.deepEqual(data.tasks.map(item => item.object_id), ["task-1", "task-2"]);
  assert.equal(data.tasks[0].category.color, "#7C9CFF");
  assert.equal(data.tasks[0].description, undefined);
  assert.deepEqual(data.events.map(item => item.object_id), ["all-1", "next"]);
  assert.equal(data.events[1].url, "/phone/calendar");
  assert.equal(data.url, "/phone/");
  assert.equal(calls, 1);
});

test("widget denies missing, revoked, expired and incorrectly scoped credentials without invoking the projection", async () => {
  let calls = 0;
  const repo = { async getPhoneToday() { calls++; return board; } };
  const make = credential => createWidgetTodayHandler({ repository: repo, credentials: { find: async () => credential }, actionSecret: "site-only", clock: () => new Date(now) });
  const request = (authorization, secret = "site-only") => new Request("https://site.example/api/client/today", { headers: { authorization, "x-action-secret": secret } });
  for (const credential of [null, { scope: "widget:today:read", revoked_at: now }, { scope: "widget:today:read", expires_at: now }, { scope: "tasks:write" }]) {
    assert.equal((await make(credential)(request(`Bearer ${token}`))).status, 401);
  }
  assert.equal((await make({ scope: "widget:today:read" })(request(`Bearer ${token}`, "wrong"))).status, 401);
  assert.equal((await make({ scope: "widget:today:read" })(request("Bearer bad"))).status, 401);
  assert.equal((await make({ scope: "widget:today:read" })(new Request("https://site.example/api/client/today?token=bad", { headers: { authorization: `Bearer ${token}`, "x-action-secret": "site-only" } }))).status, 400);
  assert.equal((await make({ scope: "widget:today:read" })(new Request("https://site.example/api/client/today", { method: "POST" }))).status, 405);
  assert.equal(calls, 0);
  assert.equal((await make({ scope: "widget:today:read" })(request(`Bearer ${token}`))).status, 200);
  const failing = createWidgetTodayHandler({ repository: { async getPhoneToday() { throw Error("DB secret"); } }, credentials: { find: async () => ({ scope: "widget:today:read" }) }, actionSecret: "site-only" });
  const failure = await failing(request(`Bearer ${token}`));
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes("DB secret"), false);
});

test("Site worker allowlists only GET client today and forwards token server-side", async () => {
  const source = await readFile(new URL("../scripts/build-tablet-board.mjs", import.meta.url), "utf8");
  assert.match(source, /url\.pathname === "\/api\/client\/today"/);
  assert.match(source, /"x-action-secret": secret/);
  assert.doesNotMatch(source, /ROUTES\["\/api\/client\/today"\]/);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.get-client-today\]\s*verify_jwt\s*=\s*false/);
});
