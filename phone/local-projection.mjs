import { DEFAULT_TIMEZONE } from "../tablet-board/data-provider.mjs";
import { shiftDay, todayKey } from "./view-model.mjs";
import { PHONE_CACHE_SCHEMA } from "./cache.mjs";

const WINDOW_PAST_DAYS = 1;
const WINDOW_FUTURE_DAYS = 7;

export function projectionWindow(day = todayKey()) {
  return { start: shiftDay(day, -WINDOW_PAST_DAYS), end: shiftDay(day, WINDOW_FUTURE_DAYS + 1) };
}

export function cachedTasks(projection, { query = "", status = "open", categoryId = "", tagId = "" } = {}) {
  if (!projection || !["open", "all"].includes(status)) return null;
  const needle = query.trim().toLowerCase();
  return projection.openTasks.filter(task => (!needle || `${task.title} ${task.description}`.toLowerCase().includes(needle)) &&
    (!categoryId || task.category?.id === categoryId) &&
    (!tagId || task.tagObjects?.some(tag => tag.object_id === tagId)));
}

export function cachedEvents(projection, day) {
  if (!projection || day < projection.windowStart || day >= projection.windowEnd) return null;
  return projection.events.filter(event => event.time_kind === "timed"
    ? event.date === day
    : event.start_date <= day && event.end_date > day);
}

export async function refreshPhoneProjection({ services, store, day = todayKey(), now = new Date().toISOString() }) {
  const window = projectionWindow(day);
  const [today, openTasks, categories, tags, events] = await Promise.all([
    services.getPhoneTodaySnapshot(),
    services.listTaskView({ status: "open", limit: 80 }),
    services.listCategories(),
    services.listTags(),
    services.listWeekEvents({ weekStart: window.start, weekEnd: window.end, timezone: DEFAULT_TIMEZONE }),
  ]);
  const projection = {
    schema: PHONE_CACHE_SCHEMA, timezone: DEFAULT_TIMEZONE, cachedAt: now,
    windowStart: window.start, windowEnd: window.end,
    today, openTasks, categories, tags, events,
  };
  await store.write(projection);
  return projection;
}
