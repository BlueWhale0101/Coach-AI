import test from "node:test";
import assert from "node:assert/strict";
import { getFixtureBoardSnapshot, normalizeProjectionBoard, neutralCategory } from "../tablet-board/data-provider.mjs";
import { StagedMutationController } from "../tablet-board/mutation-staging.mjs";

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    setTimeout(fn) {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async runAll() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const fn of callbacks) await fn();
    },
    get size() {
      return timers.size;
    },
  };
}

test("projection normalization preserves sparse optional fields for the tablet board", () => {
  const snapshot = normalizeProjectionBoard({
    metadata: { now: "2026-09-27T07:30:00+09:30", timezone: "Australia/Darwin" },
    tasks: [
      { object_id: "10000000-0000-4000-8000-000000000001", title: "No due", description: null, due_at: null, not_before: null, pinned: false, category: null, tags: [] },
      { object_id: "10000000-0000-4000-8000-000000000002", title: "Due today", due_at: "2026-09-27T10:00:00+09:30", pinned: true, category: { object_id: "cat", name: "School", color: "#5DD39E", status: "active" }, tags: [{ name: "paperwork" }] },
    ],
    days: [
      { id: "today", date: "2026-09-27", all_day_events: [], timed_events: [] },
      { id: "tomorrow", date: "2026-09-28", all_day_events: [{ object_id: "event", title: "All day", start_date: "2026-09-28", end_date: "2026-09-29", category: null }], timed_events: [] },
    ],
  });
  assert.equal(snapshot.tasks[0].deadlineLabel, "");
  assert.deepEqual(snapshot.tasks[0].category, neutralCategory);
  assert.equal(snapshot.tasks[1].deadlineLabel, "TODAY");
  assert.deepEqual(snapshot.tasks[1].tags, ["paperwork"]);
  assert.equal(snapshot.days[1].allDay[0].category.color, neutralCategory.color);
});

test("fixture mode remains rich enough for local development", () => {
  const snapshot = getFixtureBoardSnapshot();
  assert.ok(snapshot.tasks.length >= 12);
  assert.ok(snapshot.tasks.some(task => task.deadlineLabel === ""));
  assert.ok(snapshot.tasks.some(task => task.deadlineLabel === "OVERDUE"));
  assert.equal(snapshot.days.length, 2);
});

test("staged completion undo cancels before commit", async () => {
  const timers = fakeTimers();
  let committed = 0;
  let restored = null;
  const staging = new StagedMutationController({ timers });
  staging.stage({
    restore: { tasks: ["before"] },
    commit: async () => { committed += 1; },
    onUndo: snapshot => { restored = snapshot; },
  });
  assert.equal(timers.size, 1);
  assert.deepEqual(staging.undo(), { tasks: ["before"] });
  await timers.runAll();
  assert.equal(committed, 0);
  assert.deepEqual(restored, { tasks: ["before"] });
});

test("staged completion commits after window and failed writes restore", async () => {
  const timers = fakeTimers();
  let committed = 0;
  const staging = new StagedMutationController({ timers });
  staging.stage({ restore: "before", commit: async () => { committed += 1; } });
  await timers.runAll();
  assert.equal(committed, 1);

  let failedRestore = null;
  staging.stage({
    restore: "restore-me",
    commit: async () => { throw new Error("nope"); },
    onFailure: snapshot => { failedRestore = snapshot; },
  });
  await timers.runAll();
  assert.equal(failedRestore, "restore-me");
});

test("staged pin/unpin shares the same undo vocabulary", async () => {
  const timers = fakeTimers();
  const calls = [];
  const staging = new StagedMutationController({ timers });
  staging.stage({ restore: { pinned: false }, commit: async () => calls.push("pin") });
  await timers.runAll();
  staging.stage({ restore: { pinned: true }, commit: async () => calls.push("unpin") });
  staging.undo();
  await timers.runAll();
  assert.deepEqual(calls, ["pin"]);
});
