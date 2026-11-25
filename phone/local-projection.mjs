import { onDay } from "../tablet-board/view-helpers.mjs";
import { timeLabel, DEFAULT_TIMEZONE } from "../tablet-board/data-provider.mjs";
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

export function cachedEvents(projection, day, zone = projection?.timezone) {
  if (!projection || (zone === projection.timezone && (day < projection.windowStart || day >= projection.windowEnd))) return null;
  const rows = projection.events.filter(e => onDay(e, day, zone)).map(e =>
    e.starts_at ? { ...e, start: timeLabel(e.starts_at, zone), end: timeLabel(e.ends_at, zone) } : e);
  if (!rows.length && (day < projection.windowStart || day >= projection.windowEnd)) return null;
  return rows;
}

export function provisionalToday(projection, zone, now = new Date()) {
  const today = todayKey(now, zone);
  const days = Array.from({ length: 4 }, (_, i) => {
    const date = shiftDay(today, i);
    const events = cachedEvents(projection, date, zone) ?? [];
    return { date, events: events.filter(e => e.time_kind === "timed"), allDay: events.filter(e => e.time_kind === "all_day") };
  });
  return { provisional: true, timezone: zone, metadata: { today }, now: now.toISOString(), tasks: [], days };
}

export async function refreshPhoneProjection({ services, store, timezone = DEFAULT_TIMEZONE, current = () => true, day = todayKey(new Date(), timezone), now = new Date().toISOString() }) {
  const window = projectionWindow(day);
  const [today, openTasks, categories, tags, events] = await Promise.all([
    services.getPhoneTodaySnapshot(timezone),
    services.listTaskView({ status: "open", limit: 80, timezone }),
    services.listCategories(),
    services.listTags(),
    services.listWeekEvents({ weekStart: window.start, weekEnd: window.end, timezone }),
  ]);
  const projection = {
    schema: PHONE_CACHE_SCHEMA, timezone, cachedAt: now,
    windowStart: window.start, windowEnd: window.end,
    today, openTasks, categories, tags, events,
  };
  if (!current()) return null;
  if (today.timezone !== timezone || today.metadata?.today !== day) throw new Error("Unexpected projection time zone");
  await store.write(projection, current);
  return projection;
}
