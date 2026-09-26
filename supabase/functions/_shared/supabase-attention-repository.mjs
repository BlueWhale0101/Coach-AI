import { AttentionApiError } from "./attention-api.mjs";

function translate(error) {
  if (error?.code === "23503") return new AttentionApiError("TARGET_NOT_FOUND", "Pin target not found", 404);
  if (["22023", "22P02", "23502", "23514"].includes(error?.code)) return new AttentionApiError("VALIDATION_ERROR", "Attention data violates a validation rule");
  return new AttentionApiError("DATABASE_ERROR", "The attention operation could not be completed", 500);
}
function one(data, error) {
  if (error) throw translate(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new AttentionApiError("TARGET_NOT_FOUND", "Pin target not found", 404);
  return row;
}

export class SupabaseAttentionRepository {
  constructor(client) { this.client = client; }
  async pin(id) {
    const { data, error } = await this.client.rpc("assistant_pin_object", { p_target_object_id: id });
    return one(data, error);
  }
  async unpin(id) {
    const { error } = await this.client.rpc("assistant_unpin_object", { p_target_object_id: id });
    if (error) throw translate(error);
    return { target_object_id: id, pinned: false, pinned_at: null };
  }
  async isPinned(id) {
    const { data, error } = await this.client.rpc("assistant_is_object_pinned", { p_target_object_id: id });
    return one(data, error);
  }
  async list(options) {
    const { data, error } = await this.client.rpc("assistant_list_pinned_objects", { p_limit: options.limit + 1, p_offset: options.offset });
    if (error) throw translate(error);
    return { rows: (data ?? []).slice(0, options.limit), hasMore: (data ?? []).length > options.limit };
  }
}
