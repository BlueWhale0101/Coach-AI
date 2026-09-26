import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRecurrenceHandler, OPERATIONS } from "../supabase/functions/_shared/recurrence-api.mjs";
import { SupabaseRecurrenceRepository } from "../supabase/functions/_shared/supabase-recurrence-repository.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const seed = "10000000-0000-4000-8000-000000000002";
const generated = "10000000-0000-4000-8000-000000000003";
const timestamp = "2026-10-31T05:30:00Z";
const date = "2026-10-31";
const rule = { object_id: id, seed_object_id: seed, basis: "calendar", frequency: "daily", interval_count: 1, anchor_kind: "date", anchor_date: date, status: "active" };
const occurrence = { recurrence_object_id: id, seed_object_id: seed, sequence: 1, occurrence_date: "2026-11-01", occurrence_at: null };
const repository = {
  create: async () => rule, update: async () => rule, end: async () => rule, get: async () => rule,
  list: async () => ({ rows: [rule], hasMore: true }), due: async () => ({ rows: [occurrence], hasMore: true }),
  next: async () => occurrence, record: async () => occurrence,
};
const req = (value, secret = "secret", method = "POST") => new Request("http://localhost", {
  method, headers: { "content-type": "application/json", "x-action-secret": secret },
  ...(method === "POST" ? { body: JSON.stringify(value) } : {}),
});
async function call(operation, value, repo = repository) {
  const response = await createRecurrenceHandler({ operation, repository: repo, actionSecret: "secret" })(req(value));
  return [response.status, await response.json()];
}

test("eight endpoints validate inputs, expose documented envelopes and page bounds", async () => {
  const calls = [];
  const repo = Object.fromEntries(Object.entries(repository).map(([name, fn]) => [name, async (...args) => { calls.push([name, ...args]); return fn(...args); }]));
  const inputs = [
    ["create_recurrence", { seed_object_id: seed, basis: "calendar", frequency: "weekly", interval_count: 2, anchor_kind: "date", anchor_date: date, seed_occurrence_date: date, weekdays: [6, 1] }],
    ["update_recurrence", { object_id: id, interval_count: 2, weekdays: [6, 1] }],
    ["end_recurrence", { object_id: id }], ["get_recurrence", { object_id: id }],
    ["list_recurrences", { status: "active", basis: "calendar", seed_object_id: seed, limit: 1, offset: 2 }],
    ["list_due_recurrence_occurrences", { from_at: timestamp, through_at: "2026-11-03T05:30Z", from_date: date, through_date: "2026-11-03", limit: 1, offset: 2 }],
    ["next_after_completion", { object_id: id, completed_object_id: seed, completed_at: timestamp }],
    ["record_recurrence_occurrence", { object_id: id, sequence: 1, occurrence_date: "2026-11-01", generated_object_id: generated }],
  ];
  for (const [operation, input] of inputs) {
    const [status, body] = await call(operation, input, repo);
    assert.equal(status, 200, operation); assert.equal(body.ok, true, operation);
    if (["list_recurrences", "list_due_recurrence_occurrences"].includes(operation)) {
      assert.equal(body.data.limit, 1); assert.equal(body.data.offset, 2); assert.equal(body.data.count, 1); assert.equal(body.data.has_more, true);
    }
  }
  assert.deepEqual(calls, [
    ["create", { seed_object_id: seed, basis: "calendar", frequency: "weekly", interval_count: 2, anchor_kind: "date", anchor_date: date, seed_occurrence_date: date, weekdays: [1, 6] }],
    ["update", id, { interval_count: 2, weekdays: [1, 6] }], ["end", id], ["get", id],
    ["list", { limit: 1, offset: 2, status: "active", basis: "calendar", seed_object_id: seed }],
    ["due", { limit: 1, offset: 2, from_at: timestamp, through_at: "2026-11-03T05:30Z", from_date: date, through_date: "2026-11-03" }],
    ["next", id, seed, timestamp], ["record", id, { sequence: 1, occurrence_at: null, occurrence_date: "2026-11-01", generated_object_id: generated }],
  ]);
  const completion = { seed_object_id: seed, basis: "after_completion", frequency: "monthly", interval_count: 1, timezone: "America/New_York", seed_occurrence_at: timestamp };
  assert.equal((await call("create_recurrence", completion))[1].ok, true);
  assert.equal((await call("create_recurrence", { seed_object_id: seed, basis: "calendar", frequency: "daily", interval_count: 1, anchor_kind: "instant", anchor_at: timestamp, timezone: "America/New_York", seed_occurrence_at: timestamp }))[1].ok, true);
  assert.equal((await call("record_recurrence_occurrence", { object_id: id, sequence: 1, occurrence_at: timestamp, generated_object_id: generated, completed_object_id: seed, completed_at: timestamp }))[1].ok, true);
});

test("malformed shapes, dates, timestamps, weekday sets, immutable fields and horizon validation", async () => {
  const base = { seed_object_id: seed, basis: "calendar", frequency: "daily", interval_count: 1, anchor_kind: "date", anchor_date: date, seed_occurrence_date: date };
  const cases = [
    ["create_recurrence", { ...base, seed_object_id: "bad" }, "INVALID_OBJECT_ID"],
    ["create_recurrence", { ...base, interval_count: 0 }, "VALIDATION_ERROR"],
    ["create_recurrence", { ...base, anchor_date: "2026-02-30" }, "INVALID_DATE"],
    ["create_recurrence", { ...base, weekdays: [1] }, "VALIDATION_ERROR"],
    ["create_recurrence", { ...base, frequency: "weekly", weekdays: [1, 1] }, "VALIDATION_ERROR"],
    ["create_recurrence", { ...base, timezone: "UTC" }, "VALIDATION_ERROR"],
    ["create_recurrence", { ...base, seed_occurrence_date: "2026-11-01" }, "VALIDATION_ERROR"],
    ["create_recurrence", { ...base, anchor_kind: "instant", anchor_at: "2026-10-31T05:30", timezone: "UTC", seed_occurrence_at: timestamp, anchor_date: undefined, seed_occurrence_date: undefined }, "INVALID_TIMESTAMP"],
    ["create_recurrence", { ...base, status: "ended" }, "IMMUTABLE_FIELD"],
    ["update_recurrence", { object_id: id, anchor_date: date }, "IMMUTABLE_FIELD"],
    ["update_recurrence", { object_id: id }, "MISSING_REQUIRED_FIELD"],
    ["get_recurrence", { object_id: "bad" }, "INVALID_OBJECT_ID"],
    ["list_recurrences", { limit: 101 }, "INVALID_PAGINATION"],
    ["list_recurrences", { offset: 10001 }, "INVALID_PAGINATION"],
    ["list_due_recurrence_occurrences", { from_date: date }, "INVALID_TIME_WINDOW"],
    ["list_due_recurrence_occurrences", {}, "MISSING_REQUIRED_FIELD"],
    ["list_due_recurrence_occurrences", { from_date: "2026-11-02", through_date: date }, "INVALID_TIME_WINDOW"],
    ["list_due_recurrence_occurrences", { from_at: "2026-10-31T05:30", through_at: timestamp }, "INVALID_TIMESTAMP"],
    ["record_recurrence_occurrence", { object_id: id, sequence: 0, occurrence_date: date, generated_object_id: generated }, "VALIDATION_ERROR"],
    ["record_recurrence_occurrence", { object_id: id, sequence: 1, occurrence_at: timestamp, occurrence_date: date, generated_object_id: generated }, "VALIDATION_ERROR"],
    ["record_recurrence_occurrence", { object_id: id, sequence: 1, occurrence_date: date, generated_object_id: generated, completed_at: timestamp }, "VALIDATION_ERROR"],
    ["next_after_completion", { object_id: id, completed_object_id: seed, completed_at: "2026-10-31T05:30" }, "INVALID_TIMESTAMP"],
  ];
  for (const [operation, input, expected] of cases) {
    const [status, body] = await call(operation, input);
    assert.equal(status, 400, operation + JSON.stringify(input)); assert.equal(body.code, expected, operation + JSON.stringify(input));
  }
});

test("authentication, CORS, safe errors, repository RPC mapping and config", async () => {
  const handler = createRecurrenceHandler({ operation: "get_recurrence", repository, actionSecret: "secret" });
  assert.equal((await handler(req({ object_id: id }, "wrong"))).status, 401);
  assert.equal((await handler(req({}, "secret", "OPTIONS"))).status, 200);
  assert.equal((await handler(req({}, "secret", "GET"))).status, 405);
  assert.equal((await handler(new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ object_id: id }) }))).status, 200);
  assert.equal((await (await handler(new Request("http://localhost", { method: "POST", headers: { "x-action-secret": "secret" }, body: "{" }))).json()).code, "INVALID_JSON");
  const calls = [];
  const repo = new SupabaseRecurrenceRepository({ rpc: async (name, params) => { calls.push([name, params]); return { data: name.includes("list") ? [rule, rule] : [rule], error: null }; } });
  await repo.create({ seed_object_id: seed, basis: "calendar", frequency: "daily", interval_count: 1, anchor_kind: "date", anchor_date: date, seed_occurrence_date: date });
  assert.deepEqual(calls[0], ["assistant_create_recurrence", { p_seed_object_id: seed, p_basis: "calendar", p_frequency: "daily", p_interval_count: 1, p_anchor_kind: "date", p_anchor_at: null, p_anchor_date: date, p_timezone: null, p_weekdays: null, p_seed_occurrence_at: null, p_seed_occurrence_date: date }]);
  assert.deepEqual(await repo.list({ limit: 1, offset: 2 }), { rows: [rule], hasMore: true });
  assert.deepEqual(calls[1], ["assistant_list_recurrences", { p_status: null, p_seed_object_id: null, p_basis: null, p_limit: 2, p_offset: 2 }]);
  await repo.due({ from_date: date, through_date: "2026-11-01", limit: 1, offset: 2 });
  assert.deepEqual(calls[2], ["assistant_list_due_recurrence_occurrences", { p_from_at: null, p_through_at: null, p_from_date: date, p_through_date: "2026-11-01", p_limit: 2, p_offset: 2 }]);
  const empty = new SupabaseRecurrenceRepository({ rpc: async () => ({ data: [], error: null }) });
  assert.equal(await empty.next(id, seed, timestamp), null);
  for (const [code, message, expected, status] of [["P0002", "missing", "RECURRENCE_NOT_FOUND", 404], ["55000", "terminal", "INVALID_TRANSITION", 409], ["23505", "duplicate", "OCCURRENCE_CONFLICT", 409], ["22023", "invalid recurrence timezone", "INVALID_TIMEZONE", 400], ["23514", "sensitive SQL detail", "VALIDATION_ERROR", 400], ["other", "sensitive SQL detail", "DATABASE_ERROR", 500]]) {
    const bad = new SupabaseRecurrenceRepository({ rpc: async () => ({ data: null, error: { code, message } }) });
    const [actual, body] = await call("end_recurrence", { object_id: id }, bad);
    assert.equal(actual, status); assert.equal(body.code, expected); assert.doesNotMatch(JSON.stringify(body), /sensitive SQL detail/);
  }
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const dirs = await readdir(new URL("../supabase/functions/", import.meta.url));
  for (const operation of OPERATIONS) {
    const name = operation.replaceAll("_", "-");
    assert.ok(dirs.includes(name));
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt\\s*=\\s*false`));
    assert.match(await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8"), new RegExp(`serveRecurrenceOperation\\("${operation}"\\)`));
  }
  for (const protectedName of ["create-task", "create-knowledge", "create-reminder", "create-schedule-event"]) assert.match(config, new RegExp(`\\[functions\\.${protectedName}\\]`));
});
