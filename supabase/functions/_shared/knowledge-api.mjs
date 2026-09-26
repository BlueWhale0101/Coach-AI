export const OPERATIONS = ["create_knowledge", "update_knowledge", "archive_knowledge", "get_knowledge", "list_knowledge", "search_knowledge"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "archived"];

export class KnowledgeApiError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = (error) => response({ ok: false, error: error.message, code: error.code, details: error.details ?? {} }, error.status);

function nonblank(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new KnowledgeApiError(value === undefined ? "MISSING_REQUIRED_FIELD" : "VALIDATION_ERROR", `${field} must be a non-empty string`, 400, { field });
  }
  return value.trim();
}

function id(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new KnowledgeApiError("INVALID_OBJECT_ID", "object_id must be a UUID", 400, { field: "object_id" });
  return value;
}

function status(value) {
  if (value === undefined) return undefined;
  if (!STATUSES.includes(value)) throw new KnowledgeApiError("VALIDATION_ERROR", "status must be active or archived", 400, { field: "status" });
  return value;
}

function page(body) {
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new KnowledgeApiError("INVALID_PAGINATION", "limit must be an integer from 1 to 100", 400, { field: "limit", maximum: 100 });
  if (!Number.isInteger(offset) || offset < 0) throw new KnowledgeApiError("INVALID_PAGINATION", "offset must be a non-negative integer", 400, { field: "offset" });
  return { limit, offset, status: status(body.status) };
}

function update(body) {
  const objectId = id(body.object_id);
  const fields = Object.keys(body).filter((key) => key !== "object_id" && !["title", "content"].includes(key));
  if (fields.length) throw new KnowledgeApiError("IMMUTABLE_FIELD", "Request contains fields that update_knowledge cannot change", 400, { fields });
  const patch = {};
  if (Object.hasOwn(body, "title")) patch.title = nonblank(body.title, "title");
  if (Object.hasOwn(body, "content")) patch.content = nonblank(body.content, "content");
  if (!Object.keys(patch).length) throw new KnowledgeApiError("MISSING_REQUIRED_FIELD", "At least one mutable knowledge field is required");
  return { objectId, patch };
}

export function createKnowledgeHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!OPERATIONS.includes(operation)) throw new Error(`Unknown Knowledge operation: ${operation}`);
  return async (request) => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new KnowledgeApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new KnowledgeApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new KnowledgeApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new KnowledgeApiError("VALIDATION_ERROR", "Request body must be an object");
    } catch (error) {
      return fail(error instanceof KnowledgeApiError ? error : new KnowledgeApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      let data;
      if (operation === "create_knowledge") data = { knowledge: await repository.create({ title: nonblank(body.title, "title"), content: nonblank(body.content, "content") }) };
      if (operation === "update_knowledge") {
        const { objectId, patch } = update(body);
        data = { knowledge: await repository.update(objectId, patch) };
      }
      if (operation === "archive_knowledge") data = { knowledge: await repository.archive(id(body.object_id)) };
      if (operation === "get_knowledge") data = { knowledge: await repository.get(id(body.object_id)) };
      if (operation === "list_knowledge" || operation === "search_knowledge") {
        const options = page(body);
        if (operation === "search_knowledge") options.query = nonblank(body.query, "query");
        const result = operation === "list_knowledge" ? await repository.list(options) : await repository.search(options);
        data = { knowledge: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      return fail(error instanceof KnowledgeApiError ? error : new KnowledgeApiError("DATABASE_ERROR", "The knowledge operation could not be completed", 500));
    }
  };
}
