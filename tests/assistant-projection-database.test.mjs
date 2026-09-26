import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
const migrationDir = new URL("../supabase/migrations/", import.meta.url);
for (const file of (await readdir(migrationDir)).filter(name => name.endsWith(".sql")).sort()) {
  await db.exec(await readFile(new URL(file, migrationDir), "utf8"));
}

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const task = (title, due = null, notBefore = null) =>
  one("select * from public.assistant_create_task($1,null,null,$2,$3)", [title, notBefore, due]);
const event = (title, starts, ends) =>
  one("select * from public.assistant_create_schedule_event($1,$2,'timed',$3,$4,'Australia/Darwin',null,null)", [title, `${title} details`, starts, ends]);
const allDay = (title, start, end) =>
  one("select * from public.assistant_create_schedule_event($1,$2,'all_day',null,null,null,$3,$4)", [title, `${title} details`, start, end]);

test("Household Board Projection V0 composes Assistant state without durable board tables", async t => {
  await t.test("task surfacing, category composition, tags, and calendar windows", async () => {
    const cat = await one("select * from public.assistant_create_category('School','#5DD39E',0)");
    const tag = await one("select * from public.assistant_create_tag('paperwork')");
    const pinned = await task("Pinned no due");
    const overdue = await task("Overdue task", "2026-09-26T22:00:00+09:30");
    const soon = await task("Due soon", "2026-09-29T09:00:00+09:30");
    const actionable = await task("Actionable no due");
    const hidden = await task("Future blocked", null, "2026-10-27T08:00:00+09:30");
    await rows("select * from public.assistant_pin_object($1)", [pinned.object_id]);
    await rows("select * from public.assistant_set_object_category($1,$2)", [pinned.object_id, cat.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [pinned.object_id, tag.object_id]);

    const todayEvent = await event("Morning event", "2026-09-27T08:00:00+09:30", "2026-09-27T08:30:00+09:30");
    const tomorrowEvent = await event("Tomorrow event", "2026-09-28T09:00:00+09:30", "2026-09-28T10:00:00+09:30");
    const span = await allDay("Multi-day", "2026-09-27", "2026-09-29");
    await rows("select * from public.assistant_set_object_category($1,$2)", [todayEvent.object_id, cat.object_id]);

    const board = await one(
      "select public.assistant_get_household_board($1,$2,$3,10) as board",
      ["2026-09-27", "Australia/Darwin", "2026-09-27T07:30:00+09:30"]
    );
    const data = board.board;

    assert.equal(data.metadata.timezone, "Australia/Darwin");
    assert.equal(data.metadata.today, "2026-09-27");
    assert.equal(data.metadata.tomorrow, "2026-09-28");
    assert.deepEqual(data.tasks.map(item => item.object_id), [pinned.object_id, overdue.object_id, soon.object_id, actionable.object_id]);
    assert.equal(data.tasks.some(item => item.object_id === hidden.object_id), false);
    assert.equal(data.tasks[0].due_at, null);
    assert.equal(data.tasks[0].pinned, true);
    assert.equal(data.tasks[0].category.object_id, cat.object_id);
    assert.deepEqual(data.tasks[0].tags.map(item => item.name), ["paperwork"]);
    assert.equal(data.tasks.find(item => item.object_id === actionable.object_id).category, null);
    assert.deepEqual(data.tasks.map(item => item.surface_reason), ["pinned", "overdue", "due_soon", "actionable"]);

    const [today, tomorrow] = data.days;
    assert.equal(today.id, "today");
    assert.equal(tomorrow.id, "tomorrow");
    assert.equal(today.timed_events[0].object_id, todayEvent.object_id);
    assert.equal(today.timed_events[0].start_time, "08:00");
    assert.equal(today.timed_events[0].category.object_id, cat.object_id);
    assert.equal(tomorrow.timed_events[0].object_id, tomorrowEvent.object_id);
    assert.deepEqual(today.all_day_events.map(item => item.object_id), [span.object_id]);
    assert.deepEqual(tomorrow.all_day_events.map(item => item.object_id), [span.object_id]);
  });

  await t.test("empty states, security posture, and existing contracts", async () => {
    const empty = await one(
      "select public.assistant_get_household_board($1,$2,$3,10) as board",
      ["2030-01-01", "Australia/Darwin", "2030-01-01T07:30:00+09:30"]
    );
    assert.deepEqual(empty.board.days.map(day => day.timed_events.length), [0, 0]);

    const funcs = await rows("select proname,prosecdef from pg_proc where proname in ('assistant_get_household_board','assistant_household_board_day')");
    assert.equal(funcs.length, 2);
    assert.ok(funcs.every(fn => !fn.prosecdef));
    assert.equal((await one("select count(*)::integer n from pg_tables where tablename='assistant_today'")).n, 0);

    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(
          () => rows("select public.assistant_get_household_board(null,'Australia/Darwin',now(),15)"),
          error => error.code === "42501"
        );
      } finally {
        await db.exec("reset role");
      }
    }

    await db.exec("set role service_role");
    try {
      const result = await one("select public.assistant_get_household_board(null,'Australia/Darwin',now(),15) as board");
      assert.ok(result.board.metadata);
    } finally {
      await db.exec("reset role");
    }
    assert.equal((await one("select * from public.assistant_create_knowledge('Projection doc','Protected module still works')")).status, "active");
    assert.equal((await one("select * from public.assistant_create_task('Protected task still works')")).status, "open");
  });
});
