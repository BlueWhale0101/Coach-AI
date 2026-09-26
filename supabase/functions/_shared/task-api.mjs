export const OPERATIONS = [
  "create_task", "update_task", "complete_task", "cancel_task",
  "get_task", "list_tasks", "search_tasks",
];

const STATUSES = ["open", "completed", "cancelled"];
const PRIORITIES = ["low", "normal", "high"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class TaskApiError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function headers() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}

function fail(code, message, status = 400, details = {}) {
  return response({ ok: false, error: message, code, details }, status);
}

function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TaskApiError("VALIDATION_ERROR", "Request body must be an object");
  }
  return value;
}

function text(value, field, { required = false, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaskApiError(required ? "MISSING_REQUIRED_FIELD" : "VALIDATION_ERROR", `${field} must be a non-empty string`, 400, { field });
  }
  return value.trim();
}

function choice(value, field, allowed, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new TaskApiError("VALIDATION_ERROR", `${field} must be one of: ${allowed.join(", ")}`, 400, { field, allowed });
  }
  return value;
}

function timestamp(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TaskApiError("INVALID_TIMESTAMP", `${field} must be an ISO 8601 timestamp with a timezone`, 400, { field });
  }
  return value;
}

function objectId(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TaskApiError("INVALID_OBJECT_ID", "object_id must be a UUID", 400, { field: "object_id" });
  }
  return value;
}

function windowIsValid(notBefore, dueAt) {
  return !notBefore || !dueAt || Date.parse(notBefore) <= Date.parse(dueAt);
}

function pagination(body) {
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TaskApiError("INVALID_PAGINATION", "limit must be an integer from 1 to 100", 400, { field: "limit", maximum: 100 });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new TaskApiError("INVALID_PAGINATION", "offset must be a non-negative integer", 400, { field: "offset" });
  }
  return { limit, offset };
}

function validateCreate(body) {
  const value = {
    title: text(body.title, "title", { required: true }),
    description: text(body.description, "description", { nullable: true }),
    priority: choice(body.priority, "priority", PRIORITIES, { nullable: true }),
    not_before: timestamp(body.not_before, "not_before", { nullable: true }),
    due_at: timestamp(body.due_at, "due_at", { nullable: true }),
  };
  if (!windowIsValid(value.not_before, value.due_at)) {
    throw new TaskApiError("INVALID_TIME_WINDOW", "not_before must be before or equal to due_at");
  }
  return value;
}

function validateUpdate(body) {
  const id = objectId(body.object_id);
  const allowed = ["title", "description", "priority", "not_before", "due_at"];
  const supplied = allowed.filter((field) => Object.hasOwn(body, field));
  const unsupported = Object.keys(body).filter((field) => field !== "object_id" && !allowed.includes(field));
  if (unsupported.length) {
    throw new TaskApiError("IMMUTABLE_FIELD", "Request contains fields that update_task cannot change", 400, { fields: unsupported });
  }
  if (supplied.length === 0) {
    throw new TaskApiError("MISSING_REQUIRED_FIELD", "At least one mutable task field is required");
  }
  const patch = {};
  if (Object.hasOwn(body, "title")) patch.title = text(body.title, "title", { required: true });
  if (Object.hasOwn(body, "description")) patch.description = text(body.description, "description", { nullable: true });
  if (Object.hasOwn(body, "priority")) patch.priority = choice(body.priority, "priority", PRIORITIES, { nullable: true });
  if (Object.hasOwn(body, "not_before")) patch.not_before = timestamp(body.not_before, "not_before", { nullable: true });
  if (Object.hasOwn(body, "due_at")) patch.due_at = timestamp(body.due_at, "due_at", { nullable: true });
  if (Object.hasOwn(patch, "not_before") && Object.hasOwn(patch, "due_at") && !windowIsValid(patch.not_before, patch.due_at)) {
    throw new TaskApiError("INVALID_TIME_WINDOW", "not_before must be before or equal to due_at");
  }
  return { id, patch };
}

function validateList(body) {
  const page = pagination(body);
  const filters = {
    status: choice(body.status, "status", STATUSES),
    priority: choice(body.priority, "priority", PRIORITIES, { nullable: true }),
    due_from: timestamp(body.due_from, "due_from"),
    due_to: timestamp(body.due_to, "due_to"),
    actionable_at: timestamp(body.actionable_at, "actionable_at"),
  };
  if (!windowIsValid(filters.due_from, filters.due_to)) {
    throw new TaskApiError("INVALID_TIME_WINDOW", "due_from must be before or equal to due_to");
  }
  return { ...page, ...filters };
}

export function createTaskHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!OPERATIONS.includes(operation)) throw new Error(`Unknown Tasks operation: ${operation}`);
  return async (request) => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    if (!actionSecret) return fail("SERVER_CONFIG_ERROR", "Server authentication is not configured", 500);
    if (!databaseConfigured) return fail("SERVER_CONFIG_ERROR", "Server database access is not configured", 500);
    const headerSecret = request.headers.get("x-action-secret")?.trim();
    const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if ((headerSecret || bearer) !== actionSecret) return fail("UNAUTHORIZED", "Unauthorized", 401);

    let body;
    try {
      body = objectBody(await request.json());
    } catch (error) {
      if (error instanceof TaskApiError) return fail(error.code, error.message, error.status, error.details);
      return fail("INVALID_JSON", "Invalid JSON body");
    }

    try {
      let data;
      if (operation === "create_task") data = { task: await repository.create(validateCreate(body)) };
      if (operation === "update_task") {
        const { id, patch } = validateUpdate(body);
        data = { task: await repository.update(id, patch) };
      }
      if (operation === "complete_task") data = { task: await repository.complete(objectId(body.object_id)) };
      if (operation === "cancel_task") data = { task: await repository.cancel(objectId(body.object_id)) };
      if (operation === "get_task") data = { task: await repository.get(objectId(body.object_id)) };
      if (operation === "list_tasks") {
        const options = validateList(body);
        const result = await repository.list(options);
        data = { tasks: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      if (operation === "search_tasks") {
        const query = text(body.query, "query", { required: true });
        const options = { ...validateList(body), query };
        const result = await repository.search(options);
        data = { tasks: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      if (error instanceof TaskApiError) return fail(error.code, error.message, error.status, error.details);
      return fail("DATABASE_ERROR", "The task operation could not be completed", 500);
    }
  };
}
