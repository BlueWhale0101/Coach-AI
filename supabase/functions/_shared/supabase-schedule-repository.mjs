import { ScheduleApiError } from "./schedule-api.mjs";

function translate(error) {
  if (error?.code === "P0002") return new ScheduleApiError("EVENT_NOT_FOUND", "Schedule event not found", 404);
  if (error?.code === "55000") return new ScheduleApiError("INVALID_TRANSITION", "Schedule event is cancelled", 409);
  if (error?.code === "22023" && error.message === "invalid schedule timezone") return new ScheduleApiError("INVALID_TIMEZONE", "timezone must be a valid PostgreSQL timezone name");
  if (["22023", "22P02", "22007", "22008", "23502", "23514"].includes(error?.code)) return new ScheduleApiError("VALIDATION_ERROR", "Schedule event data violates a validation rule");
  return new ScheduleApiError("DATABASE_ERROR", "The schedule operation could not be completed", 500);
}
function one(data, error) {
  if (error) throw translate(error);
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) throw new ScheduleApiError("EVENT_NOT_FOUND", "Schedule event not found", 404);
  return item;
}
export class SupabaseScheduleRepository {
  constructor(client) { this.client = client; }
  async create(event) {
    const { data, error } = await this.client.rpc("assistant_create_schedule_event", {
      p_title: event.title, p_description: event.description ?? null, p_time_kind: event.time_kind,
      p_starts_at: event.starts_at ?? null, p_ends_at: event.ends_at ?? null,
      p_timezone: event.timezone ?? null, p_start_date: event.start_date ?? null,
      p_end_date: event.end_date ?? null,
    });
    return one(data, error);
  }
  async update(id, patch) {
    const { data, error } = await this.client.rpc("assistant_update_schedule_event", { p_object_id: id, p_patch: patch });
    return one(data, error);
  }
  async cancel(id) {
    const { data, error } = await this.client.rpc("assistant_cancel_schedule_event", { p_object_id: id });
    return one(data, error);
  }
  async get(id) {
    const { data, error } = await this.client.from("assistant_schedule_events").select("*").eq("object_id", id).maybeSingle();
    return one(data, error);
  }
  async list(options) {
    const { data, error } = await this.client.rpc("assistant_list_schedule_events", {
      p_status: options.status ?? null,
      p_timed_overlap_start: options.timed_overlap_start ?? null,
      p_timed_overlap_end: options.timed_overlap_end ?? null,
      p_all_day_overlap_start: options.all_day_overlap_start ?? null,
      p_all_day_overlap_end: options.all_day_overlap_end ?? null,
      p_limit: options.limit + 1, p_offset: options.offset,
    });
    if (error) throw translate(error);
    const rows = data ?? [];
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }
  async search(options) {
    const { data, error } = await this.client.rpc("assistant_search_schedule_events", {
      p_query: options.query, p_status: options.status ?? null,
      p_limit: options.limit + 1, p_offset: options.offset,
    });
    if (error) throw translate(error);
    const rows = data ?? [];
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }
}
