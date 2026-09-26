import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createScheduleHandler } from "../supabase/functions/_shared/schedule-api.mjs";
import { SupabaseScheduleRepository } from "../supabase/functions/_shared/supabase-schedule-repository.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const timed = { time_kind: "timed", starts_at: "2026-11-14T14:00:00+09:30", ends_at: "2026-11-14T15:00:00+09:30", timezone: "Australia/Darwin" };
const allDay = { time_kind: "all_day", start_date: "2026-11-14", end_date: "2026-11-15" };
const event = { object_id: id, title: "Wedding", ...allDay, status: "scheduled" };
const repository = {
  create: async () => event, update: async () => event, cancel: async () => event,
  get: async () => event, list: async () => ({ rows: [event], hasMore: true }),
  search: async () => ({ rows: [], hasMore: false }),
};
const request = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method, headers: { "content-type": "application/json", "x-action-secret": secret },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
async function call(operation, body, repo = repository, secret = "secret") {
  const result = await createScheduleHandler({ operation, repository: repo, actionSecret: "secret" })(request(body, secret));
  return [result.status, await result.json()];
}

test("six capability endpoints use stable envelopes and valid complete temporal inputs", async () => {
  const seen = [];
  const repo = Object.fromEntries(Object.entries(repository).map(([name, fn]) => [name, async (...args) => { seen.push([name, ...args]); return fn(...args); }]));
  const operations = [
    ["create_schedule_event", { title: " Dentist ", description: " Bring notes ", ...timed }],
    ["update_schedule_event", { object_id: id, title: "Rescheduled", ...allDay }],
    ["cancel_schedule_event", { object_id: id }],
    ["get_schedule_event", { object_id: id }],
    ["list_schedule_events", { status: "scheduled", timed_overlap_start: timed.starts_at, timed_overlap_end: timed.ends_at,
      all_day_overlap_start: allDay.start_date, all_day_overlap_end: allDay.end_date, limit: 1, offset: 2 }],
    ["search_schedule_events", { query: " Dentist ", status: "cancelled", limit: 1, offset: 2 }],
  ];
  for (const [operation, input] of operations) {
    const [status, body] = await call(operation, input, repo);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    if (["list_schedule_events", "search_schedule_events"].includes(operation)) {
      assert.equal(body.data.limit, 1);
      assert.equal(body.data.offset, 2);
    } else assert.deepEqual(body.data, { event });
  }
  assert.deepEqual(seen, [
    ["create", { title: "Dentist", ...timed, description: "Bring notes" }],
    ["update", id, { title: "Rescheduled", ...allDay }], ["cancel", id], ["get", id],
    ["list", { limit: 1, offset: 2, status: "scheduled", timed_overlap_start: timed.starts_at, timed_overlap_end: timed.ends_at,
      all_day_overlap_start: allDay.start_date, all_day_overlap_end: allDay.end_date }],
    ["search", { limit: 1, offset: 2, status: "cancelled", query: "Dentist" }],
  ]);
  const [listStatus, list] = await call("list_schedule_events", { limit: 1, offset: 2 });
  assert.equal(listStatus, 200);
  assert.deepEqual(list.data, { events: [event], limit: 1, offset: 2, count: 1, has_more: true });
});

test("timestamp, date, representation, update and window validation", async () => {
  const cases = [
    ["create_schedule_event", { title: "Missing kind" }, "VALIDATION_ERROR"],
    ["create_schedule_event", { title: "Mixed", ...timed, start_date: "2026-11-14" }, "VALIDATION_ERROR"],
    ["create_schedule_event", { title: "Missing end", time_kind: "all_day", start_date: "2026-11-14" }, "MISSING_REQUIRED_FIELD"],
    ["create_schedule_event", { title: "Naive", ...timed, starts_at: "2026-11-14T14:00:00" }, "INVALID_TIMESTAMP"],
    ["create_schedule_event", { title: "Bad zone", ...timed, timezone: "  " }, "VALIDATION_ERROR"],
    ["create_schedule_event", { title: "Bad date", ...allDay, start_date: "2026-02-30" }, "INVALID_DATE"],
    ["create_schedule_event", { title: "Zero", ...timed, ends_at: timed.starts_at }, "INVALID_TIME_WINDOW"],
    ["create_schedule_event", { title: "Reverse", ...allDay, end_date: "2026-11-13" }, "INVALID_TIME_WINDOW"],
    ["create_schedule_event", { title: "Blank", ...allDay, description: " " }, "VALIDATION_ERROR"],
    ["update_schedule_event", { object_id: id, time_kind: "timed", starts_at: timed.starts_at }, "MISSING_REQUIRED_FIELD"],
    ["update_schedule_event", { object_id: id, time_kind: "all_day", ...allDay, timezone: null }, "VALIDATION_ERROR"],
    ["update_schedule_event", { object_id: id, status: "cancelled" }, "IMMUTABLE_FIELD"],
    ["update_schedule_event", { object_id: id, created_at: "2026-01-01" }, "IMMUTABLE_FIELD"],
    ["update_schedule_event", { object_id: id }, "MISSING_REQUIRED_FIELD"],
    ["get_schedule_event", { object_id: "invalid" }, "INVALID_OBJECT_ID"],
    ["list_schedule_events", { timed_overlap_start: timed.starts_at }, "INVALID_TIME_WINDOW"],
    ["list_schedule_events", { all_day_overlap_end: allDay.end_date }, "INVALID_TIME_WINDOW"],
    ["list_schedule_events", { timed_overlap_start: timed.ends_at, timed_overlap_end: timed.starts_at }, "INVALID_TIME_WINDOW"],
    ["list_schedule_events", { all_day_overlap_start: allDay.end_date, all_day_overlap_end: allDay.start_date }, "INVALID_TIME_WINDOW"],
    ["list_schedule_events", { limit: 101 }, "INVALID_PAGINATION"],
    ["list_schedule_events", { offset: -1 }, "INVALID_PAGINATION"],
    ["list_schedule_events", { status: "open" }, "VALIDATION_ERROR"],
    ["search_schedule_events", { query: " " }, "VALIDATION_ERROR"],
    ["search_schedule_events", { query: "x", timed_overlap_start: timed.starts_at }, "IMMUTABLE_FIELD"],
  ];
  for (const [operation, input, expected] of cases) {
    const [status, body] = await call(operation, input);
    assert.equal(status, 400, operation + " " + JSON.stringify(input));
    assert.equal(body.code, expected, operation + " " + JSON.stringify(input));
  }
});

test("authentication, fallback, method handling, not found and safe errors", async () => {
  assert.deepEqual(await call("get_schedule_event", { object_id: id }, repository, "wrong"),
    [401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED", details: {} }]);
  const handler = createScheduleHandler({ operation: "get_schedule_event", repository, actionSecret: "secret" });
  assert.equal((await handler(request({}, "secret", "OPTIONS"))).status, 200);
  assert.equal((await handler(request({}, "secret", "GET"))).status, 405);
  assert.equal((await handler(new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ object_id: id }) }))).status, 200);
  const invalid = await handler(new Request("http://localhost", { method: "POST", headers: { "x-action-secret": "secret" }, body: "{" }));
  assert.equal((await invalid.json()).code, "INVALID_JSON");
  const missing = new SupabaseScheduleRepository({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) });
  assert.deepEqual((await call("get_schedule_event", { object_id: id }, missing)).map((value, i) => i ? value.code : value), [404, "EVENT_NOT_FOUND"]);
  for (const [code, message, expected, status] of [
    ["P0002", "missing", "EVENT_NOT_FOUND", 404],
    ["55000", "terminal", "INVALID_TRANSITION", 409],
    ["22023", "invalid schedule timezone", "INVALID_TIMEZONE", 400],
    ["23514", "sensitive database details", "VALIDATION_ERROR", 400],
    ["unexpected", "sensitive database details", "DATABASE_ERROR", 500],
  ]) {
    const repo = new SupabaseScheduleRepository({ rpc: async () => ({ data: null, error: { code, message } }) });
    const [actual, result] = await call("cancel_schedule_event", { object_id: id }, repo);
    assert.equal(actual, status);
    assert.equal(result.code, expected);
    assert.doesNotMatch(JSON.stringify(result), /sensitive database details/);
  }
});

test("repository uses atomic create and bounded list/search RPCs", async () => {
  const calls = [];
  const repo = new SupabaseScheduleRepository({ rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: name === "assistant_create_schedule_event" ? [event] : [event, event], error: null };
  } });
  assert.deepEqual(await repo.create({ title: "Wedding", ...allDay }), event);
  assert.deepEqual(calls[0], ["assistant_create_schedule_event", {
    p_title: "Wedding", p_description: null, p_time_kind: "all_day", p_starts_at: null, p_ends_at: null,
    p_timezone: null, p_start_date: "2026-11-14", p_end_date: "2026-11-15",
  }]);
  const options = { limit: 1, offset: 3, status: "scheduled", timed_overlap_start: timed.starts_at,
    timed_overlap_end: timed.ends_at, all_day_overlap_start: allDay.start_date, all_day_overlap_end: allDay.end_date };
  assert.deepEqual(await repo.list(options), { rows: [event], hasMore: true });
  assert.deepEqual(calls[1], ["assistant_list_schedule_events", {
    p_status: "scheduled", p_timed_overlap_start: timed.starts_at, p_timed_overlap_end: timed.ends_at,
    p_all_day_overlap_start: allDay.start_date, p_all_day_overlap_end: allDay.end_date,
    p_limit: 2, p_offset: 3,
  }]);
  assert.deepEqual(await repo.search({ query: "Wedding", status: "cancelled", limit: 1, offset: 2 }), { rows: [event], hasMore: true });
  assert.deepEqual(calls[2], ["assistant_search_schedule_events", { p_query: "Wedding", p_status: "cancelled", p_limit: 2, p_offset: 2 }]);
});

test("config declares all Scheduling and earlier Assistant functions", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  for (const name of ["create-schedule-event", "update-schedule-event", "cancel-schedule-event", "get-schedule-event", "list-schedule-events", "search-schedule-events"]) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt\\s*=\\s*false`));
  }
  for (const name of ["create-task", "create-knowledge", "create-reminder"]) assert.match(config, new RegExp(`\\[functions\\.${name}\\]`));
});
