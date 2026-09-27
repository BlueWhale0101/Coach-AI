import { createServer } from "node:http";
import { createEdgeFunctionClient } from "./edge-client.mjs";
import { callAssistantTool } from "./adapters.mjs";
import { TOOL_DEFINITIONS } from "./tool-definitions.mjs";

export const SERVER_INFO = { name: "assistant-ai-mcp", version: "0.1.0" };
export const SERVER_INSTRUCTIONS =
  "Assistant.AI tools present household state capabilities. Search before mutating when object identity is unknown. Writes require stable object_id values. Do not invent due dates for reminders or board surfacing.";

function jsonResponse(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonError(id, code, message, data = {}) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

function textFor(result) {
  if (result.ok === false) return `${result.code}: ${result.error}`;
  return result.summary || "Assistant.AI operation completed";
}

export async function handleMcpJsonRpc(message, { edge } = {}) {
  const request = Array.isArray(message) ? message : [message];
  const responses = [];
  for (const item of request) {
    if (!item || item.jsonrpc !== "2.0" || typeof item.method !== "string") {
      responses.push(jsonError(item?.id, -32600, "Invalid JSON-RPC request"));
      continue;
    }

    if (item.method === "initialize") {
      responses.push(jsonResponse(item.id, {
        protocolVersion: item.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      }));
      continue;
    }

    if (item.method === "tools/list") {
      responses.push(jsonResponse(item.id, { tools: TOOL_DEFINITIONS }));
      continue;
    }

    if (item.method === "tools/call") {
      const name = item.params?.name;
      const args = item.params?.arguments ?? {};
      const result = await callAssistantTool(edge, name, args);
      responses.push(jsonResponse(item.id, {
        structuredContent: result,
        content: [{ type: "text", text: textFor(result) }],
        isError: result.ok === false,
      }));
      continue;
    }

    if (item.method === "notifications/initialized") continue;
    responses.push(jsonError(item.id, -32601, `Unsupported MCP method: ${item.method}`));
  }

  if (Array.isArray(message)) return responses;
  return responses[0] ?? null;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function createAssistantMcpHttpServer({
  edge = createEdgeFunctionClient(),
  bearerToken = process.env.ASSISTANT_MCP_BEARER_TOKEN,
} = {}) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, server: SERVER_INFO }));
      return;
    }

    if (request.method !== "POST" || !request.url?.startsWith("/mcp")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    if (bearerToken) {
      const supplied = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
      if (supplied !== bearerToken) {
        response.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        });
        response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
    }

    try {
      const body = JSON.parse(await readBody(request));
      const result = await handleMcpJsonRpc(body, { edge });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify(jsonError(null, -32700, "Invalid JSON or MCP request")));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createAssistantMcpHttpServer().listen(port, () => {
    console.error(`Assistant.AI MCP server listening on http://127.0.0.1:${port}/mcp`);
  });
}
