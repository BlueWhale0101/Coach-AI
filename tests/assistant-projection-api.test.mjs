import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProjectionHandler, ProjectionApiError } from "../supabase/functions/_shared/projection-api.mjs";
import { SupabaseProjectionRepository } from "../supabase/functions/_shared/supabase-projection-repository.mjs";

const board = { metadata: { timezone: "Australia/Darwin" }, tasks: [], days: [] };
const repository = {
  calls: [],
  async getHouseholdBoard(options) {
    this.calls.push(options);
    return board;
  },
};

const request = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method,
  headers: { "content-type": "application/json", "x-action-secret": secret },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});

async function call(body, repo = repository, secret = "secret") {
  const result = await createProjectionHandler({ repository: repo, actionSecret: "secret" })(request(body, secret));
  return [result.status, await result.json()];
}

test("get-household-board uses stable envelopes and validates bounded inputs", async () => {
  const [status, body] = await call({ display_date: "2026-09-27", timezone: "Australia/Darwin", now: "2026-09-27T07:30:00+09:30", task_limit: 12 });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, data: { board } });
  assert.deepEqual(repository.calls.at(-1), {
    display_date: "2026-09-27",
    timezone: "Australia/Darwin",
    now: "2026-09-27T07:30:00+09:30",
    task_limit: 12,
  });

  for (const [input, code] of [
    [{ display_date: "2026-02-30" }, "INVALID_DATE"],
    [{ now: "2026-09-27T07:30:00" }, "INVALID_TIMESTAMP"],
    [{ timezone: " " }, "VALIDATION_ERROR"],
    [{ task_limit: 51 }, "INVALID_PAGINATION"],
    [{ extra: true }, "IMMUTABLE_FIELD"],
  ]) {
    const [badStatus, badBody] = await call(input);
    assert.equal(badStatus, 400);
    assert.equal(badBody.code, code);
  }
});

test("projection authentication, method handling, repository errors, and config registration", async () => {
  assert.equal((await call({}, repository, "wrong"))[0], 401);
  const handler = createProjectionHandler({ repository, actionSecret: "secret" });
  assert.equal((await handler(request({}, "secret", "OPTIONS"))).status, 200);
  assert.equal((await handler(request({}, "secret", "GET"))).status, 405);
  const invalid = await handler(new Request("http://localhost", { method: "POST", headers: { "x-action-secret": "secret" }, body: "{" }));
  assert.equal((await invalid.json()).code, "INVALID_JSON");

  const failing = { getHouseholdBoard: async () => { throw new ProjectionApiError("INVALID_TIMEZONE", "timezone must be valid"); } };
  const [status, body] = await call({}, failing);
  assert.equal(status, 400);
  assert.equal(body.code, "INVALID_TIMEZONE");

  const repo = new SupabaseProjectionRepository({ rpc: async (name, args) => ({ data: board, error: null, name, args }) });
  assert.deepEqual(await repo.getHouseholdBoard({ display_date: null, timezone: "Australia/Darwin", now: null, task_limit: 15 }), board);

  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.get-household-board\]\s*verify_jwt\s*=\s*false/);
});

test("decoration projection validates and deduplicates bounded object IDs", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const repo = { getObjectDecorations: async ids => ({ [ids[0]]: { pinned: true } }) };
  const handler = createProjectionHandler({ repository: repo, actionSecret: "secret", operation: "decorations" });
  const result = await handler(request({ object_ids: [id, id] }));
  assert.deepEqual((await result.json()).data.decorations, { [id]: { pinned: true } });
  const bad = await handler(request({ object_ids: ["not-an-id"] }));
  assert.equal((await bad.json()).code, "VALIDATION_ERROR");
  assert.equal((await handler(request({ object_ids: [id], other: 1 }))).status, 400);
});

test("category projection validates filters before delegating the bounded page", async () => {
  const category = "10000000-0000-4000-8000-000000000001";
  let received;
  const repo = { listCategoryView: async options => { received = options; return [{ object_id: "row" }]; } };
  const handler = createProjectionHandler({ repository: repo, actionSecret: "secret", operation: "category-list" });
  const result = await handler(request({ object_type: "task", category_id: category, status: "open", query: "  call ", limit: 20, offset: 5 }));
  assert.deepEqual(received, { object_type: "task", category_id: category, status: "open", query: "call", limit: 20, offset: 5 });
  assert.deepEqual((await result.json()).data.rows, [{ object_id: "row" }]);
  for (const body of [
    { object_type: "task", category_id: "bad" },
    { object_type: "task", category_id: category, status: "active" },
    { object_type: "knowledge", category_id: category, limit: 101 },
  ]) assert.equal((await handler(request(body))).status, 400);
});

test("projection repository sends bounded category view filters to the read RPC", async () => {
  let call;
  const repo = new SupabaseProjectionRepository({ rpc: async (...args) => { call = args; return { data: [], error: null }; } });
  await repo.listCategoryView({ object_type: "knowledge", category_id: "cat", status: "active", query: "word", limit: 80, offset: 0 });
  assert.deepEqual(call, ["assistant_list_category_view", {
    p_object_type: "knowledge", p_category_object_id: "cat", p_status: "active",
    p_query: "word", p_limit: 80, p_offset: 0,
  }]);
});

test("tagged task projection validates combined filters and calls one bounded read RPC", async () => {
  const tag = "10000000-0000-4000-8000-000000000001";
  const category = "10000000-0000-4000-8000-000000000002";
  const calls = [];
  const repo = new SupabaseProjectionRepository({ rpc: async (...args) => { calls.push(args); return { data: [{ object_id: "task" }], error: null }; } });
  const handler = createProjectionHandler({ repository: repo, actionSecret: "secret", operation: "tagged-tasks" });
  const response = await handler(request({ tag_id: tag, category_id: category, status: "open", query: " food ", limit: 1, offset: 3 }));
  assert.deepEqual((await response.json()).data.rows, [{ object_id: "task" }]);
  assert.deepEqual(calls, [["assistant_list_tagged_tasks", {
    p_tag_object_id: tag, p_category_object_id: category, p_status: "open", p_query: "food", p_limit: 1, p_offset: 3,
  }]]);
  for (const body of [{ tag_id: "bad" }, { tag_id: tag, category_id: "bad" }, { tag_id: tag, status: "active" },
    { tag_id: tag, query: 1 }, { tag_id: tag, limit: 101 }, { tag_id: tag, unexpected: true }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal((await handler(request({ tag_id: tag }, "wrong"))).status, 401);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.get-tagged-tasks\]\s*verify_jwt\s*=\s*false/);
});

test("phone Today projection validates its bounded inputs and calls only its read RPC", async () => {
  let options;
  const repo = { getPhoneToday: async value => { options = value; return board; } };
  const handler = createProjectionHandler({ repository: repo, actionSecret: "secret", operation: "phone-today" });
  const response = await handler(request({ display_date: "2026-09-27", timezone: "Australia/Darwin", task_limit: 30 }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.board, board);
  assert.equal(options.display_date, "2026-09-27");
  assert.equal((await handler(request({ task_limit: 51 }))).status, 400);
  assert.equal((await handler(request({ object_ids: [] }))).status, 400);
  const calls = [];
  const projectionRepo = new SupabaseProjectionRepository({ rpc: async (...args) => { calls.push(args); return { data: board, error: null }; } });
  await projectionRepo.getPhoneToday({ display_date: null, timezone: "Australia/Darwin", now: null, task_limit: 30 });
  assert.deepEqual(calls[0], ["assistant_get_phone_today", { p_display_date: null, p_timezone: "Australia/Darwin", p_now: null, p_task_limit: 30 }]);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.get-phone-today\]\s*verify_jwt\s*=\s*false/);
});
