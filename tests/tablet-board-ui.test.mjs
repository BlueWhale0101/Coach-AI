import test from "node:test";
import assert from "node:assert/strict";
import { getBoardSnapshot, categories } from "../tablet-board/data-provider.mjs";
import {
  PIXELS_PER_HOUR,
  layoutTimedEvents,
  parseTimeToMinutes,
  visibleAllDayItems,
} from "../tablet-board/calendar-layout.mjs";

test("tablet board fixtures stay rich enough to exercise the household UI", () => {
  const snapshot = getBoardSnapshot();
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
