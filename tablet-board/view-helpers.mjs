export const ROUTES = Object.freeze({
  board: "/tablet-board/",
  tasks: "/tablet-board/tasks",
  calendar: "/tablet-board/calendar",
  knowledge: "/tablet-board/knowledge",
});

export function routeFromPath(pathname = "/tablet-board/") {
  const clean = pathname.replace(/\/+$/, "") || "/tablet-board";
  if (clean === "/tablet-board") return "board";
  if (clean === "/tablet-board/tasks") return "tasks";
  if (clean === "/tablet-board/calendar") return "calendar";
  if (clean === "/tablet-board/knowledge") return "knowledge";
  return "board";
}

export function pathForRoute(route) {
  return ROUTES[route] ?? ROUTES.board;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfWeek(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  return utc;
}

export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function weekRange(weekStart) {
  return {
    start: isoDate(weekStart),
    endExclusive: isoDate(addDays(weekStart, 7)),
  };
}

export function computePaneHourPixels({ paneHeight, visibleHours, stickyHeight = 96, minimum = 44, maximum = 116 }) {
  const available = Number(paneHeight) - stickyHeight;
  const hours = Number(visibleHours);
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(hours) || hours <= 0) return minimum;
  return Math.round(Math.min(maximum, Math.max(minimum, available / hours)));
}

export function eventDateKey(event) {
  if (event.time_kind === "all_day") return event.start_date;
  return event.date;
}
