export const CLASSIFICATION_OPERATIONS = [
  "create_category", "update_category", "archive_category", "get_category", "list_categories",
  "set_object_category", "clear_object_category",
  "create_tag", "update_tag", "archive_tag", "get_tag", "list_tags",
  "add_object_tag", "remove_object_tag", "replace_object_tags", "get_object_classification",
  "list_category_members", "list_tag_members",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class ClassificationApiError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); Object.assign(this, { code, status, details }); }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = error => response({ ok: false, error: error.message, code: error.code, details: error.details ?? {} }, error.status);
function bad(code, field, message) { throw new ClassificationApiError(code, `${field} ${message}`, 400, { field }); }
function id(value, field = "object_id") {
  if (typeof value !== "string" || !UUID.test(value)) bad("INVALID_OBJECT_ID", field, "must be a UUID");
  return value;
}
function nonblank(value, field) {
  if (typeof value !== "string" || !value.trim()) bad(value === undefined ? "MISSING_REQUIRED_FIELD" : "VALIDATION_ERROR", field, "must be a non-empty string");
  return value.trim();
}
function color(value) {
  if (typeof value !== "string" || !COLOR.test(value.trim())) bad("VALIDATION_ERROR", "color", "must be #RRGGBB");
  return value.trim().toUpperCase();
}
function status(value) {
  if (value === undefined) return undefined;
  if (!["active", "archived"].includes(value)) bad("VALIDATION_ERROR", "status", "must be active or archived");
  return value;
}
function page(body) {
  const limit = body.limit === undefined ? 50 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad("INVALID_PAGINATION", "limit", "must be an integer from 1 to 100");
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) bad("INVALID_PAGINATION", "offset", "must be an integer from 0 to 10000");
  return { limit, offset };
}
function only(body, allowed) {
  const fields = Object.keys(body).filter(key => !allowed.includes(key));
  if (fields.length) throw new ClassificationApiError("IMMUTABLE_FIELD", "Request contains unsupported classification fields", 400, { fields });
}
function categoryUpdate(body) {
  only(body, ["object_id", "name", "color", "sort_order"]);
  const patch = {};
  if (Object.hasOwn(body, "name")) patch.name = nonblank(body.name, "name");
  if (Object.hasOwn(body, "color")) patch.color = color(body.color);
  if (Object.hasOwn(body, "sort_order")) {
    if (!Number.isInteger(body.sort_order)) bad("VALIDATION_ERROR", "sort_order", "must be an integer");
    patch.sort_order = body.sort_order;
  }
  if (!Object.keys(patch).length) bad("MISSING_REQUIRED_FIELD", "patch", "requires a mutable category field");
  return [id(body.object_id), patch];
}
function tagUpdate(body) {
  only(body, ["object_id", "name"]);
  const patch = {};
  if (Object.hasOwn(body, "name")) patch.name = nonblank(body.name, "name");
  if (!Object.keys(patch).length) bad("MISSING_REQUIRED_FIELD", "patch", "requires a mutable tag field");
  return [id(body.object_id), patch];
}
function targetAnd(kind, body) {
  only(body, ["target_object_id", `${kind}_object_id`]);
  return [id(body.target_object_id, "target_object_id"), id(body[`${kind}_object_id`], `${kind}_object_id`)];
}
function targetAndTagSet(body) {
  only(body, ["target_object_id", "tag_object_ids"]);
  if (!Array.isArray(body.tag_object_ids)) bad("VALIDATION_ERROR", "tag_object_ids", "must be an array of UUIDs");
  return [
    id(body.target_object_id, "target_object_id"),
    body.tag_object_ids.map((value, index) => id(value, `tag_object_ids[${index}]`)),
  ];
}

export function createClassificationHandler({ operation, repository, actionSecret, databaseConfigured = true }) {
  if (!CLASSIFICATION_OPERATIONS.includes(operation)) throw new Error(`Unknown Classification operation: ${operation}`);
  return async request => {
    if (request.method === "OPTIONS") return response({ ok: true });
    if (request.method !== "POST") return fail(new ClassificationApiError("METHOD_NOT_ALLOWED", "Method not allowed", 405));
    if (!actionSecret || !databaseConfigured) return fail(new ClassificationApiError("SERVER_CONFIG_ERROR", "Server configuration is incomplete", 500));
    const supplied = request.headers.get("x-action-secret")?.trim() || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (supplied !== actionSecret) return fail(new ClassificationApiError("UNAUTHORIZED", "Unauthorized", 401));
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClassificationApiError("VALIDATION_ERROR", "Request body must be an object");
    } catch (error) {
      return fail(error instanceof ClassificationApiError ? error : new ClassificationApiError("INVALID_JSON", "Invalid JSON body"));
    }
    try {
      let data;
      if (operation === "create_category") {
        only(body, ["name", "color", "sort_order"]);
        if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) bad("VALIDATION_ERROR", "sort_order", "must be an integer");
        data = { category: await repository.createCategory({ name: nonblank(body.name, "name"), color: color(body.color), sort_order: body.sort_order ?? 0 }) };
      }
      if (operation === "update_category") data = { category: await repository.updateCategory(...categoryUpdate(body)) };
      if (operation === "archive_category") { only(body, ["object_id"]); data = { category: await repository.archiveCategory(id(body.object_id)) }; }
      if (operation === "get_category") { only(body, ["object_id"]); data = { category: await repository.getCategory(id(body.object_id)) }; }
      if (operation === "list_categories") {
        only(body, ["status", "limit", "offset"]); const options = { ...page(body), status: status(body.status) };
        const result = await repository.listCategories(options);
        data = { categories: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      if (operation === "set_object_category") { const args = targetAnd("category", body); data = { classification: await repository.setObjectCategory(...args) }; }
      if (operation === "clear_object_category") { only(body, ["target_object_id"]); data = { classification: await repository.clearObjectCategory(id(body.target_object_id, "target_object_id")) }; }
      if (operation === "create_tag") { only(body, ["name"]); data = { tag: await repository.createTag({ name: nonblank(body.name, "name") }) }; }
      if (operation === "update_tag") data = { tag: await repository.updateTag(...tagUpdate(body)) };
      if (operation === "archive_tag") { only(body, ["object_id"]); data = { tag: await repository.archiveTag(id(body.object_id)) }; }
      if (operation === "get_tag") { only(body, ["object_id"]); data = { tag: await repository.getTag(id(body.object_id)) }; }
      if (operation === "list_tags") {
        only(body, ["status", "limit", "offset"]); const options = { ...page(body), status: status(body.status) };
        const result = await repository.listTags(options);
        data = { tags: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      if (operation === "add_object_tag") { const args = targetAnd("tag", body); data = { classification: await repository.addObjectTag(...args) }; }
      if (operation === "remove_object_tag") { const args = targetAnd("tag", body); data = { classification: await repository.removeObjectTag(...args) }; }
      if (operation === "replace_object_tags") { const args = targetAndTagSet(body); data = { classification: await repository.replaceObjectTags(...args) }; }
      if (operation === "get_object_classification") { only(body, ["target_object_id"]); data = { classification: await repository.getObjectClassification(id(body.target_object_id, "target_object_id")) }; }
      if (operation === "list_category_members" || operation === "list_tag_members") {
        const kind = operation === "list_category_members" ? "category" : "tag";
        only(body, [`${kind}_object_id`, "limit", "offset"]); const options = page(body);
        const result = operation === "list_category_members"
          ? await repository.listCategoryMembers(id(body.category_object_id, "category_object_id"), options)
          : await repository.listTagMembers(id(body.tag_object_id, "tag_object_id"), options);
        data = { members: result.rows, limit: options.limit, offset: options.offset, count: result.rows.length, has_more: result.hasMore };
      }
      return response({ ok: true, data });
    } catch (error) {
      return fail(error instanceof ClassificationApiError ? error : new ClassificationApiError("DATABASE_ERROR", "The classification operation could not be completed", 500));
    }
  };
}
