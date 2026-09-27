import { DEFAULT_TIMEZONE, localDate } from "../tablet-board/data-provider.mjs";
import { addDays, isoDate, taskActionsForStatus } from "../tablet-board/view-helpers.mjs";

export const DESTINATIONS = ["today", "tasks", "calendar", "knowledge"];
export const phoneRoute = path => DESTINATIONS.includes(path.replace(/^\/phone\/?/, "").replace(/\/$/, ""))
  ? path.replace(/^\/phone\/?/, "").replace(/\/$/, "") : "today";
export const phonePath = route => route === "today" ? "/phone/" : `/phone/${route}`;
export const shiftDay = (key, days) => isoDate(addDays(new Date(`${key}T12:00:00Z`), days));
export const todayKey = (now = new Date()) => localDate(now, DEFAULT_TIMEZONE);
export const taskActions = task => taskActionsForStatus(task.status);

export function attentionTasks(snapshot) {
  const day = snapshot.metadata?.today ?? todayKey(new Date(snapshot.now));
  return snapshot.tasks.filter(task => task.pinned || task.deadlineLabel === "OVERDUE" ||
    (task.due_at && localDate(task.due_at, DEFAULT_TIMEZONE) === day) ||
    task.surface_reason === "actionable" || (task.not_before && Date.parse(task.not_before) <= Date.parse(snapshot.now)));
}

export function upcomingEvents(days, now, count = 4) {
  const current = Date.parse(now);
  return days.flatMap(day => [
    ...day.allDay.map(event => ({ ...event, day: day.date, allDay: true })),
    ...day.events.map(event => ({ ...event, day: day.date, allDay: false })),
  ]).filter(event => event.day > days[0]?.date && (event.allDay || Date.parse(event.ends_at) > current)).slice(0, count);
}

export function agendaForDay(events, dayKey) {
  const allDay = events.filter(event => event.time_kind === "all_day" && event.start_date <= dayKey && event.end_date > dayKey);
  const timed = events.filter(event => event.time_kind === "timed")
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return { allDay, timed };
}
