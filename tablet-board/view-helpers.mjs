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

const dateFormatters = new Map();
export function localDateKey(date = new Date(), timezone = "Australia/Darwin") {
  if (!dateFormatters.has(timezone)) dateFormatters.set(timezone,
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }));
  const parts = dateFormatters.get(timezone).formatToParts(date);
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
  // Find the first instant of this civil date, including when local midnight is skipped.
  let lo = at - 36 * 3600000, hi = at + 36 * 3600000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateKey(mid, timezone) < date) lo = mid; else hi = mid;
  }
  return new Date(hi).toISOString();
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

export function bindTaskDoubleTap(card, task, { full, complete, cancelClick }) {
  if (full && task.status !== "open") return;
  card.addEventListener("dblclick", event => {
    event.preventDefault();
    cancelClick();
    complete(task);
  });
}

export const householdZone = "Australia/Darwin";
export function validZone(zone) {
  if (typeof zone !== "string" || !zone || /^[+-]/.test(zone)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
}
export function deviceZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (validZone(zone)) return zone;
  } catch {}
  return householdZone;
}
export function onDay(event, day, zone) {
  if (event.time_kind === "all_day") return event.start_date <= day && event.end_date > day;
  if (!event.starts_at) return event.date === day; // fixture-only rows
  return localDateKey(new Date(event.starts_at), zone) <= day &&
    localDateKey(new Date(Date.parse(event.ends_at) - 1), zone) >= day;
}
