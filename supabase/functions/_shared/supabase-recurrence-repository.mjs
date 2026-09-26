import { RecurrenceApiError } from "./recurrence-api.mjs";

function translate(error) {
  if (error?.code === "P0002") return new RecurrenceApiError("RECURRENCE_NOT_FOUND", "Recurrence not found", 404);
  if (error?.code === "55000") return new RecurrenceApiError("INVALID_TRANSITION", "Recurrence is ended or its recorded history prevents this change", 409);
  if (error?.code === "23505") return new RecurrenceApiError("OCCURRENCE_CONFLICT", "Occurrence or generated object is already associated", 409);
  if (error?.code === "22023" && error?.message === "invalid recurrence timezone") return new RecurrenceApiError("INVALID_TIMEZONE", "timezone must be a valid PostgreSQL timezone name");
  if (["22023", "22P02", "22007", "22008", "23502", "23503", "23514", "22003"].includes(error?.code)) return new RecurrenceApiError("VALIDATION_ERROR", "Recurrence data violates a validation rule");
  return new RecurrenceApiError("DATABASE_ERROR", "The recurrence operation could not be completed", 500);
}
const one = (data, error) => { if (error) throw translate(error); const row = Array.isArray(data) ? data[0] : data; if (!row) throw new RecurrenceApiError("RECURRENCE_NOT_FOUND", "Recurrence not found", 404); return row; };
const page = (data, error, limit) => { if (error) throw translate(error); const rows = data ?? []; return { rows: rows.slice(0, limit), hasMore: rows.length > limit }; };
export class SupabaseRecurrenceRepository {
  constructor(client) { this.client = client; }
  async create(value) {
    const { data, error } = await this.client.rpc("assistant_create_recurrence", {
      p_seed_object_id: value.seed_object_id, p_basis: value.basis, p_frequency: value.frequency,
      p_interval_count: value.interval_count, p_anchor_kind: value.anchor_kind ?? null,
      p_anchor_at: value.anchor_at ?? null, p_anchor_date: value.anchor_date ?? null,
      p_timezone: value.timezone ?? null, p_weekdays: value.weekdays ?? null,
      p_seed_occurrence_at: value.seed_occurrence_at ?? null, p_seed_occurrence_date: value.seed_occurrence_date ?? null,
    });
    return one(data, error);
  }
  async update(id, patch) { const { data, error } = await this.client.rpc("assistant_update_recurrence", { p_object_id: id, p_patch: patch }); return one(data, error); }
  async end(id) { const { data, error } = await this.client.rpc("assistant_end_recurrence", { p_object_id: id }); return one(data, error); }
  async get(id) { const { data, error } = await this.client.from("assistant_recurrences").select("*").eq("object_id", id).maybeSingle(); return one(data, error); }
  async list(options) { const { data, error } = await this.client.rpc("assistant_list_recurrences", { p_status: options.status ?? null, p_seed_object_id: options.seed_object_id ?? null, p_basis: options.basis ?? null, p_limit: options.limit + 1, p_offset: options.offset }); return page(data, error, options.limit); }
  async due(options) { const { data, error } = await this.client.rpc("assistant_list_due_recurrence_occurrences", { p_from_at: options.from_at ?? null, p_through_at: options.through_at ?? null, p_from_date: options.from_date ?? null, p_through_date: options.through_date ?? null, p_limit: options.limit + 1, p_offset: options.offset }); return page(data, error, options.limit); }
  async next(id, predecessor, completedAt) { const { data, error } = await this.client.rpc("assistant_next_after_completion", { p_object_id: id, p_completed_object_id: predecessor, p_completed_at: completedAt }); if (error) throw translate(error); return (data ?? [])[0] ?? null; }
  async record(id, value) { const { data, error } = await this.client.rpc("assistant_record_recurrence_occurrence", { p_object_id: id, p_sequence: value.sequence, p_occurrence_at: value.occurrence_at, p_occurrence_date: value.occurrence_date, p_generated_object_id: value.generated_object_id, p_completed_object_id: value.completed_object_id ?? null, p_completed_at: value.completed_at ?? null }); return one(data, error); }
}
