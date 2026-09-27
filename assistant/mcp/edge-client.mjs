const DEFAULT_TIMEOUT_MS = 15_000;

export class AssistantMcpError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function safeError(error) {
  if (error instanceof AssistantMcpError) return error;
  return new AssistantMcpError("MCP_ADAPTER_ERROR", "Assistant.AI could not complete the requested operation", 500);
}

export function createEdgeFunctionClient({
  functionsUrl = process.env.ASSISTANT_MCP_FUNCTIONS_URL || process.env.ASSISTANT_SUPABASE_FUNCTIONS_URL,
  actionSecret = process.env.ASSISTANT_ACTION_API_SECRET,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!fetchImpl) throw new AssistantMcpError("SERVER_CONFIG_ERROR", "fetch is not available", 500);
  if (!functionsUrl) throw new AssistantMcpError("SERVER_CONFIG_ERROR", "Assistant functions URL is not configured", 500);
  if (!actionSecret) throw new AssistantMcpError("SERVER_CONFIG_ERROR", "Assistant action secret is not configured", 500);

  const baseUrl = trimSlash(functionsUrl);

  return {
    async call(functionName, body = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/${functionName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Action-Secret": actionSecret,
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        });
      } catch (error) {
        throw safeError(error);
      } finally {
        clearTimeout(timeout);
      }

      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new AssistantMcpError("BAD_BACKEND_RESPONSE", "Assistant capability returned an unreadable response", 502);
      }

      if (!response.ok || envelope?.ok !== true) {
        throw new AssistantMcpError(
          envelope?.code || "ASSISTANT_CAPABILITY_ERROR",
          envelope?.error || "Assistant capability rejected the request",
          response.status || 500,
          envelope?.details || {},
        );
      }

      return envelope.data ?? {};
    },
  };
}

export function normalizeToolError(error) {
  const safe = safeError(error);
  return {
    ok: false,
    code: safe.code,
    error: safe.message,
    details: safe.details ?? {},
  };
}
