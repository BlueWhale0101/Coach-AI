export const ATTENTION_OPERATIONS = ["pin_object", "unpin_object", "is_object_pinned", "list_pinned_objects"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export class AttentionApiError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); Object.assign(this, { code, status, details }); }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = error => response({ ok: false, error: error.message, code: error.code, details: error.details ?? {} }, error.status);
function id(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AttentionApiError("INVALID_OBJECT_ID", "target_object_id must be a UUID", 400, { field: "target_object_id" });
  return value;
}
function only(body, allowed) {
  const fields = Object.keys(body).filter(key => !allowed.includes(key));
  if (fields.length) throw new AttentionApiError("IMMUTABLE_FIELD", "Request contains unsupported attention fields", 400, { fields });
}
function page(body) {
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new AttentionApiError("INVALID_PAGINATION", "limit/offset must be bounded integers", 400);
  }
  return { limit, offset };
}
export function createAttentionHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!ATTENTION_OPERATIONS.includes(operation)) throw new Error(`Unknown Attention operation: ${operation}`);
  return async request => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new AttentionApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new AttentionApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new AttentionApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new AttentionApiError("VALIDATION_ERROR", "Request body must be an object");
    } catch (error) {
      return fail(error instanceof AttentionApiError ? error : new AttentionApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      let data;
      if (operation === "pin_object") { only(body, ["target_object_id"]); data = { pin: await repository.pin(id(body.target_object_id)) }; }
      if (operation === "unpin_object") { only(body, ["target_object_id"]); data = { pin: await repository.unpin(id(body.target_object_id)) }; }
      if (operation === "is_object_pinned") { only(body, ["target_object_id"]); data = { pin: await repository.isPinned(id(body.target_object_id)) }; }
      if (operation === "list_pinned_objects") {
        only(body, ["limit", "offset"]); const options = page(body);
        const result = await repository.list(options);
        data = { pins: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      return fail(error instanceof AttentionApiError ? error : new AttentionApiError("DATABASE_ERROR", "The attention operation could not be completed", 500));
    }
  };
}
