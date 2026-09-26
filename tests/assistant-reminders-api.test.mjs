import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReminderHandler } from "../supabase/functions/_shared/reminder-api.mjs";
import { SupabaseReminderRepository } from "../supabase/functions/_shared/supabase-reminder-repository.mjs";

const objectId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";
const at = "2026-10-01T17:00:00Z";
const reminder = { object_id: objectId, target_object_id: targetId, remind_at: at, status: "pending" };
const repository = {
  create: async () => reminder, updateTime: async () => reminder,
  cancel: async () => reminder, deliver: async () => reminder,
  get: async () => reminder, list: async () => ({ rows: [reminder], hasMore: true }),
};
const request = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method, headers: { "content-type": "application/json", "x-action-secret": secret },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
async function call(operation, body, repo = repository, secret = "secret") {
  const result = await createReminderHandler({ operation, repository: repo, actionSecret: "secret" })(request(body, secret));
  return [result.status, await result.json()];
}

test("all six capability endpoints, method, auth and envelope", async () => {
  const seen = [];
  const repo = Object.fromEntries(Object.entries(repository).map(([name, fn]) => [name, async (...args) => {
    seen.push([name, ...args]);
    return fn(...args);
  }]));
  const operations = [
    ["create_reminder", { target_object_id: targetId, remind_at: at }],
    ["update_reminder_time", { object_id: objectId, remind_at: at }],
    ["cancel_reminder", { object_id: objectId }],
    ["mark_reminder_delivered", { object_id: objectId }],
    ["get_reminder", { object_id: objectId }],
    ["list_reminders", { status: "pending", target_object_id: targetId, due_after: at, due_before: at, limit: 1, offset: 2 }],
  ];
  for (const [operation, body] of operations) {
    const [status, response] = await call(operation, body, repo);
    assert.equal(status, 200);
    assert.equal(response.ok, true);
    if (operation !== "list_reminders") assert.deepEqual(response.data, { reminder });
    else assert.deepEqual(response.data, { reminders: [reminder], limit: 1, offset: 2, count: 1, has_more: true });
  }
  assert.deepEqual(seen, [
    ["create", targetId, at], ["updateTime", objectId, at],
    ["cancel", objectId], ["deliver", objectId], ["get", objectId],
    ["list", { limit: 1, offset: 2, status: "pending", target_object_id: targetId, due_after: at, due_before: at }],
  ]);
  assert.deepEqual(await call("get_reminder", { object_id: objectId }, repo, "wrong"),
    [401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED", details: {} }]);
  const handler = createReminderHandler({ operation: "get_reminder", repository: repo, actionSecret: "secret" });
  assert.equal((await handler(request({}, "secret", "GET"))).status, 405);
  assert.equal((await handler(request({}, "secret", "OPTIONS"))).status, 200);
  const fallback = new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ object_id: objectId }) });
  assert.equal((await handler(fallback)).status, 200);
});

test("validation rejects malformed timestamps, IDs, lifecycle fields, pagination and time window", async () => {
  const cases = [
    ["create_reminder", { target_object_id: "bad", remind_at: at }, "INVALID_OBJECT_ID"],
    ["create_reminder", { target_object_id: targetId, remind_at: "tomorrow" }, "INVALID_TIMESTAMP"],
    ["update_reminder_time", { object_id: objectId }, "INVALID_TIMESTAMP"],
    ["update_reminder_time", { object_id: objectId, remind_at: at, status: "delivered" }, "IMMUTABLE_FIELD"],
    ["cancel_reminder", { object_id: objectId, delivered_at: at }, "IMMUTABLE_FIELD"],
    ["list_reminders", { status: "unknown" }, "VALIDATION_ERROR"],
    ["list_reminders", { limit: 101 }, "INVALID_PAGINATION"],
    ["list_reminders", { offset: -1 }, "INVALID_PAGINATION"],
    ["list_reminders", { due_after: "2026-10-03T00:00:00Z", due_before: at }, "INVALID_TIME_WINDOW"],
    ["list_reminders", { target_object_id: "bad" }, "INVALID_OBJECT_ID"],
    ["list_reminders", { query: "text" }, "IMMUTABLE_FIELD"],
  ];
  for (const [operation, body, code] of cases) {
    const [status, result] = await call(operation, body);
    assert.equal(status, 400);
    assert.equal(result.code, code);
  }
  const invalidJson = new Request("http://localhost", { method: "POST", headers: { "x-action-secret": "secret" }, body: "{" });
  const result = await createReminderHandler({ operation: "get_reminder", repository, actionSecret: "secret" })(invalidJson);
  assert.equal((await result.json()).code, "INVALID_JSON");
});

test("repository maps missing and invalid targets, terminal transitions and safe database failures", async () => {
  for (const [code, expected, status] of [
    ["P0002", "REMINDER_NOT_FOUND", 404], ["23503", "TARGET_NOT_FOUND", 404],
    ["22023", "INVALID_TARGET", 400], ["55000", "INVALID_TRANSITION", 409],
    ["23514", "VALIDATION_ERROR", 400], ["unexpected", "DATABASE_ERROR", 500],
  ]) {
    const repo = new SupabaseReminderRepository({ rpc: async () => ({ data: null, error: { code, message: "sensitive SQL detail" } }) });
    const [actualStatus, result] = await call("create_reminder", { target_object_id: targetId, remind_at: at }, repo);
    assert.equal(actualStatus, status);
    assert.equal(result.code, expected);
    assert.doesNotMatch(JSON.stringify(result), /sensitive SQL detail/);
  }
  const repo = new SupabaseReminderRepository({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) });
  const [status, result] = await call("get_reminder", { object_id: objectId }, repo);
  assert.equal(status, 404);
  assert.equal(result.code, "REMINDER_NOT_FOUND");
});

test("repository applies every list filter, total ordering and one-extra-row range", async () => {
  const calls = [];
  const chain = {
    select: () => chain,
    eq: (field, value) => { calls.push(["eq", field, value]); return chain; },
    gte: (field, value) => { calls.push(["gte", field, value]); return chain; },
    lte: (field, value) => { calls.push(["lte", field, value]); return chain; },
    order: (field, options) => { calls.push(["order", field, options]); return chain; },
    range: async (start, end) => { calls.push(["range", start, end]); return { data: [reminder, reminder], error: null }; },
  };
  const repo = new SupabaseReminderRepository({ from: (name) => { calls.push(["from", name]); return chain; } });
  assert.deepEqual(await repo.list({ status: "pending", target_object_id: targetId, due_after: at, due_before: at, limit: 1, offset: 4 }),
    { rows: [reminder], hasMore: true });
  assert.deepEqual(calls, [
    ["from", "assistant_reminders"], ["eq", "status", "pending"], ["eq", "target_object_id", targetId],
    ["gte", "remind_at", at], ["lte", "remind_at", at],
    ["order", "remind_at", { ascending: true }], ["order", "created_at", { ascending: true }],
    ["order", "object_id", { ascending: true }], ["range", 4, 5],
  ]);
});

test("configuration declares each new function and leaves existing declarations", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  for (const name of ["create-reminder", "update-reminder-time", "cancel-reminder", "mark-reminder-delivered", "get-reminder", "list-reminders"]) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt\\s*=\\s*false`));
  }
  for (const name of ["create-task", "create-knowledge"]) assert.match(config, new RegExp(`\\[functions\\.${name}\\]`));
  assert.doesNotMatch(config, /\[functions\.search-reminders\]/);
});
