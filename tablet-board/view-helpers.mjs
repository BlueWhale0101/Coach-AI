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

export function localDateKey(date = new Date(), timezone = "Australia/Darwin") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localTimeMinutes(date = new Date(), timezone = "Australia/Darwin") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function zonedMidnightUtc(date, timezone = "Australia/Darwin") {
  const at = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - at;
  return new Date(at - offset).toISOString();
}

export function startOfWeek(date = new Date(), timezone = "Australia/Darwin") {
  const utc = new Date(`${localDateKey(date, timezone)}T00:00:00Z`);
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

export function taskActionsForStatus(status) {
  if (status === "open") return ["complete", "pin", "edit", "cancel"];
  if (status === "completed" || status === "cancelled") return ["pin", "edit"];
  return [];
}
