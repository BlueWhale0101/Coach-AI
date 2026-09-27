import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createEdgeFunctionClient } from "./edge-client.mjs";
import { callAssistantTool } from "./adapters.mjs";
import { TOOL_DEFINITIONS } from "./tool-definitions.mjs";

export const SERVER_INFO = { name: "assistant-ai-mcp", version: "0.1.0" };
export const MCP_HTTP_HOST = "127.0.0.1";
export const SERVER_INSTRUCTIONS =
  "Assistant.AI tools present household state capabilities. Search before mutating when object identity is unknown. Writes require stable object_id values. Do not invent due dates for reminders or board surfacing.";

function textFor(result) {
  if (result.ok === false) return `${result.code}: ${result.error}`;
  return result.summary || "Assistant.AI operation completed";
}

function hasType(schema, type) {
  return Array.isArray(schema?.type) ? schema.type.includes(type) : schema?.type === type;
}

function zodForProperty(schema) {
  let value;
  if (hasType(schema, "array")) {
    value = z.array(zodForProperty(schema.items || {}));
  } else if (hasType(schema, "integer")) {
    value = z.number().int();
    if (Number.isFinite(schema.minimum)) value = value.min(schema.minimum);
    if (Number.isFinite(schema.maximum)) value = value.max(schema.maximum);
  } else if (hasType(schema, "number")) {
    value = z.number();
  } else if (hasType(schema, "boolean")) {
    value = z.boolean();
  } else {
    value = z.string();
  }

  if (schema?.description) value = value.describe(schema.description);
  if (hasType(schema, "null")) value = value.nullable();
  return value;
}

function inputShape(jsonSchema) {
  const required = new Set(jsonSchema.required || []);
  return Object.fromEntries(Object.entries(jsonSchema.properties || {}).map(([name, schema]) => {
    const value = zodForProperty(schema);
    return [name, required.has(name) ? value : value.optional()];
  }));
}

export function createAssistantMcpServer({ edge = createEdgeFunctionClient() } = {}) {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: inputShape(tool.inputSchema),
      annotations: tool.annotations,
    }, async (args) => {
      const result = await callAssistantTool(edge, tool.name, args);
      return {
        structuredContent: result,
        content: [{ type: "text", text: textFor(result) }],
        isError: result.ok === false,
      };
    });
  }
  return server;
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

    if (!request.url?.startsWith("/mcp")) {
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

    const server = createAssistantMcpServer({ edge });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("finish", async () => {
      await server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "Invalid MCP request" }));
      }
    }
  });
}

export function startAssistantMcpHttpServer({
  edge = createEdgeFunctionClient(),
  port = Number(process.env.PORT || 8787),
  log = console.error,
} = {}) {
  const server = createAssistantMcpHttpServer({ edge });
  server.listen(port, MCP_HTTP_HOST, () => {
    log(`Assistant.AI MCP server listening on http://${MCP_HTTP_HOST}:${port}/mcp`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAssistantMcpHttpServer();
}