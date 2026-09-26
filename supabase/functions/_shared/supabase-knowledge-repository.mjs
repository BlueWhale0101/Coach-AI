import { KnowledgeApiError } from "./knowledge-api.mjs";

function translate(error) {
  if (error?.code === "P0002") return new KnowledgeApiError("KNOWLEDGE_NOT_FOUND", "Knowledge item not found", 404);
  if (error?.code === "55000") return new KnowledgeApiError("INVALID_TRANSITION", "Knowledge item is archived", 409);
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error?.code)) return new KnowledgeApiError("VALIDATION_ERROR", "Knowledge data violates a validation rule");
  return new KnowledgeApiError("DATABASE_ERROR", "The knowledge operation could not be completed", 500);
}

function one(data, error) {
  if (error) throw translate(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new KnowledgeApiError("KNOWLEDGE_NOT_FOUND", "Knowledge item not found", 404);
  return row;
}

export class SupabaseKnowledgeRepository {
  constructor(client) { this.client = client; }

  async create({ title, content }) {
    const { data, error } = await this.client.rpc("assistant_create_knowledge", { p_title: title, p_content: content });
    return one(data, error);
  }

  async update(id, patch) {
    const { data, error } = await this.client.rpc("assistant_update_knowledge", { p_object_id: id, p_patch: patch });
    return one(data, error);
  }

  async archive(id) {
    const { data, error } = await this.client.rpc("assistant_archive_knowledge", { p_object_id: id });
    return one(data, error);
  }

  async get(id) {
    const { data, error } = await this.client.from("assistant_knowledge").select("*").eq("object_id", id).maybeSingle();
    return one(data, error);
  }

  async list(options) {
    let query = this.client.from("assistant_knowledge").select("*");
    if (options.status !== undefined) query = query.eq("status", options.status);
    const { data, error } = await query.order("created_at", { ascending: false })
      .order("object_id", { ascending: true }).range(options.offset, options.offset + options.limit);
    if (error) throw translate(error);
    return { rows: (data ?? []).slice(0, options.limit), hasMore: (data ?? []).length > options.limit };
  }

  async search(options) {
    const { data, error } = await this.client.rpc("assistant_search_knowledge", {
      p_query: options.query, p_status: options.status ?? null,
      p_limit: options.limit + 1, p_offset: options.offset,
    });
    if (error) throw translate(error);
    return { rows: (data ?? []).slice(0, options.limit), hasMore: (data ?? []).length > options.limit };
  }
}
