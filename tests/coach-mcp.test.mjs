import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "../coach/mcp/tool-definitions.mjs";
import { createCoachEdgeClient, CoachMcpError } from "../coach/mcp/edge-client.mjs";
import { createCoachMcpServer, createCoachMcpHttpServer, MCP_HTTP_HOST } from "../coach/mcp/server.mjs";

async function withClient(edge, run) {
  const server = createCoachMcpServer({ edge });
  const client = new Client({ name: "coach-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try { await run(client); }
  finally { await client.close(); await server.close(); }
}
const log = {
  occurred_date: "2026-10-03", raw_text: "198.4 today. Brekky: eggs\n& mushrooms!", source: "gpt_action",
  events: [{ event_type: "meal", description: "Breakfast", facts: { foods: ["eggs", "mushrooms"], attachment: { servings: 2 } }, estimates: { calories_low: 200, calories_high: 400 }, interpretations: {} }],
};

test("discovers six tools with honest derived-write annotations and nested schemas", async () => {
  await withClient({ call: async () => ({}) }, async client => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), TOOL_NAMES);
    assert.equal(tools.length, 6);
    for (const name of ["get_day_summary", "get_trends", "add_log_entry", "update_event"]) assert.equal(tools.find(t => t.name === name).annotations.readOnlyHint, false);
    assert.equal(tools.find(t => t.name === "get_logs").annotations.readOnlyHint, true);
    assert.equal(tools.find(t => t.name === "add_log_entry").annotations.idempotentHint, false);
    assert.equal(tools.find(t => t.name === "add_log_entry").inputSchema.properties.events.items.type, "object");
  });
});

test("logs exact raw wording and nested JSON; returns IDs and pagination data", async () => {
  const calls = [];
  await withClient({ call: async (name, args) => { calls.push({ name, args }); return { log_entry_id: "saved-id", event_ids: ["event-id"], has_more: true, count: 1, offset: 100 }; } }, async client => {
    const result = await client.callTool({ name: "add_log_entry", arguments: log });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls[0], { name: "add-log-entry", args: { ...log, events: [{ ...log.events[0], needs_review: false }] } });
    assert.equal(result.structuredContent.data.log_entry_id, "saved-id");
    assert.equal(result.structuredContent.data.has_more, true);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });
});

test("invalid input and forbidden correction fields never reach the backend", async () => {
  const calls = [];
  await withClient({ call: async (...args) => { calls.push(args); return {}; } }, async client => {
    const cases = [
      ["add_log_entry", { ...log, events: [{ ...log.events[0], event_type: "task" }] }],
      ["add_log_entry", { ...log, events: [{ ...log.events[0], extraction_confidence: 1.5 }] }],
      ["get_logs", { start_date: "bad-date", end_date: "2026-10-03" }],
      ["get_logs", { start_date: "2026-10-03", end_date: "2026-10-03", limit: 501 }],
      ["update_event", { event_id: "11111111-1111-4111-8111-111111111111", changes: { raw_text: "rewritten" } }],
    ];
    for (const [name, args] of cases) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
    assert.equal(calls.length, 0);
  });
});

test("corrections, recall, summaries and trends map only to existing Coach functions", async () => {
  const calls = [];
  await withClient({ call: async (name, args) => { calls.push({ name, args }); return { has_more: false }; } }, async client => {
    for (const [name, args] of [
      ["update_event", { event_id: "11111111-1111-4111-8111-111111111111", changes: { facts: { weight_value: 196.8 }, estimate_confidence: null } }],
      ["get_logs", { start_date: "2026-10-03", end_date: "2026-10-03", offset: 100 }],
      ["search_events", { query: "low energy", needs_review: false }],
      ["get_day_summary", { date: "2026-10-03", generate_if_missing: false }],
      ["get_trends", { metric: "protein", start_date: "2026-10-01", end_date: "2026-10-03", bucket: "week" }],
    ]) assert.notEqual((await client.callTool({ name, arguments: args })).isError, true);
    assert.deepEqual(calls.map(c => c.name), ["update-event", "get-logs", "search-events", "get-day-summary", "get-trends"]);
    assert.deepEqual(calls[0].args.changes, { facts: { weight_value: 196.8 }, estimate_confidence: null });
    assert.equal(calls[3].args.generate_if_missing, false);
    assert.equal(calls[1].args.offset, 100);
  });
});

test("edge client restricts functions, sends server-side secret, and never retries", async () => {
  const calls = [];
  const edge = createCoachEdgeClient({ functionsUrl: "https://example.test/functions/v1/", actionSecret: "test-secret", fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ ok: true, data: { log_entry_id: "id" } }));
  } });
  await edge.call("add-log-entry", log);
  assert.equal(calls[0].url, "https://example.test/functions/v1/add-log-entry");
  assert.equal(calls[0].options.headers["X-Action-Secret"], "test-secret");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.parse(calls[0].options.body).raw_text, log.raw_text);
  await assert.rejects(edge.call("create-task", {}), /Unknown Coach capability/);
  assert.equal(calls.length, 1);
});

test("errors are agent-readable, secret-free and mark uncertain writes", async () => {
  for (const [edgeError, code, outcome] of [
    [new Error("secret from internal exception"), "COACH_TOOL_ERROR", "unknown"],
    [new CoachMcpError("VALIDATION_ERROR", "Coach API rejected the request"), "VALIDATION_ERROR", "rejected"],
    [new CoachMcpError("COACH_CONNECTION_ERROR", "Check stored records before retrying", true), "COACH_CONNECTION_ERROR", "unknown"],
  ]) await withClient({ call: async () => { throw edgeError; } }, async client => {
    const result = await client.callTool({ name: "add_log_entry", arguments: log });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, code);
    assert.equal(result.structuredContent.write_outcome, outcome);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
  const edge = createCoachEdgeClient({ functionsUrl: "https://example.test", actionSecret: "secret", fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: "DATABASE_ERROR", error: "secret", details: { secret: "secret" } }), { status: 500 }) });
  await assert.rejects(edge.call("add-log-entry", log), e => e.code === "DATABASE_ERROR" && e.uncertain && !e.message.includes("secret"));
});

test("timeout covers response parsing and makes one attempt", async () => {
  let attempts = 0;
  const edge = createCoachEdgeClient({ functionsUrl: "https://example.test", actionSecret: "secret", timeoutMs: 5, fetchImpl: async (_url, options) => {
    attempts++;
    return { ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("secret")))) };
  } });
  await assert.rejects(edge.call("add-log-entry", log), e => e.uncertain && !e.message.includes("secret"));
  assert.equal(attempts, 1);
});

test("real HTTP MCP connection binds localhost and enforces path, origin, host and optional bearer", async () => {
  const server = createCoachMcpHttpServer({ edge: { call: async () => ({ logs: [], has_more: false }) }, bearerToken: "test-token" });
  await new Promise(resolve => server.listen(0, MCP_HTTP_HOST, resolve));
  const url = `http://${MCP_HTTP_HOST}:${server.address().port}`;
  const client = new Client({ name: "http-test", version: "1.0.0" });
  try {
    assert.equal(server.address().address, "127.0.0.1");
    assert.equal((await fetch(`${url}/mcp-extra`)).status, 404);
    assert.equal((await fetch(`${url}/mcp`)).status, 401);
    assert.equal((await fetch(`${url}/health`, { headers: { Origin: "https://evil.test" } })).status, 403);
    const badHostStatus = await new Promise(resolve => {
      const req = request(`${url}/health`, { headers: { Host: "evil.test" } }, res => { res.resume(); resolve(res.statusCode); });
      req.end();
    });
    assert.equal(badHostStatus, 403);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: "Bearer test-token" } } }));
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: "get_logs", arguments: { start_date: "2026-10-03", end_date: "2026-10-03" } });
    assert.equal(result.structuredContent.ok, true);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});
