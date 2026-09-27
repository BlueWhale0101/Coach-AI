import test from "node:test";
import assert from "node:assert/strict";
import { getFixtureBoardSnapshot, categories } from "../tablet-board/data-provider.mjs";
import {
  PIXELS_PER_HOUR,
  layoutTimedEvents,
  parseTimeToMinutes,
  visibleAllDayItems,
} from "../tablet-board/calendar-layout.mjs";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_KEY,
  loadDisplaySettings,
  normalizeDisplaySettings,
  pixelsPerHourFor,
  resetDisplaySettings,
  saveDisplaySettings,
} from "../tablet-board/display-settings.mjs";
import {
  computePaneHourPixels,
  pathForRoute,
  routeFromPath,
  localDateKey,
  localTimeMinutes,
  startOfWeek,
  weekRange,
  zonedMidnightUtc,
} from "../tablet-board/view-helpers.mjs";

test("tablet board fixtures stay rich enough to exercise the household UI", () => {
  const snapshot = getFixtureBoardSnapshot();
  assert.ok(snapshot.tasks.length >= 12);
  assert.ok(Object.keys(categories).length >= 5);
  assert.ok(snapshot.tasks.some((task) => task.deadlineLabel === ""));
  assert.ok(snapshot.tasks.some((task) => task.deadlineLabel === "OVERDUE"));
  assert.ok(snapshot.tasks.some((task) => task.deadlineLabel === "TODAY"));
  assert.ok(snapshot.tasks.some((task) => task.pinned));
  assert.equal(snapshot.days.length, 2);
  assert.ok(snapshot.days[0].events.length >= 8);
  assert.ok(snapshot.days[1].events.length >= 5);
});

test("calendar layout preserves proportional time and minimum short-event height", () => {
  const [shortEvent, longEvent] = layoutTimedEvents([
    { id: "short", title: "Tiny", start: "10:00", end: "10:12", categoryId: "health" },
    { id: "long", title: "Long", start: "12:00", end: "13:30", categoryId: "work" },
  ]);

  assert.equal(parseTimeToMinutes("07:00"), 420);
  assert.equal(longEvent.height, PIXELS_PER_HOUR * 1.5);
  assert.ok(shortEvent.height > shortEvent.actualHeight);
  assert.equal(shortEvent.top, (10 * 60 / 60) * PIXELS_PER_HOUR);
});

test("calendar layout can scale visible-hour density without changing temporal order", () => {
  const [event] = layoutTimedEvents([
    { id: "morning", title: "Morning", start: "07:00", end: "08:00", categoryId: "home" },
  ], 56);

  assert.equal(event.top, 7 * 56);
  assert.equal(event.height, 56);
  assert.equal(pixelsPerHourFor({ ...DEFAULT_DISPLAY_SETTINGS, visibleHours: 12 }), 56);
});

test("overlapping timed events divide horizontal space", () => {
  const events = layoutTimedEvents([
    { id: "a", title: "A", start: "09:00", end: "10:00", categoryId: "work" },
    { id: "b", title: "B", start: "09:15", end: "09:45", categoryId: "home" },
    { id: "c", title: "C", start: "09:20", end: "09:55", categoryId: "health" },
  ]);

  assert.deepEqual(events.map((event) => event.columnIndex).sort(), [0, 1, 2]);
  assert.ok(events.every((event) => event.widthPercent <= 34));
});

test("all-day events expose two rows and summarize overflow", () => {
  const result = visibleAllDayItems([
    { id: "one" },
    { id: "two" },
    { id: "three" },
  ]);

  assert.equal(result.visible.length, 2);
  assert.equal(result.hiddenCount, 1);
});

test("display settings default, clamp, persist, and reset locally", () => {
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };

  assert.deepEqual(loadDisplaySettings(localStorage), DEFAULT_DISPLAY_SETTINGS);

  const saved = saveDisplaySettings({
    textScale: 500,
    taskSplitPercent: 35.64,
    visibleHours: 9,
    startHour: 30,
    todayWidthPercent: 90,
    categoryTint: "loud",
  }, localStorage);

  assert.deepEqual(saved, {
    textScale: 130,
    taskSplitPercent: 35.6,
    visibleHours: 8,
    startHour: 18,
    todayWidthPercent: 72,
    categoryTint: "medium",
  });
  assert.equal(JSON.parse(storage.get(DISPLAY_SETTINGS_KEY)).taskSplitPercent, 35.6);
  assert.deepEqual(loadDisplaySettings(localStorage), saved);
  assert.deepEqual(resetDisplaySettings(localStorage), DEFAULT_DISPLAY_SETTINGS);
  assert.equal(storage.has(DISPLAY_SETTINGS_KEY), false);
});

test("display settings clamp task width while preserving divider precision", () => {
  assert.equal(normalizeDisplaySettings({ taskSplitPercent: 29.94 }).taskSplitPercent, 30);
  assert.equal(normalizeDisplaySettings({ taskSplitPercent: 48.19 }).taskSplitPercent, 48);
  assert.equal(normalizeDisplaySettings({ taskSplitPercent: 42.37 }).taskSplitPercent, 42.4);
});

test("display settings preserve supported tablet defaults", () => {
  const settings = normalizeDisplaySettings({});
  assert.equal(settings.taskSplitPercent, 36);
  assert.equal(100 - settings.taskSplitPercent, 64);
  assert.equal(settings.todayWidthPercent, 62);
  assert.equal(settings.visibleHours, 8);
  assert.equal(settings.startHour, 7);
});

test("tablet routes support direct navigation and history targets", () => {
  assert.equal(routeFromPath("/tablet-board/"), "board");
  assert.equal(routeFromPath("/tablet-board/tasks"), "tasks");
  assert.equal(routeFromPath("/tablet-board/calendar/"), "calendar");
  assert.equal(routeFromPath("/tablet-board/knowledge"), "knowledge");
  assert.equal(routeFromPath("/tablet-board/missing"), "board");
  assert.equal(pathForRoute("tasks"), "/tablet-board/tasks");
});

test("board calendar hour scale is derived from the visible pane height", () => {
  assert.equal(computePaneHourPixels({ paneHeight: 736, visibleHours: 8 }), 80);
  assert.equal(computePaneHourPixels({ paneHeight: 736, visibleHours: 12 }), 53);
  assert.equal(computePaneHourPixels({ paneHeight: 260, visibleHours: 12 }), 44);
});

test("calendar week helpers use a seven day exclusive range", () => {
  const start = startOfWeek(new Date("2026-09-30T12:00:00Z"));
  assert.equal(weekRange(start).start, "2026-09-27");
  assert.equal(weekRange(start).endExclusive, "2026-10-04");
});

test("calendar boundaries and current day follow Darwin rather than UTC or browser locale", () => {
  const instant = new Date("2026-09-26T16:00:00Z"); // Sunday 01:30 in Darwin
  assert.equal(weekRange(startOfWeek(instant)).start, "2026-09-27");
  assert.equal(localDateKey(instant), "2026-09-27");
  assert.equal(localTimeMinutes(instant), 90);
  assert.equal(zonedMidnightUtc("2026-09-27"), "2026-09-26T14:30:00.000Z");
  assert.equal(zonedMidnightUtc("2026-10-04"), "2026-10-03T14:30:00.000Z");
});
