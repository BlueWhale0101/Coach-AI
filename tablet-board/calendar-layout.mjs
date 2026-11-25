import { addDays, isoDate, localTimeMinutes, zonedMidnightUtc } from "./view-helpers.mjs";

export const DAY_START_MINUTE = 0;
export const DAY_END_MINUTE = 24 * 60;
export const PIXELS_PER_HOUR = 84;
export const MIN_EVENT_HEIGHT = 28;

export function parseTimeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function formatTime(time) {
  const minutes = parseTimeToMinutes(time);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const displayHour = ((hour + 11) % 12) + 1;
  const suffix = hour % 24 >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function minutesToPixels(minutes, pixelsPerHour = PIXELS_PER_HOUR) {
  return (minutes / 60) * pixelsPerHour;
}

function overlaps(a, b) {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

function buildOverlapGroups(events) {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const groups = [];
  let current = [];
  let currentEnd = -1;

  for (const event of sorted) {
    if (!current.length || event.startMinute < currentEnd) {
      current.push(event);
      currentEnd = Math.max(currentEnd, event.endMinute);
    } else {
      groups.push(current);
      current = [event];
      currentEnd = event.endMinute;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function assignColumns(group) {
  const columns = [];
  return group.map((event) => {
    let columnIndex = columns.findIndex((columnEnd) => columnEnd <= event.startMinute);
    if (columnIndex === -1) {
      columnIndex = columns.length;
      columns.push(event.endMinute);
    } else {
      columns[columnIndex] = event.endMinute;
    }

    const concurrentCount = Math.max(
      1,
      group.filter((candidate) => overlaps(event, candidate)).length,
      columns.length,
    );

    return { ...event, columnIndex, columnCount: concurrentCount };
  });
}

export function layoutTimedEvents(events, pixelsPerHour = PIXELS_PER_HOUR) {
  const normalized = events.map((event) => {
    const startMinute = event.startMinute ?? parseTimeToMinutes(event.start);
    const endMinute = event.endMinute ?? parseTimeToMinutes(event.end);
    return {
      ...event,
      startMinute,
      endMinute,
      durationMinute: endMinute - startMinute,
    };
  });

  return buildOverlapGroups(normalized).flatMap((group) => {
    const assigned = assignColumns(group);
    const maxColumns = Math.max(...assigned.map((event) => event.columnIndex + 1), 1);
    return assigned.map((event) => {
      const columnCount = Math.max(event.columnCount, maxColumns);
      const widthPercent = 100 / columnCount;
      return {
        ...event,
        top: minutesToPixels(event.startMinute - DAY_START_MINUTE, pixelsPerHour),
        height: Math.min(minutesToPixels((event.bandEnd ?? Infinity) - event.startMinute, pixelsPerHour),
            Math.max(minutesToPixels(event.durationMinute, pixelsPerHour), MIN_EVENT_HEIGHT)),
        leftPercent: event.columnIndex * widthPercent,
        widthPercent,
        actualHeight: minutesToPixels(event.durationMinute, pixelsPerHour),
      };
    });
  });
}

// Keep the existing wall-clock grid. Each band maps elapsed time continuously
// to that grid; DST gaps leave blank space and folded hours share lanes.
const bandsByDay = new Map();
function dayBands(day, zone) {
  const key = zone + "/" + day;
  if (bandsByDay.has(key)) return bandsByDay.get(key);
  const next = isoDate(addDays(new Date(day + "T00:00:00Z"), 1));
  const first = Date.parse(zonedMidnightUtc(day, zone));
  const end = Date.parse(zonedMidnightUtc(next, zone));
  const minute = localTimeMinutes(first, zone);
  const continuous = ms => localTimeMinutes(ms, zone) === minute + Math.floor((ms - first) / 60000);
  let bands = [{ first, end, minute }];
  if (end > first && !continuous(end - 1)) {
    // A civil day has at most one offset transition. Locate its first instant.
    let lo = first, hi = end - 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (continuous(mid)) lo = mid; else hi = mid;
    }
    const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" });
    const name = ms => offset.formatToParts(ms).find(part => part.type === "timeZoneName").value;
    bands = [{ first, end: hi, minute, offset: name(first) },
      { first: hi, end, minute: localTimeMinutes(hi, zone), offset: name(hi) }];
  }
  if (bandsByDay.size >= 16) bandsByDay.delete(bandsByDay.keys().next().value);
  bandsByDay.set(key, bands);
  return bands;
}

function clockLabel(minute) {
  return String(Math.floor(minute / 60)).padStart(2, "0") + ":" +
    String(Math.floor(minute) % 60).padStart(2, "0");
}

export function layoutDayEvents(events, day, zone, pixelsPerHour) {
  if (!events.length) return [];
  const pieces = events.flatMap(event => {
    if (!event.starts_at) return [event]; // Clock-only demonstration fixtures.
    const start = Date.parse(event.starts_at), end = Date.parse(event.ends_at);
    return dayBands(day, zone).flatMap(band => {
      const from = Math.max(start, band.first), until = Math.min(end, band.end);
      if (until <= from) return [];
      const startMinute = band.minute + (from - band.first) / 60000;
      const endMinute = startMinute + (until - from) / 60000;
      return [{ ...event, startMinute, endMinute, start: clockLabel(startMinute), end: clockLabel(endMinute),
        bandEnd: band.minute + (band.end - band.first) / 60000, offset: band.offset }];
    });
  });
  return layoutTimedEvents(pieces, pixelsPerHour);
}

export function visibleAllDayItems(items, maxRows = 2) {
  return {
    visible: items.slice(0, maxRows),
    hiddenCount: Math.max(0, items.length - maxRows),
  };
}

export function hourLabels(pixelsPerHour = PIXELS_PER_HOUR) {
  const labels = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    labels.push({
      hour,
      label: hour === 0 ? "12 AM" : hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`,
      top: minutesToPixels(hour * 60, pixelsPerHour),
    });
  }
  return labels;
}