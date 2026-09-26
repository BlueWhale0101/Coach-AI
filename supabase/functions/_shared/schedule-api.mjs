export const OPERATIONS = ["create_schedule_event", "update_schedule_event", "cancel_schedule_event", "get_schedule_event", "list_schedule_events", "search_schedule_events"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMED = ["time_kind", "starts_at", "ends_at", "timezone"];
const ALL_DAY = ["time_kind", "start_date", "end_date"];
const TEMPORAL = ["time_kind", "starts_at", "ends_at", "timezone", "start_date", "end_date"];

export class ScheduleApiError extends Error {
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

function objectId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ScheduleApiError("INVALID_OBJECT_ID", "object_id must be a UUID", 400, { field: "object_id" });
  return value;
}
function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new ScheduleApiError(value === undefined ? "MISSING_REQUIRED_FIELD" : "VALIDATION_ERROR", `${field} must be a non-empty string`, 400, { field });
  return value.trim();
}
function description(value) {
  if (value === null) return null;
  return text(value, "description");
}
function timestamp(value, field) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ScheduleApiError("INVALID_TIMESTAMP", `${field} must be an ISO 8601 timestamp with a timezone`, 400, { field });
  }
  return value;
}
function date(value, field) {
  if (typeof value !== "string" || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ScheduleApiError("INVALID_DATE", `${field} must be an ISO calendar date`, 400, { field });
  }
  return value;
}
function only(body, allowed) {
  const fields = Object.keys(body).filter((field) => !allowed.includes(field));
  if (fields.length) throw new ScheduleApiError("IMMUTABLE_FIELD", "Request contains unsupported schedule event fields", 400, { fields });
}
function temporal(body) {
  if (!["timed", "all_day"].includes(body.time_kind)) throw new ScheduleApiError("VALIDATION_ERROR", "time_kind must be timed or all_day", 400, { field: "time_kind" });
  const allowed = body.time_kind === "timed" ? TIMED : ALL_DAY;
  if (TEMPORAL.some(field => Object.hasOwn(body, field) && !allowed.includes(field))) {
    throw new ScheduleApiError("VALIDATION_ERROR", "Timed and all-day fields cannot be mixed");
  }
  if (allowed.some(field => !Object.hasOwn(body, field))) {
    throw new ScheduleApiError("MISSING_REQUIRED_FIELD", "A complete temporal representation is required");
  }
  if (body.time_kind === "timed") {
    const starts_at = timestamp(body.starts_at, "starts_at");
    const ends_at = timestamp(body.ends_at, "ends_at");
    const timezone = text(body.timezone, "timezone"); // The database checks pg_timezone_names.
    if (Date.parse(starts_at) >= Date.parse(ends_at)) throw new ScheduleApiError("INVALID_TIME_WINDOW", "starts_at must be before ends_at");
    return { time_kind: "timed", starts_at, ends_at, timezone };
  }
  const start_date = date(body.start_date, "start_date");
  const end_date = date(body.end_date, "end_date");
  if (start_date >= end_date) throw new ScheduleApiError("INVALID_TIME_WINDOW", "start_date must be before exclusive end_date");
  return { time_kind: "all_day", start_date, end_date };
}
function status(value) {
  if (value === undefined) return undefined;
  if (!["scheduled", "cancelled"].includes(value)) throw new ScheduleApiError("VALIDATION_ERROR", "status must be scheduled or cancelled", 400, { field: "status" });
  return value;
}
function pagination(body) {
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ScheduleApiError("INVALID_PAGINATION", "limit must be an integer from 1 to 100", 400, { field: "limit", maximum: 100 });
  if (!Number.isInteger(offset) || offset < 0) throw new ScheduleApiError("INVALID_PAGINATION", "offset must be a non-negative integer", 400, { field: "offset" });
  return { limit, offset, status: status(body.status) };
}
function overlap(body, options, prefix, validate) {
  const start = `${prefix}_overlap_start`;
  const end = `${prefix}_overlap_end`;
  const supplied = Object.hasOwn(body, start) || Object.hasOwn(body, end);
  if (!supplied) return;
  if (!Object.hasOwn(body, start) || !Object.hasOwn(body, end)) throw new ScheduleApiError("INVALID_TIME_WINDOW", `${prefix} overlap requires both bounds`);
  options[start] = validate(body[start], start);
  options[end] = validate(body[end], end);
  const begins = prefix === "timed" ? Date.parse(options[start]) : options[start];
  const ends = prefix === "timed" ? Date.parse(options[end]) : options[end];
  if (begins >= ends) throw new ScheduleApiError("INVALID_TIME_WINDOW", `${prefix} overlap start must precede end`);
}
function listOptions(body) {
  only(body, ["status", "limit", "offset", "timed_overlap_start", "timed_overlap_end", "all_day_overlap_start", "all_day_overlap_end"]);
  const options = pagination(body);
  overlap(body, options, "timed", timestamp);
  overlap(body, options, "all_day", date);
  return options;
}

export function createScheduleHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!OPERATIONS.includes(operation)) throw new Error(`Unknown Scheduling operation: ${operation}`);
  return async (request) => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new ScheduleApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new ScheduleApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new ScheduleApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ScheduleApiError("VALIDATION_ERROR", "Request body must be an object");
    } catch (error) {
      return fail(error instanceof ScheduleApiError ? error : new ScheduleApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      let data;
      if (operation === "create_schedule_event") {
        only(body, ["title", "description", ...TEMPORAL]);
        const event = { title: text(body.title, "title"), ...temporal(body) };
        if (Object.hasOwn(body, "description")) event.description = description(body.description);
        data = { event: await repository.create(event) };
      }
      if (operation === "update_schedule_event") {
        only(body, ["object_id", "title", "description", ...TEMPORAL]);
        const id = objectId(body.object_id);
        const patch = {};
        if (Object.hasOwn(body, "title")) patch.title = text(body.title, "title");
        if (Object.hasOwn(body, "description")) patch.description = description(body.description);
        if (TEMPORAL.some(field => Object.hasOwn(body, field))) Object.assign(patch, temporal(body));
        if (!Object.keys(patch).length) throw new ScheduleApiError("MISSING_REQUIRED_FIELD", "At least one mutable event field is required");
        data = { event: await repository.update(id, patch) };
      }
      if (operation === "cancel_schedule_event" || operation === "get_schedule_event") {
        only(body, ["object_id"]);
        const id = objectId(body.object_id);
        data = { event: operation === "get_schedule_event" ? await repository.get(id) : await repository.cancel(id) };
      }
      if (operation === "list_schedule_events" || operation === "search_schedule_events") {
        let options;
        if (operation === "list_schedule_events") options = listOptions(body);
        else {
          only(body, ["query", "status", "limit", "offset"]);
          options = { ...pagination(body), query: text(body.query, "query") };
        }
        const result = operation === "list_schedule_events" ? await repository.list(options) : await repository.search(options);
        data = { events: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      return fail(error instanceof ScheduleApiError ? error : new ScheduleApiError("DATABASE_ERROR", "The schedule operation could not be completed", 500));
    }
  };
}
