import test from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeHandler } from "../supabase/functions/_shared/knowledge-api.mjs";
import { SupabaseKnowledgeRepository } from "../supabase/functions/_shared/supabase-knowledge-repository.mjs";

const uuid = "a783830e-4302-4ac8-8269-22c12405e717";
const item = { object_id: uuid, title: "Filters", content: "Top shelf", status: "active" };
const req = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method, headers: { "x-action-secret": secret, "content-type": "application/json" },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
const call = async (operation, body, repository, secret) => {
  const response = await createKnowledgeHandler({ operation, repository, actionSecret: "secret" })(req(body, secret));
  return [response.status, await response.json()];
};

test("authentication and safe error envelopes", async () => {
  const repository = { get: async () => item };
  assert.deepEqual(await call("get_knowledge", { object_id: uuid }, repository, "wrong"),
    [401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED", details: {} }]);
  const [status, body] = await call("get_knowledge", { object_id: "wrong" }, repository);
  assert.equal(status, 400);
  assert.equal(body.code, "INVALID_OBJECT_ID");
  const [brokenStatus, brokenBody] = await call("get_knowledge", { object_id: uuid }, { get: () => { throw new Error("secret internal detail"); } });
  assert.equal(brokenStatus, 500);
  assert.equal(brokenBody.code, "DATABASE_ERROR");
  assert.doesNotMatch(JSON.stringify(brokenBody), /secret internal detail/);
});

test("create, update, archive, and get expose capabilities and validate fields", async () => {
  const seen = [];
  const repository = {
    create: async (value) => { seen.push(["create", value]); return item; },
    update: async (...args) => { seen.push(["update", ...args]); return item; },
    archive: async (value) => { seen.push(["archive", value]); return item; },
    get: async (value) => { seen.push(["get", value]); return item; },
  };
  for (const [operation, input] of [
    ["create_knowledge", { title: " Filters ", content: " Top shelf " }],
    ["update_knowledge", { object_id: uuid, content: "Updated" }],
    ["archive_knowledge", { object_id: uuid }],
    ["get_knowledge", { object_id: uuid }],
  ]) {
    const [status, response] = await call(operation, input, repository);
    assert.equal(status, 200);
    assert.deepEqual(response, { ok: true, data: { knowledge: item } });
  }
  assert.deepEqual(seen, [
    ["create", { title: "Filters", content: "Top shelf" }],
    ["update", uuid, { content: "Updated" }], ["archive", uuid], ["get", uuid],
  ]);
  for (const field of ["status", "archived_at", "created_at", "updated_at", "object_type", "object_id_override"]) {
    const [status, response] = await call("update_knowledge", { object_id: uuid, [field]: "bad" }, repository);
    assert.equal(status, 400);
    assert.equal(response.code, "IMMUTABLE_FIELD");
  }
  for (const [operation, input] of [["create_knowledge", { title: " ", content: "x" }], ["create_knowledge", { title: "x", content: "  " }], ["search_knowledge", { query: " " }]]) {
    assert.equal((await call(operation, input, repository))[0], 400);
  }
});

test("list and search filter status and return a bounded has_more envelope", async () => {
  const repository = {
    list: async (options) => { assert.deepEqual(options, { limit: 1, offset: 2, status: "active" }); return { rows: [item], hasMore: true }; },
    search: async (options) => { assert.deepEqual(options, { limit: 1, offset: 2, status: "archived", query: "filter" }); return { rows: [], hasMore: false }; },
  };
  const [listStatus, list] = await call("list_knowledge", { limit: 1, offset: 2, status: "active" }, repository);
  assert.equal(listStatus, 200);
  assert.deepEqual(list.data, { knowledge: [item], limit: 1, offset: 2, count: 1, has_more: true });
  const [searchStatus, search] = await call("search_knowledge", { limit: 1, offset: 2, status: "archived", query: "filter" }, repository);
  assert.equal(searchStatus, 200);
  assert.deepEqual(search.data, { knowledge: [], limit: 1, offset: 2, count: 0, has_more: false });
  for (const options of [{ limit: 101 }, { offset: -1 }, { status: "unknown" }]) {
    assert.equal((await call("list_knowledge", options, repository))[0], 400);
  }
});

test("repository uses atomic create RPC, bounded deterministic queries, and maps missing rows", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => { calls.push([name, args]); return { data: [item], error: null }; },
    from: (table) => {
      calls.push(["from", table]);
      const chain = {
        select: () => chain, eq: () => chain, order: (name, options) => { calls.push(["order", name, options]); return chain; },
        range: (start, end) => { calls.push(["range", start, end]); return Promise.resolve({ data: [item, item], error: null }); },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
  };
  const repository = new SupabaseKnowledgeRepository(client);
  await repository.create({ title: "Filters", content: "Top shelf" });
  assert.equal(calls[0][0], "assistant_create_knowledge");
  assert.deepEqual(await repository.list({ limit: 1, offset: 3, status: "active" }), { rows: [item], hasMore: true });
  assert.ok(calls.some(([name, field, order]) => name === "order" && field === "created_at" && order.ascending === false));
  assert.ok(calls.some(([name, start, end]) => name === "range" && start === 3 && end === 4));
  await repository.search({ query: "filters", limit: 1, offset: 2 });
  assert.deepEqual(calls.at(-1), ["assistant_search_knowledge", { p_query: "filters", p_status: null, p_limit: 2, p_offset: 2 }]);
  await assert.rejects(() => repository.get(uuid), (error) => error.code === "KNOWLEDGE_NOT_FOUND");
});
