import { ClassificationApiError } from "./classification-api.mjs";

function translate(error, kind = "CLASSIFICATION") {
  if (error?.code === "P0002") return new ClassificationApiError(`${kind}_NOT_FOUND`, `${kind.toLowerCase()} not found`, 404);
  if (error?.code === "55000") return new ClassificationApiError("INVALID_TRANSITION", "Classification item is archived", 409);
  if (error?.code === "23505") return new ClassificationApiError("DUPLICATE_NAME", "Classification name already exists", 409);
  if (error?.code === "23503") return new ClassificationApiError("TARGET_NOT_FOUND", "Classification target not found", 404);
  if (["22023", "22P02", "23502", "23514"].includes(error?.code)) return new ClassificationApiError("VALIDATION_ERROR", "Classification data violates a validation rule");
  return new ClassificationApiError("DATABASE_ERROR", "The classification operation could not be completed", 500);
}
function one(data, error, kind) {
  if (error) throw translate(error, kind);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ClassificationApiError(`${kind}_NOT_FOUND`, `${kind.toLowerCase()} not found`, 404);
  return row;
}
function page(data, error, limit, kind = "CLASSIFICATION") {
  if (error) throw translate(error, kind);
  return { rows: (data ?? []).slice(0, limit), hasMore: (data ?? []).length > limit };
}

export class SupabaseClassificationRepository {
  constructor(client) { this.client = client; }

  async createCategory(value) {
    const { data, error } = await this.client.rpc("assistant_create_category", { p_name: value.name, p_color: value.color, p_sort_order: value.sort_order });
    return one(data, error, "CATEGORY");
  }
  async updateCategory(id, patch) {
    const { data, error } = await this.client.rpc("assistant_update_category", { p_object_id: id, p_patch: patch });
    return one(data, error, "CATEGORY");
  }
  async archiveCategory(id) {
    const { data, error } = await this.client.rpc("assistant_archive_category", { p_object_id: id });
    return one(data, error, "CATEGORY");
  }
  async getCategory(id) {
    const { data, error } = await this.client.from("assistant_categories").select("*").eq("object_id", id).maybeSingle();
    return one(data, error, "CATEGORY");
  }
  async listCategories(options) {
    const { data, error } = await this.client.rpc("assistant_list_categories", { p_status: options.status ?? null, p_limit: options.limit + 1, p_offset: options.offset });
    return page(data, error, options.limit, "CATEGORY");
  }
  async setObjectCategory(targetId, categoryId) {
    const { error } = await this.client.rpc("assistant_set_object_category", { p_target_object_id: targetId, p_category_object_id: categoryId });
    if (error) throw translate(error, "CATEGORY");
    return this.getObjectClassification(targetId);
  }
  async clearObjectCategory(targetId) {
    const { error } = await this.client.rpc("assistant_clear_object_category", { p_target_object_id: targetId });
    if (error) throw translate(error);
    return this.getObjectClassification(targetId);
  }
  async createTag(value) {
    const { data, error } = await this.client.rpc("assistant_create_tag", { p_name: value.name });
    return one(data, error, "TAG");
  }
  async updateTag(id, patch) {
    const { data, error } = await this.client.rpc("assistant_update_tag", { p_object_id: id, p_patch: patch });
    return one(data, error, "TAG");
  }
  async archiveTag(id) {
    const { data, error } = await this.client.rpc("assistant_archive_tag", { p_object_id: id });
    return one(data, error, "TAG");
  }
  async getTag(id) {
    const { data, error } = await this.client.from("assistant_tags").select("*").eq("object_id", id).maybeSingle();
    return one(data, error, "TAG");
  }
  async listTags(options) {
    const { data, error } = await this.client.rpc("assistant_list_tags", { p_status: options.status ?? null, p_limit: options.limit + 1, p_offset: options.offset });
    return page(data, error, options.limit, "TAG");
  }
  async addObjectTag(targetId, tagId) {
    const { error } = await this.client.rpc("assistant_add_object_tag", { p_target_object_id: targetId, p_tag_object_id: tagId });
    if (error) throw translate(error, "TAG");
    return this.getObjectClassification(targetId);
  }
  async removeObjectTag(targetId, tagId) {
    const { error } = await this.client.rpc("assistant_remove_object_tag", { p_target_object_id: targetId, p_tag_object_id: tagId });
    if (error) throw translate(error, "TAG");
    return this.getObjectClassification(targetId);
  }
  async getObjectClassification(targetId) {
    const { data, error } = await this.client.rpc("assistant_get_object_classification", { p_target_object_id: targetId });
    return one(data, error, "CLASSIFICATION");
  }
  async listCategoryMembers(categoryId, options) {
    const { data, error } = await this.client.rpc("assistant_list_category_members", { p_category_object_id: categoryId, p_limit: options.limit + 1, p_offset: options.offset });
    return page(data, error, options.limit, "CATEGORY");
  }
  async listTagMembers(tagId, options) {
    const { data, error } = await this.client.rpc("assistant_list_tag_members", { p_tag_object_id: tagId, p_limit: options.limit + 1, p_offset: options.offset });
    return page(data, error, options.limit, "TAG");
  }
}
