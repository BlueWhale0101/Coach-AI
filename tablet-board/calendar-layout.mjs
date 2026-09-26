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
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function minutesToPixels(minutes) {
  return (minutes / 60) * PIXELS_PER_HOUR;
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

export function layoutTimedEvents(events) {
  const normalized = events.map((event) => {
    const startMinute = parseTimeToMinutes(event.start);
    const endMinute = parseTimeToMinutes(event.end);
    return {
      ...event,
      startMinute,
      endMinute,
      durationMinute: Math.max(1, endMinute - startMinute),
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
        top: minutesToPixels(event.startMinute - DAY_START_MINUTE),
        height: Math.max(minutesToPixels(event.durationMinute), MIN_EVENT_HEIGHT),
        leftPercent: event.columnIndex * widthPercent,
        widthPercent,
        actualHeight: minutesToPixels(event.durationMinute),
      };
    });
  });
}

export function visibleAllDayItems(items, maxRows = 2) {
  return {
    visible: items.slice(0, maxRows),
    hiddenCount: Math.max(0, items.length - maxRows),
  };
}

export function hourLabels() {
  const labels = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    labels.push({
      hour,
      label: hour === 0 ? "12 AM" : hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`,
      top: minutesToPixels(hour * 60),
    });
  }
  return labels;
}
