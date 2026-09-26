import { TaskApiError } from "./task-api.mjs";

function translate(error) {
  if (error?.code === "P0002") return new TaskApiError("TASK_NOT_FOUND", "Task not found", 404);
  if (error?.code === "55000") return new TaskApiError("INVALID_TRANSITION", "Only an open task can enter a terminal state", 409);
  if (["22023", "22P02", "23514"].includes(error?.code)) return new TaskApiError("VALIDATION_ERROR", "Task data violates a validation rule");
  return new TaskApiError("DATABASE_ERROR", "The task operation could not be completed", 500);
}

function one(data, error) {
  if (error) throw translate(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new TaskApiError("TASK_NOT_FOUND", "Task not found", 404);
  return row;
}

export class SupabaseTaskRepository {
  constructor(client) {
    this.client = client;
  }

  async create(task) {
    const { data, error } = await this.client.rpc("assistant_create_task", {
      p_title: task.title,
      p_description: task.description ?? null,
      p_priority: task.priority ?? null,
      p_not_before: task.not_before ?? null,
      p_due_at: task.due_at ?? null,
    });
    return one(data, error);
  }

  async update(id, patch) {
    const { data, error } = await this.client.rpc("assistant_update_task", { p_object_id: id, p_patch: patch });
    return one(data, error);
  }

  async complete(id) {
    const { data, error } = await this.client.rpc("assistant_complete_task", { p_object_id: id });
    return one(data, error);
  }

  async cancel(id) {
    const { data, error } = await this.client.rpc("assistant_cancel_task", { p_object_id: id });
    return one(data, error);
  }

  async get(id) {
    const { data, error } = await this.client.from("assistant_tasks").select("*").eq("object_id", id).maybeSingle();
    return one(data, error);
  }

  async list(options) {
    return this.#find(options);
  }

  async search(options) {
    const { data, error } = await this.client.rpc("assistant_search_tasks", {
      p_query: options.query,
      p_status: options.status ?? null,
      p_priority: options.priority ?? null,
      p_priority_is_null: options.priority === null,
      p_due_from: options.due_from ?? null,
      p_due_to: options.due_to ?? null,
      p_actionable_at: options.actionable_at ?? null,
      p_limit: options.limit + 1,
      p_offset: options.offset,
    });
    if (error) throw translate(error);
    const rows = data ?? [];
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }

  async #find(options) {
    let query = this.client.from("assistant_tasks").select("*");
    if (options.status !== undefined) query = query.eq("status", options.status);
    if (options.priority === null) query = query.is("priority", null);
    else if (options.priority !== undefined) query = query.eq("priority", options.priority);
    if (options.due_from) query = query.gte("due_at", options.due_from);
    if (options.due_to) query = query.lte("due_at", options.due_to);
    if (options.actionable_at) query = query.or(`not_before.is.null,not_before.lte.${options.actionable_at}`);
    const { data, error } = await query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("object_id", { ascending: true })
      .range(options.offset, options.offset + options.limit);
    if (error) throw translate(error);
    const rows = data ?? [];
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }
}
