const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class ProjectionApiError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = error => response({ ok: false, error: error.message, code: error.code, details: error.details ?? {} }, error.status);

function only(body, allowed) {
  const fields = Object.keys(body).filter(key => !allowed.includes(key));
  if (fields.length) throw new ProjectionApiError("IMMUTABLE_FIELD", "Request contains unsupported projection fields", 400, { fields });
}

function date(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !ISO_DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ProjectionApiError("INVALID_DATE", `${field} must be an ISO calendar date`, 400, { field });
  }
  return value;
}

function timestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ProjectionApiError("INVALID_TIMESTAMP", `${field} must be an ISO timestamp with timezone`, 400, { field });
  }
  return value;
}

function text(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new ProjectionApiError("VALIDATION_ERROR", `${field} must be a non-empty string`, 400, { field });
  return value.trim();
}

function limit(value) {
  if (value === undefined || value === null) return 15;
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new ProjectionApiError("INVALID_PAGINATION", "task_limit must be an integer from 1 to 50", 400, { field: "task_limit" });
  return value;
}

export function createProjectionHandler({ repository, actionSecret, databaseConfigured = true, operation = "board" }) {
  return async request => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new ProjectionApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new ProjectionApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new ProjectionApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProjectionApiError("VALIDATION_ERROR", "Request body must be an object");
      only(body, operation === "decorations" ? ["object_ids"] : operation === "tagged-tasks"
        ? ["tag_id", "category_id", "status", "query", "limit", "offset"] : operation === "category-list"
        ? ["object_type", "category_id", "status", "query", "limit", "offset"]
        : ["display_date", "timezone", "now", "task_limit"]);
    } catch (error) {
      return fail(error instanceof ProjectionApiError ? error : new ProjectionApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      if (operation === "tagged-tasks") {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof body.tag_id !== "string" || !uuid.test(body.tag_id) ||
          (body.category_id != null && (typeof body.category_id !== "string" || !uuid.test(body.category_id))) ||
          (body.status != null && !["open", "completed", "cancelled"].includes(body.status)) ||
          (body.query != null && typeof body.query !== "string")) {
          throw new ProjectionApiError("VALIDATION_ERROR", "Tagged task filters are invalid");
        }
        const pageLimit = body.limit ?? 80;
        const offset = body.offset ?? 0;
        if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100 || !Number.isInteger(offset) || offset < 0) {
          throw new ProjectionApiError("INVALID_PAGINATION", "limit must be 1-100 and offset must be non-negative");
        }
        const rows = await repository.listTaggedTasks({ tag_id: body.tag_id, category_id: body.category_id ?? null,
          status: body.status ?? null, query: body.query?.trim() || null, limit: pageLimit, offset });
        return response({ ok: true, data: { rows, count: rows.length, limit: pageLimit, offset } });
      }
      if (operation === "decorations") {
        if (!Array.isArray(body.object_ids) || body.object_ids.length > 100 || body.object_ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
          throw new ProjectionApiError("VALIDATION_ERROR", "object_ids must be an array of at most 100 UUIDs");
        }
        const decorations = await repository.getObjectDecorations([...new Set(body.object_ids)]);
        return response({ ok: true, data: { decorations } });
      }
      if (operation === "category-list") {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const type = body.object_type;
        const statuses = type === "task" ? ["open", "completed", "cancelled"] : ["active", "archived"];
        if (!(["task", "knowledge"].includes(type)) || typeof body.category_id !== "string" || !uuid.test(body.category_id)) {
          throw new ProjectionApiError("VALIDATION_ERROR", "object_type and category_id are invalid");
        }
        if (body.status !== undefined && body.status !== null && !statuses.includes(body.status)) {
          throw new ProjectionApiError("VALIDATION_ERROR", "status is invalid for this object type");
        }
        if (body.query !== undefined && body.query !== null && typeof body.query !== "string") throw new ProjectionApiError("VALIDATION_ERROR", "query must be a string");
        const query = body.query === undefined || body.query === null || body.query.trim() === "" ? null : body.query.trim();
        const pageLimit = body.limit ?? 80;
        const offset = body.offset ?? 0;
        if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100 || !Number.isInteger(offset) || offset < 0) {
          throw new ProjectionApiError("INVALID_PAGINATION", "limit must be 1-100 and offset must be non-negative");
        }
        const rows = await repository.listCategoryView({ object_type: type, category_id: body.category_id, status: body.status ?? null, query, limit: pageLimit, offset });
        return response({ ok: true, data: { rows, count: rows.length, limit: pageLimit, offset } });
      }
      const options = {
        display_date: date(body.display_date, "display_date"),
        timezone: text(body.timezone, "timezone", "Australia/Darwin"),
        now: timestamp(body.now, "now"),
        task_limit: limit(body.task_limit),
      };
      const board = operation === "phone-today"
        ? await repository.getPhoneToday(options)
        : await repository.getHouseholdBoard(options);
      return response({ ok: true, data: { board } });
    } catch (error) {
      return fail(error instanceof ProjectionApiError ? error : new ProjectionApiError("DATABASE_ERROR", "The projection could not be loaded", 500));
    }
  };
}
