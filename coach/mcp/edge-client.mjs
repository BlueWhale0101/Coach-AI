const FUNCTIONS = new Set(["add-log-entry", "get-logs", "search-events", "update-event", "get-day-summary", "get-trends"]);

export class CoachMcpError extends Error {
  constructor(code, message, uncertain = false) {
    super(message);
    this.code = code;
    this.uncertain = uncertain;
  }
}

export function createCoachEdgeClient({
  functionsUrl = process.env.COACH_MCP_FUNCTIONS_URL,
  actionSecret = process.env.COACH_ACTION_API_SECRET,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000,
} = {}) {
  if (!functionsUrl || !actionSecret || !fetchImpl) throw new CoachMcpError("SERVER_CONFIG_ERROR", "Coach API configuration is missing");
  const url = new URL(functionsUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new CoachMcpError("SERVER_CONFIG_ERROR", "Coach functions URL must use HTTPS without credentials or query parameters");
  }
  const base = functionsUrl.replace(/\/+$/, "");
  return {
    async call(functionName, body) {
      if (!FUNCTIONS.has(functionName)) throw new CoachMcpError("UNKNOWN_CAPABILITY", "Unknown Coach capability");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base}/${functionName}`, {
          method: "POST", redirect: "error",
          headers: { "Content-Type": "application/json", "X-Action-Secret": actionSecret },
          body: JSON.stringify(body), signal: controller.signal,
        });
        let envelope;
        try { envelope = await response.json(); }
        catch { throw new CoachMcpError("BAD_BACKEND_RESPONSE", "Coach API returned an unreadable response; check stored records before retrying", true); }
        if (!response.ok || envelope?.ok !== true) {
          const code = typeof envelope?.code === "string" && /^[A-Z_]{1,80}$/.test(envelope.code) ? envelope.code : "COACH_CAPABILITY_ERROR";
          // Backend details may contain internal database messages or credentials.
          throw new CoachMcpError(code, "Coach API rejected the request", response.status >= 500);
        }
        if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
          throw new CoachMcpError("BAD_BACKEND_RESPONSE", "Coach API returned an invalid response; check stored records before retrying", true);
        }
        return envelope.data;
      } catch (error) {
        if (error instanceof CoachMcpError) throw error;
        throw new CoachMcpError("COACH_CONNECTION_ERROR", "Coach API could not be reached; check stored records before retrying a write", true);
      } finally { clearTimeout(timeout); }
    },
  };
}
