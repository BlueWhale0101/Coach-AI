import assert from "node:assert/strict";
import test from "node:test";
import { expectedToolSequenceByBehavioralFixture } from "../assistant/mcp/adapters.mjs";

test("golden behavioral specifications encode intended Assistant.AI tool selection", () => {
  const cases = expectedToolSequenceByBehavioralFixture();
  assert.equal(cases.length, 15);

  const byCase = new Map(cases.map((entry) => [entry.case, entry]));
  assert.deepEqual(byCase.get(1).expected_tools, ["create_task"]);
  assert.match(byCase.get(1).notes, /No due date/);

  assert.deepEqual(byCase.get(2).expected_tools, ["set_recurrence"]);
  assert.match(byCase.get(2).notes, /no duplicate/i);

  assert.deepEqual(byCase.get(3).expected_tools, ["remember"]);
  assert.match(byCase.get(3).notes, /not Task/);

  assert.deepEqual(byCase.get(4).expected_tools, ["create_task", "set_reminder"]);
  assert.match(byCase.get(4).notes, /No fake Wednesday due date/);

  assert.deepEqual(byCase.get(5).expected_tools, ["create_task", "set_reminder"]);
  assert.match(byCase.get(5).notes, /Friday due_at/);

  assert.deepEqual(byCase.get(6).expected_tools, ["find_tasks", "pin"]);
  assert.deepEqual(byCase.get(7).expected_tools, ["find_tasks", "cancel_task"]);
  assert.match(byCase.get(7).notes, /Clarify/);

  assert.deepEqual(byCase.get(8).expected_tools, ["find_events"]);
  assert.deepEqual(byCase.get(9).expected_tools, ["create_event"]);
  assert.match(byCase.get(9).notes, /not Task/);

  assert.deepEqual(byCase.get(10).expected_tools, ["set_recurrence"]);
  assert.deepEqual(byCase.get(11).expected_tools, ["create_task"]);
  assert.deepEqual(byCase.get(12).expected_tools, ["set_category"]);
  assert.deepEqual(byCase.get(13).expected_tools, ["set_tags"]);
  assert.match(byCase.get(13).notes, /no partial/i);

  assert.deepEqual(byCase.get(14).expected_tools, ["find_events", "update_event"]);
  assert.deepEqual(byCase.get(15).expected_tools, ["find_tasks", "find_events"]);
  assert.match(byCase.get(15).notes, /no terminal mutation/i);
});
