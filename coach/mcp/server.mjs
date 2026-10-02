import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCoachEdgeClient, CoachMcpError } from "./edge-client.mjs";
import { TOOL_DEFINITIONS } from "./tool-definitions.mjs";

export const SERVER_INFO = { name: "coach-ai-mcp", version: "0.1.0" };
export const MCP_HTTP_HOST = "127.0.0.1";
export const SERVER_INSTRUCTIONS = "Coach.AI: coach first, log quietly. Preserve raw user wording. Separate facts and estimates; planning is not completion. Use Australia/Darwin local dates unless the user specifies another timezone. Resolve event IDs before corrections. Database records are canonical. Do not blindly retry uncertain writes.";

export function createCoachMcpServer({ edge = createCoachEdgeClient() } = {}) {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(tool.name, {
      description: tool.description, inputSchema: tool.schema, annotations: tool.annotations,
    }, async args => {
      try {
        const data = await edge.call(tool.functionName, args);
        const result = { ok: true, data };
        return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const known = error instanceof CoachMcpError;
        const result = {
          ok: false, code: known ? error.code : "COACH_TOOL_ERROR",
          error: known ? error.message : "Coach operation failed; check records before retrying a write",
          ...(tool.annotations.readOnlyHint ? {} : { write_outcome: known && !error.uncertain ? "rejected" : "unknown" }),
        };
        return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    });
  }
  return server;
}

function matchesToken(actual, expected) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCoachMcpHttpServer({ edge = createCoachEdgeClient(), bearerToken = process.env.COACH_MCP_BEARER_TOKEN } = {}) {
  return createServer(async (request, response) => {
    const fail = (status, error) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error }));
    };
    // This service is for server-to-server tunnel traffic, not browser calls.
    if (request.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host || "")) return fail(403, "Forbidden");
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, server: SERVER_INFO }));
      return;
    }
    if (request.url !== "/mcp") return fail(404, "Not found");
    if (bearerToken && !matchesToken(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""), bearerToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return fail(401, "Unauthorized");
    }
    const server = createCoachMcpServer({ edge });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch { if (!response.headersSent) fail(400, "Invalid MCP request"); }
  });
}

export function startCoachMcpHttpServer({ edge = createCoachEdgeClient(), port = Number(process.env.COACH_MCP_PORT || 8788), log = console.error } = {}) {
  const server = createCoachMcpHttpServer({ edge });
  server.listen(port, MCP_HTTP_HOST, () => log(`Coach.AI MCP listening on http://${MCP_HTTP_HOST}:${server.address().port}/mcp`));
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) startCoachMcpHttpServer();
