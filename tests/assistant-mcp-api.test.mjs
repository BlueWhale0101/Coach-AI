import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { callAssistantTool } from "../assistant/mcp/adapters.mjs";
import { AssistantMcpError } from "../assistant/mcp/edge-client.mjs";
import { createAssistantMcpServer, SERVER_INSTRUCTIONS } from "../assistant/mcp/server.mjs";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "../assistant/mcp/tool-definitions.mjs";

const UUIDS = {
  task: "11111111-1111-4111-8111-111111111111",
  event: "22222222-2222-4222-8222-222222222222",
  knowledge: "33333333-3333-4333-8333-333333333333",
  categoryHome: "44444444-4444-4444-8444-444444444444",
  tagMoving: "55555555-5555-4555-8555-555555555555",
  tagHouse: "66666666-6666-4666-8666-666666666666",
  tagOld: "77777777-7777-4777-8777-777777777777",
  recurrence: "88888888-8888-4888-8888-888888888888",
};

function fakeEdge(fixtures = {}) {
  const calls = [];
  const defaults = {
    "list-categories": { categories: [{ object_id: UUIDS.categoryHome, name: "Home", color: "#22CC88", sort_order: 10 }], has_more: false, count: 1, limit: 100, offset: 0 },
    "list-tags": { tags: [{ object_id: UUIDS.tagMoving, name: "moving" }, { object_id: UUIDS.tagHouse, name: "House" }], has_more: false, count: 2, limit: 100, offset: 0 },
    "get-object-classification": { classification: { target_object_id: UUIDS.task, category: null, tags: [] } },
  };
  const responses = { ...defaults, ...fixtures };
  return {
    calls,
    async call(functionName, body = {}) {
      calls.push({ functionName, body });
      const value = responses[functionName];
      if (typeof value === "function") return value(body, calls);
      if (value === undefined) return { ok: true, functionName, body };
      return structuredClone(value);
    },
  };
}

async function withSdkClient(edge, run) {
  const server = createAssistantMcpServer({ edge });
  const client = new Client({ name: "assistant-ai-test-client", version: "0.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("MCP tool vocabulary is bounded and annotated", () => {
  assert.deepEqual(TOOL_NAMES, [
    "find_tasks", "get_task", "create_task", "update_task", "complete_task", "cancel_task",
    "find_knowledge", "get_knowledge", "remember", "update_knowledge", "archive_knowledge",
    "find_events", "get_event", "create_event", "update_event", "cancel_event",
    "set_reminder", "set_recurrence", "update_recurrence", "end_recurrence",
    "set_category", "set_tags", "pin", "unpin", "get_household_board",
  ]);

  const prohibited = [
    "list_due_recurrence_occurrences",
    "next_after_completion",
    "record_recurrence_occurrence",
    "create_registry_object",
    "sql",
  ];
  for (const name of prohibited) assert.equal(TOOL_NAMES.includes(name), false);

  const readOnly = ["find_tasks", "get_task", "find_knowledge", "get_knowledge", "find_events", "get_event", "get_household_board"];
  for (const name of readOnly) {
    const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
    assert.equal(tool.annotations.readOnlyHint, true, name);
  }

  const terminal = ["complete_task", "cancel_task", "archive_knowledge", "cancel_event", "end_recurrence"];
  for (const name of terminal) {
    const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
    assert.equal(tool.annotations.readOnlyHint, false, name);
    assert.equal(tool.annotations.destructiveHint, true, name);
  }
});

test("task tools map to existing semantic capabilities and preserve sparse due dates", async () => {
  const edge = fakeEdge({
    "create-task": { task: { object_id: UUIDS.task, title: "Do the dishes", due_at: null, status: "open" } },
    "search-tasks": { tasks: [{ object_id: UUIDS.task, title: "Call electrician" }], count: 1, has_more: false },
  });

  const create = await callAssistantTool(edge, "create_task", { title: "Do the dishes", due_at: null });
  assert.equal(create.ok, true);
  assert.equal(create.task.due_at, null);
  assert.deepEqual(edge.calls[0], { functionName: "create-task", body: { title: "Do the dishes", due_at: null } });

  const find = await callAssistantTool(edge, "find_tasks", { query: "electrician", status: "open" });
  assert.equal(find.ok, true);
  assert.deepEqual(find.tasks.map((task) => task.object_id), [UUIDS.task]);
  assert.equal(edge.calls[1].functionName, "search-tasks");
});

test("find_events refuses unsupported search plus overlap instead of inventing search behavior", async () => {
  const edge = fakeEdge();
  const result = await callAssistantTool(edge, "find_events", {
    query: "electrician",
    timed_overlap_start: "2026-09-28T00:00:00Z",
    timed_overlap_end: "2026-09-29T00:00:00Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNSUPPORTED_COMBINATION");
  assert.equal(edge.calls.length, 0);
});

test("category name resolution uses existing active category and unknown category does not mutate", async () => {
  const edge = fakeEdge();
  const ok = await callAssistantTool(edge, "set_category", { object_id: UUIDS.task, category_name: "home" });
  assert.equal(ok.ok, true);
  assert.deepEqual(edge.calls.map((call) => call.functionName), ["list-categories", "set-object-category"]);
  assert.deepEqual(edge.calls[1].body, { target_object_id: UUIDS.task, category_object_id: UUIDS.categoryHome });

  const unknownEdge = fakeEdge();
  const unknown = await callAssistantTool(unknownEdge, "set_category", { object_id: UUIDS.task, category_name: "NotReal" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_CATEGORY");
  assert.deepEqual(unknownEdge.calls.map((call) => call.functionName), ["list-categories"]);
});

test("set_tags replaces complete tag set and refuses partial mutation for unknown tags", async () => {
  const edge = fakeEdge();

  const result = await callAssistantTool(edge, "set_tags", { object_id: UUIDS.task, tags: ["house", "moving"] });
  assert.equal(result.ok, true);
  assert.deepEqual(edge.calls.map((call) => call.functionName), [
    "list-tags",
    "replace-object-tags",
  ]);
  assert.deepEqual(edge.calls[1].body, {
    target_object_id: UUIDS.task,
    tag_object_ids: [UUIDS.tagHouse, UUIDS.tagMoving],
  });

  const unknownEdge = fakeEdge();
  const unknown = await callAssistantTool(unknownEdge, "set_tags", { object_id: UUIDS.task, tags: ["moving", "imaginary"] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_TAG");
  assert.deepEqual(unknownEdge.calls.map((call) => call.functionName), ["list-tags"]);
});

test("set_tags delegates rollback of backend failures to the atomic Classification capability", async () => {
  const edge = fakeEdge({
    "replace-object-tags": () => {
      throw new AssistantMcpError("TAG_NOT_FOUND", "tag not found", 404);
    },
  });

  const result = await callAssistantTool(edge, "set_tags", { object_id: UUIDS.task, tags: ["house"] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TAG_NOT_FOUND");
  assert.deepEqual(edge.calls.map((call) => call.functionName), ["list-tags", "replace-object-tags"]);
});

test("MCP SDK server lists and calls tools with structured agent-readable results", async () => {
  const edge = fakeEdge({
    "get-household-board": { board: { metadata: { timezone: "Australia/Darwin" }, tasks: [], days: [] } },
  });

  await withSdkClient(edge, async (client) => {
    assert.equal(client.getServerVersion().name, "assistant-ai-mcp");
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);

    const listed = await client.listTools();
    assert.equal(listed.tools.length, TOOL_NAMES.length);

    const called = await client.callTool({ name: "get_household_board", arguments: { timezone: "Australia/Darwin" } });
    assert.equal(called.structuredContent.ok, true);
    assert.equal(called.content[0].type, "text");
    assert.deepEqual(edge.calls[0], { functionName: "get-household-board", body: { timezone: "Australia/Darwin" } });
  });
});

test("MCP adapter never maps tools to Coach or direct SQL surfaces", async () => {
  const serialized = JSON.stringify(TOOL_DEFINITIONS);
  assert.equal(/coach/i.test(serialized), false);
  assert.equal(/\bsql\b/i.test(serialized), false);

  const edge = fakeEdge();
  await callAssistantTool(edge, "pin", { object_id: UUIDS.task });
  await callAssistantTool(edge, "unpin", { object_id: UUIDS.task });
  await callAssistantTool(edge, "complete_task", { object_id: UUIDS.task });

  for (const call of edge.calls) {
    assert.equal(call.functionName.startsWith("coach"), false);
    assert.equal(call.functionName.includes("sql"), false);
  }
});
