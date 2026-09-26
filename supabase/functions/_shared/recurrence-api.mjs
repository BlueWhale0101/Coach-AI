export const OPERATIONS = ["create_recurrence", "update_recurrence", "end_recurrence", "get_recurrence", "list_recurrences", "list_due_recurrence_occurrences", "next_after_completion", "record_recurrence_occurrence"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQ = ["daily", "weekly", "monthly", "yearly"];
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
const fail = (error) => response({ ok: false, error: error.message, code: error.code, details: error.details ?? {} }, error.status);

export class RecurrenceApiError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); Object.assign(this, { code, status, details }); }
}
function bad(code, field, description) { throw new RecurrenceApiError(code, `${field} ${description}`, 400, { field }); }
function id(value, field) { if (typeof value !== "string" || !UUID.test(value)) bad("INVALID_OBJECT_ID", field, "must be a UUID"); return value; }
function stamp(value, field) { if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) bad("INVALID_TIMESTAMP", field, "must be an absolute ISO timestamp"); return value; }
function date(value, field) { if (typeof value !== "string" || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) bad("INVALID_DATE", field, "must be an ISO calendar date"); return value; }
function choice(value, field, values) { if (!values.includes(value)) bad(value === undefined ? "MISSING_REQUIRED_FIELD" : "VALIDATION_ERROR", field, `must be one of ${values.join(", ")}`); return value; }
function positive(value, field, max = 2147483647) { if (!Number.isInteger(value) || value < 1 || value > max) bad("VALIDATION_ERROR", field, `must be a positive integer at most ${max}`); return value; }
function only(body, allowed) { const fields = Object.keys(body).filter(key => !allowed.includes(key)); if (fields.length) throw new RecurrenceApiError("IMMUTABLE_FIELD", "Request contains unsupported recurrence fields", 400, { fields }); }
function page(body) {
  const limit = body.limit === undefined ? 50 : body.limit, offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) bad("INVALID_PAGINATION", "limit/offset", "must be limit 1–100 and offset 0–10000");
  return { limit, offset };
}
function weekdays(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.length || value.some(x => !Number.isInteger(x) || x < 1 || x > 7) || new Set(value).size !== value.length) bad("VALIDATION_ERROR", "weekdays", "must be unique ISO weekdays 1 through 7");
  return [...value].sort((a, b) => a - b);
}
const ruleFields = ["basis", "frequency", "interval_count", "anchor_kind", "anchor_at", "anchor_date", "timezone", "weekdays"];
function create(body) {
  only(body, ["seed_object_id", ...ruleFields, "seed_occurrence_at", "seed_occurrence_date"]);
  const rule = { seed_object_id: id(body.seed_object_id, "seed_object_id"), basis: choice(body.basis, "basis", ["calendar", "after_completion"]), frequency: choice(body.frequency, "frequency", FREQ), interval_count: positive(body.interval_count, "interval_count") };
  if (rule.basis === "calendar") {
    rule.anchor_kind = choice(body.anchor_kind, "anchor_kind", ["instant", "date"]);
    if (rule.anchor_kind === "instant") {
      if (body.anchor_date !== undefined || body.seed_occurrence_date !== undefined) bad("VALIDATION_ERROR", "anchor_date", "is forbidden for instant rules");
      rule.anchor_at = stamp(body.anchor_at, "anchor_at");
      rule.timezone = zone(body.timezone);
      rule.seed_occurrence_at = stamp(body.seed_occurrence_at, "seed_occurrence_at");
      if (Date.parse(rule.anchor_at) !== Date.parse(rule.seed_occurrence_at)) bad("VALIDATION_ERROR", "seed_occurrence_at", "must equal anchor_at");
    } else {
      if (body.anchor_at !== undefined || body.seed_occurrence_at !== undefined || body.timezone !== undefined) bad("VALIDATION_ERROR", "anchor_at", "is forbidden for date rules");
      rule.anchor_date = date(body.anchor_date, "anchor_date");
      rule.seed_occurrence_date = date(body.seed_occurrence_date, "seed_occurrence_date");
      if (rule.anchor_date !== rule.seed_occurrence_date) bad("VALIDATION_ERROR", "seed_occurrence_date", "must equal anchor_date");
    }
    if (body.weekdays !== undefined) {
      if (rule.frequency !== "weekly") bad("VALIDATION_ERROR", "weekdays", "are only available for calendar weekly rules");
      rule.weekdays = weekdays(body.weekdays);
    }
  } else {
    if (["anchor_kind", "anchor_at", "anchor_date", "seed_occurrence_date", "weekdays"].some(key => body[key] !== undefined)) bad("VALIDATION_ERROR", "anchor", "is forbidden for completion-relative rules");
    rule.timezone = zone(body.timezone);
    rule.seed_occurrence_at = stamp(body.seed_occurrence_at, "seed_occurrence_at");
  }
  return rule;
}
function zone(value) { if (typeof value !== "string" || !value.trim()) bad("VALIDATION_ERROR", "timezone", "must be a nonblank PostgreSQL timezone name"); return value.trim(); }
function update(body) {
  only(body, ["object_id", "frequency", "interval_count", "timezone", "weekdays"]);
  const objectId = id(body.object_id, "object_id");
  const patch = {};
  if (Object.hasOwn(body, "frequency")) patch.frequency = choice(body.frequency, "frequency", FREQ);
  if (Object.hasOwn(body, "interval_count")) patch.interval_count = positive(body.interval_count, "interval_count");
  if (Object.hasOwn(body, "timezone")) patch.timezone = body.timezone === null ? null : zone(body.timezone);
  if (Object.hasOwn(body, "weekdays")) patch.weekdays = weekdays(body.weekdays);
  if (!Object.keys(patch).length) bad("MISSING_REQUIRED_FIELD", "patch", "requires a mutable rule field");
  return [objectId, patch];
}
function due(body) {
  only(body, ["from_at", "through_at", "from_date", "through_date", "limit", "offset"]);
  const options = page(body);
  for (const [first, last, parse] of [["from_at", "through_at", stamp], ["from_date", "through_date", date]]) {
    if ((body[first] === undefined) !== (body[last] === undefined)) bad("INVALID_TIME_WINDOW", first, "requires both bounds");
    if (body[first] !== undefined) { options[first] = parse(body[first], first); options[last] = parse(body[last], last);
      if ((parse === stamp ? Date.parse(options[first]) > Date.parse(options[last]) : options[first] > options[last])) bad("INVALID_TIME_WINDOW", first, "must be no later than upper bound"); }
  }
  if (options.from_at === undefined && options.from_date === undefined) bad("MISSING_REQUIRED_FIELD", "horizon", "requires an instant or date window");
  return options;
}
function descriptor(body) {
  const sequence = positive(body.sequence, "sequence", 100000000);
  if ((body.occurrence_at === undefined) === (body.occurrence_date === undefined)) bad("VALIDATION_ERROR", "occurrence", "requires exactly one instant or date");
  return { sequence, occurrence_at: body.occurrence_at === undefined ? null : stamp(body.occurrence_at, "occurrence_at"), occurrence_date: body.occurrence_date === undefined ? null : date(body.occurrence_date, "occurrence_date") };
}

export function createRecurrenceHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!OPERATIONS.includes(operation)) throw new Error(`Unknown Recurrence operation: ${operation}`);
  return async request => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new RecurrenceApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new RecurrenceApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new RecurrenceApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new RecurrenceApiError("VALIDATION_ERROR", "Request body must be an object"); }
    catch (error) { return fail(error instanceof RecurrenceApiError ? error : new RecurrenceApiError("INVALID_JSON", "Invalid JSON body")); }
    try {
      let data;
      if (operation === "create_recurrence") data = { recurrence: await repository.create(create(body)) };
      if (operation === "update_recurrence") data = { recurrence: await repository.update(...update(body)) };
      if (operation === "end_recurrence" || operation === "get_recurrence") { only(body, ["object_id"]); const objectId = id(body.object_id, "object_id"); data = { recurrence: operation === "end_recurrence" ? await repository.end(objectId) : await repository.get(objectId) }; }
      if (operation === "list_recurrences") {
        only(body, ["status", "seed_object_id", "basis", "limit", "offset"]); const options = page(body);
        if (body.status !== undefined) options.status = choice(body.status, "status", ["active", "ended"]);
        if (body.basis !== undefined) options.basis = choice(body.basis, "basis", ["calendar", "after_completion"]);
        if (body.seed_object_id !== undefined) options.seed_object_id = id(body.seed_object_id, "seed_object_id");
        const result = await repository.list(options); data = { recurrences: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      if (operation === "list_due_recurrence_occurrences") {
        const options = due(body); const result = await repository.due(options);
        data = { occurrences: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      if (operation === "next_after_completion") {
        only(body, ["object_id", "completed_object_id", "completed_at"]);
        data = { occurrence: await repository.next(id(body.object_id, "object_id"), id(body.completed_object_id, "completed_object_id"), stamp(body.completed_at, "completed_at")) };
      }
      if (operation === "record_recurrence_occurrence") {
        only(body, ["object_id", "sequence", "occurrence_at", "occurrence_date", "generated_object_id", "completed_object_id", "completed_at"]);
        const objectId = id(body.object_id, "object_id"), position = descriptor(body);
        if ((body.completed_object_id === undefined) !== (body.completed_at === undefined)) bad("VALIDATION_ERROR", "completion", "requires both predecessor and completion instant");
        if (body.completed_object_id !== undefined) { position.completed_object_id = id(body.completed_object_id, "completed_object_id"); position.completed_at = stamp(body.completed_at, "completed_at"); }
        position.generated_object_id = id(body.generated_object_id, "generated_object_id");
        data = { occurrence: await repository.record(objectId, position) };
      }
      return response({ ok: true, data });
    } catch (error) { return fail(error instanceof RecurrenceApiError ? error : new RecurrenceApiError("DATABASE_ERROR", "The recurrence operation could not be completed", 500)); }
  };
}
