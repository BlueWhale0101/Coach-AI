import { ProjectionApiError } from "./projection-api.mjs";

function translate(error) {
  if (error?.code === "22023" && error.message === "invalid projection timezone") {
    return new ProjectionApiError("INVALID_TIMEZONE", "timezone must be a valid PostgreSQL timezone name");
  }
  if (["22023", "22P02", "22007", "22008"].includes(error?.code)) {
    return new ProjectionApiError("VALIDATION_ERROR", "Projection parameters violate a validation rule");
  }
  return new ProjectionApiError("DATABASE_ERROR", "The projection could not be loaded", 500);
}

export class SupabaseProjectionRepository {
  constructor(client) {
    this.client = client;
  }

  async getHouseholdBoard(options) {
    const { data, error } = await this.client.rpc("assistant_get_household_board", {
      p_display_date: options.display_date ?? null,
      p_timezone: options.timezone,
      p_now: options.now ?? null,
      p_task_limit: options.task_limit,
    });
    if (error) throw translate(error);
    return data;
  }
}
