import { ReminderApiError } from "./reminder-api.mjs";

function translate(error) {
  if (error?.code === "P0002") return new ReminderApiError("REMINDER_NOT_FOUND", "Reminder not found", 404);
  if (error?.code === "23503") return new ReminderApiError("TARGET_NOT_FOUND", "Target object not found", 404);
  if (error?.code === "55000") return new ReminderApiError("INVALID_TRANSITION", "Reminder is already terminal", 409);
  if (error?.code === "22023") return new ReminderApiError("INVALID_TARGET", "Invalid reminder target", 400);
  if (["22P02", "23502", "23514"].includes(error?.code)) return new ReminderApiError("VALIDATION_ERROR", "Reminder data violates a validation rule");
  return new ReminderApiError("DATABASE_ERROR", "The reminder operation could not be completed", 500);
}

function one(data, error) {
  if (error) throw translate(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ReminderApiError("REMINDER_NOT_FOUND", "Reminder not found", 404);
  return row;
}

export class SupabaseReminderRepository {
  constructor(client) { this.client = client; }

  async create(target, time) {
    const { data, error } = await this.client.rpc("assistant_create_reminder", { p_target_object_id: target, p_remind_at: time });
    return one(data, error);
  }
  async updateTime(id, time) {
    const { data, error } = await this.client.rpc("assistant_update_reminder_time", { p_object_id: id, p_remind_at: time });
    return one(data, error);
  }
  async cancel(id) {
    const { data, error } = await this.client.rpc("assistant_cancel_reminder", { p_object_id: id });
    return one(data, error);
  }
  async deliver(id) {
    const { data, error } = await this.client.rpc("assistant_mark_reminder_delivered", { p_object_id: id });
    return one(data, error);
  }
  async get(id) {
    const { data, error } = await this.client.from("assistant_reminders").select("*").eq("object_id", id).maybeSingle();
    return one(data, error);
  }
  async list(options) {
    let query = this.client.from("assistant_reminders").select("*");
    if (options.status !== undefined) query = query.eq("status", options.status);
    if (options.target_object_id !== undefined) query = query.eq("target_object_id", options.target_object_id);
    if (options.due_after !== undefined) query = query.gte("remind_at", options.due_after);
    if (options.due_before !== undefined) query = query.lte("remind_at", options.due_before);
    const { data, error } = await query.order("remind_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("object_id", { ascending: true }).range(options.offset, options.offset + options.limit);
    if (error) throw translate(error);
    const rows = data ?? [];
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }
}
