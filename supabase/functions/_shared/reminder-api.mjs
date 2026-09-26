export const OPERATIONS = ["create_reminder", "update_reminder_time", "cancel_reminder", "mark_reminder_delivered", "get_reminder", "list_reminders"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const STATUSES = ["pending", "delivered", "cancelled"];

export class ReminderApiError extends Error {
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

function id(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ReminderApiError("INVALID_OBJECT_ID", `${field} must be a UUID`, 400, { field });
  }
  return value;
}

function timestamp(value, field) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ReminderApiError("INVALID_TIMESTAMP", `${field} must be an ISO 8601 timestamp with a timezone`, 400, { field });
  }
  return value;
}

function onlyFields(body, allowed) {
  const unsupported = Object.keys(body).filter((field) => !allowed.includes(field));
  if (unsupported.length) throw new ReminderApiError("IMMUTABLE_FIELD", "Request contains unsupported reminder fields", 400, { fields: unsupported });
}

function listOptions(body) {
  onlyFields(body, ["status", "target_object_id", "due_after", "due_before", "limit", "offset"]);
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ReminderApiError("INVALID_PAGINATION", "limit must be an integer from 1 to 100", 400, { field: "limit", maximum: 100 });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ReminderApiError("INVALID_PAGINATION", "offset must be a non-negative integer", 400, { field: "offset" });
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    throw new ReminderApiError("VALIDATION_ERROR", "status must be pending, delivered, or cancelled", 400, { field: "status" });
  }
  const options = { limit, offset };
  if (body.status !== undefined) options.status = body.status;
  if (body.target_object_id !== undefined) options.target_object_id = id(body.target_object_id, "target_object_id");
  if (body.due_after !== undefined) options.due_after = timestamp(body.due_after, "due_after");
  if (body.due_before !== undefined) options.due_before = timestamp(body.due_before, "due_before");
  if (options.due_after && options.due_before && Date.parse(options.due_after) > Date.parse(options.due_before)) {
    throw new ReminderApiError("INVALID_TIME_WINDOW", "due_after must be before or equal to due_before");
  }
  return options;
}

export function createReminderHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!OPERATIONS.includes(operation)) throw new Error(`Unknown Reminders operation: ${operation}`);
  return async (request) => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new ReminderApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new ReminderApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new ReminderApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ReminderApiError("VALIDATION_ERROR", "Request body must be an object");
    } catch (error) {
      return fail(error instanceof ReminderApiError ? error : new ReminderApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      let data;
      if (operation === "create_reminder") {
        onlyFields(body, ["target_object_id", "remind_at"]);
        data = { reminder: await repository.create(id(body.target_object_id, "target_object_id"), timestamp(body.remind_at, "remind_at")) };
      }
      if (operation === "update_reminder_time") {
        onlyFields(body, ["object_id", "remind_at"]);
        data = { reminder: await repository.updateTime(id(body.object_id, "object_id"), timestamp(body.remind_at, "remind_at")) };
      }
      if (["cancel_reminder", "mark_reminder_delivered", "get_reminder"].includes(operation)) {
        onlyFields(body, ["object_id"]);
        const objectId = id(body.object_id, "object_id");
        if (operation === "cancel_reminder") data = { reminder: await repository.cancel(objectId) };
        if (operation === "mark_reminder_delivered") data = { reminder: await repository.deliver(objectId) };
        if (operation === "get_reminder") data = { reminder: await repository.get(objectId) };
      }
      if (operation === "list_reminders") {
        const options = listOptions(body);
        const result = await repository.list(options);
        data = { reminders: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      return fail(error instanceof ReminderApiError ? error : new ReminderApiError("DATABASE_ERROR", "The reminder operation could not be completed", 500));
    }
  };
}
