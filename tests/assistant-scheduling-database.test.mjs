import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "202609260001_assistant_object_registry_tasks_v0.sql",
  "20260926091121_assistant_tasks_v0_invoker_hardening.sql",
  "20260926093922_assistant_knowledge_v0.sql",
  "20260926095952_assistant_reminders_v0.sql",
  "20260926102646_assistant_scheduling_v0.sql",
];
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
for (const file of migrations) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const count = async (table) => (await one(`select count(*)::integer as n from public.${table}`)).n;
const rejects = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const create = (title, kind, starts, ends, zone, firstDate, lastDate, description = null) =>
  one("select * from public.assistant_create_schedule_event($1,$2,$3,$4,$5,$6,$7,$8)",
    [title, description, kind, starts, ends, zone, firstDate, lastDate]);
const timed = (title, starts = "2026-11-14T14:00:00+09:30", ends = "2026-11-14T15:00:00+09:30", zone = "Australia/Darwin", description = null) =>
  create(title, "timed", starts, ends, zone, null, null, description);
const allDay = (title, first = "2026-11-14", last = "2026-11-15", description = null) =>
  create(title, "all_day", null, null, null, first, last, description);
const update = (id, patch) => one("select * from public.assistant_update_schedule_event($1,$2::jsonb)", [id, JSON.stringify(patch)]);
const list = (status = null, timedStart = null, timedEnd = null, dateStart = null, dateEnd = null, limit = 50, offset = 0) =>
  rows("select * from public.assistant_list_schedule_events($1,$2,$3,$4,$5,$6,$7)",
    [status, timedStart, timedEnd, dateStart, dateEnd, limit, offset]);
const search = (query, status = null, limit = 50, offset = 0) =>
  rows("select * from public.assistant_search_schedule_events($1,$2,$3,$4)", [query, status, limit, offset]);

test("Scheduling PostgreSQL representation and capabilities", async (t) => {
  await t.test("atomic registry creation, valid timed/all-day events and strict shape", async () => {
    const timedEvent = await timed("Dentist", undefined, undefined, undefined, "Bring notes");
    assert.equal(timedEvent.status, "scheduled");
    assert.equal(timedEvent.time_kind, "timed");
    assert.equal(new Date(timedEvent.starts_at).toISOString(), "2026-11-14T04:30:00.000Z");
    assert.equal(timedEvent.timezone, "Australia/Darwin");
    assert.equal(timedEvent.start_date, null);
    assert.equal((await one("select object_type from public.assistant_objects where id=$1", [timedEvent.object_id])).object_type, "schedule_event");
    const day = await allDay("Wedding");
    assert.equal(new Date(day.start_date).toISOString().slice(0, 10), "2026-11-14");
    assert.equal(new Date(day.end_date).toISOString().slice(0, 10), "2026-11-15");
    assert.equal(day.starts_at, null);
    assert.equal(day.timezone, null);
    const before = await count("assistant_objects");
    await rejects(() => timed(" "), "23514");
    await rejects(() => timed("Invalid zone", undefined, undefined, "Mars/Olympus"), "22023");
    await rejects(() => create("No zone", "timed", "2026-11-14T14:00Z", "2026-11-14T15:00Z", null, null, null), "23514");
    await rejects(() => create("Mixed", "timed", "2026-11-14T14:00Z", "2026-11-14T15:00Z", "UTC", "2026-11-14", null), "23514");
    await rejects(() => timed("Zero", "2026-11-14T14:00Z", "2026-11-14T14:00Z"), "23514");
    await rejects(() => timed("Reverse", "2026-11-14T15:00Z", "2026-11-14T14:00Z"), "23514");
    await rejects(() => allDay("Zero day", "2026-11-14", "2026-11-14"), "23514");
    await rejects(() => allDay("Reverse day", "2026-11-15", "2026-11-14"), "23514");
    assert.equal(await count("assistant_objects"), before);
  });

  await t.test("registry type and stable identity are enforced", async () => {
    const [wrong] = await rows("insert into public.assistant_objects(object_type) values ('task') returning id");
    await rejects(() => rows(`insert into public.assistant_schedule_events
      (object_id,title,time_kind,start_date,end_date) values ($1,'Wrong','all_day','2026-11-14','2026-11-15')`, [wrong.id]), "23514");
    const event = await allDay("Right");
    await rejects(() => rows("update public.assistant_objects set object_type='task' where id=$1", [event.object_id]), "23514");
    await rejects(() => rows("update public.assistant_schedule_events set object_id=gen_random_uuid() where object_id=$1", [event.object_id]), "23514");
  });

  await t.test("scheduled title/description update and timed/all-day reschedule keep identity", async () => {
    const event = await timed("Dentist visit");
    const text = await update(event.object_id, { title: "Dentist moved", description: "Second floor" });
    assert.equal(text.title, "Dentist moved");
    assert.equal(text.description, "Second floor");
    assert.equal(text.object_id, event.object_id);
    assert.equal(new Date(text.created_at).getTime(), new Date(event.created_at).getTime());
    assert.ok(new Date(text.updated_at) >= new Date(event.updated_at));
    const moved = await update(event.object_id, { time_kind: "timed", starts_at: "2026-11-15T16:00:00Z", ends_at: "2026-11-15T17:00:00Z", timezone: "America/Los_Angeles" });
    assert.equal(new Date(moved.starts_at).toISOString(), "2026-11-15T16:00:00.000Z");
    assert.equal(moved.timezone, "America/Los_Angeles");
    const day = await allDay("Trip", "2026-11-16", "2026-11-18");
    const rescheduled = await update(day.object_id, { time_kind: "all_day", start_date: "2026-11-17", end_date: "2026-11-20" });
    assert.equal(new Date(rescheduled.start_date).toISOString().slice(0, 10), "2026-11-17");
    assert.equal(new Date(rescheduled.end_date).toISOString().slice(0, 10), "2026-11-20");
  });

  await t.test("kind conversions replace temporal fields atomically; incomplete conversion rolls back", async () => {
    const event = await timed("Convert me");
    for (const patch of [
      { time_kind: "all_day", start_date: "2026-11-14" },
      { start_date: "2026-11-14", end_date: "2026-11-15" },
      { time_kind: "all_day", start_date: "2026-11-14", end_date: "2026-11-15", starts_at: null },
    ]) {
      await rejects(() => update(event.object_id, patch), "22023");
      const current = await one("select * from public.assistant_schedule_events where object_id=$1", [event.object_id]);
      assert.equal(current.time_kind, "timed");
      assert.equal(current.start_date, null);
    }
    const day = await update(event.object_id, { time_kind: "all_day", start_date: "2026-11-14", end_date: "2026-11-15" });
    assert.equal(day.time_kind, "all_day");
    assert.equal(day.starts_at, null);
    assert.equal(day.timezone, null);
    const timedAgain = await update(event.object_id, { time_kind: "timed", starts_at: "2026-11-14T14:00:00Z", ends_at: "2026-11-14T15:00:00Z", timezone: "UTC" });
    assert.equal(timedAgain.time_kind, "timed");
    assert.equal(timedAgain.start_date, null);
    assert.equal(timedAgain.end_date, null);
    assert.equal(timedAgain.timezone, "UTC");
    for (const field of ["object_id", "status", "cancelled_at", "created_at", "updated_at", "unknown"]) {
      await rejects(() => update(event.object_id, { [field]: "x" }), "22023");
    }
  });

  await t.test("cancelled status and timestamp are consistent, terminal, and immutable", async () => {
    const event = await timed("Cancel me");
    await rejects(() => rows("update public.assistant_schedule_events set status='unknown' where object_id=$1", [event.object_id]), "23514");
    await rejects(() => rows("update public.assistant_schedule_events set status='cancelled' where object_id=$1", [event.object_id]), "23514");
    await rejects(() => rows("update public.assistant_schedule_events set cancelled_at=now() where object_id=$1", [event.object_id]), "23514");
    const cancelled = await one("select * from public.assistant_cancel_schedule_event($1)", [event.object_id]);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.cancelled_at);
    await rejects(() => one("select * from public.assistant_cancel_schedule_event($1)", [event.object_id]), "55000");
    await rejects(() => update(event.object_id, { title: "Again" }), "55000");
    await rejects(() => rows("update public.assistant_schedule_events set title='Direct' where object_id=$1", [event.object_id]), "55000");
    await rejects(() => one("select * from public.assistant_cancel_schedule_event(gen_random_uuid())"), "P0002");
  });

  await t.test("half-open overlap at timed and all-day boundaries with both windows", async () => {
    const timedIn = await timed("Overlap timed", "2026-12-01T10:00:00Z", "2026-12-01T11:00:00Z", "UTC");
    const timedBefore = await timed("Ends at start", "2026-12-01T09:00:00Z", "2026-12-01T10:00:00Z", "UTC");
    const timedAfter = await timed("Starts at end", "2026-12-01T11:00:00Z", "2026-12-01T12:00:00Z", "UTC");
    const dayIn = await allDay("Overlap date", "2026-12-01", "2026-12-02");
    const dayBefore = await allDay("Ends at date start", "2026-11-30", "2026-12-01");
    const dayAfter = await allDay("Starts at date end", "2026-12-02", "2026-12-03");
    const timedResults = await list(null, "2026-12-01T10:00:00Z", "2026-12-01T11:00:00Z");
    assert.ok(timedResults.some(x => x.object_id === timedIn.object_id));
    assert.ok(!timedResults.some(x => [timedBefore.object_id, timedAfter.object_id, dayIn.object_id].includes(x.object_id)));
    const dateResults = await list(null, null, null, "2026-12-01", "2026-12-02");
    assert.ok(dateResults.some(x => x.object_id === dayIn.object_id));
    assert.ok(!dateResults.some(x => [dayBefore.object_id, dayAfter.object_id, timedIn.object_id].includes(x.object_id)));
    const both = await list(null, "2026-12-01T10:00:00Z", "2026-12-01T11:00:00Z", "2026-12-01", "2026-12-02");
    assert.deepEqual(both.map(x => x.object_id), [dayIn.object_id, timedIn.object_id]);
  });

  await t.test("calendar order breaks local-date ties by kind, instant, creation, object ID", async () => {
    const targetDate = "2027-01-15";
    const later = await timed("Later", "2027-01-15T10:00:00Z", "2027-01-15T11:00:00Z", "UTC");
    const earlier = await timed("Earlier", "2027-01-15T08:00:00Z", "2027-01-15T09:00:00Z", "UTC");
    const day = await allDay("Whole day", targetDate, "2027-01-16");
    const result = await list(null, "2027-01-15T00:00:00Z", "2027-01-16T00:00:00Z", targetDate, "2027-01-16");
    assert.deepEqual(result.map(x => x.object_id), [day.object_id, earlier.object_id, later.object_id]);
    const idA = "00000000-0000-4000-8000-000000000011";
    const idB = "00000000-0000-4000-8000-000000000012";
    for (const id of [idB, idA]) {
      await rows("insert into public.assistant_objects(id,object_type) values ($1,'schedule_event')", [id]);
      await rows(`insert into public.assistant_schedule_events(object_id,title,time_kind,start_date,end_date,created_at)
        values ($1,'Tie','all_day','2027-02-01','2027-02-02','2026-09-26T00:00:00Z')`, [id]);
    }
    assert.deepEqual((await list(null, null, null, "2027-02-01", "2027-02-02")).map(x => x.object_id), [idA, idB]);
  });

  await t.test("search title/description, status and bounded pagination", async () => {
    const a = await timed("Museum visit", "2027-03-01T10:00Z", "2027-03-01T11:00Z", "UTC");
    const b = await allDay("Other event", "2027-03-02", "2027-03-03", "museum notes");
    const c = await timed("Museum cancelled", "2027-03-03T10:00Z", "2027-03-03T11:00Z", "UTC");
    await one("select * from public.assistant_cancel_schedule_event($1)", [c.object_id]);
    assert.deepEqual((await search("museum")).map(x => x.object_id), [a.object_id, b.object_id, c.object_id]);
    assert.deepEqual((await search("museum", "scheduled")).map(x => x.object_id), [a.object_id, b.object_id]);
    assert.deepEqual((await search("museum", "cancelled")).map(x => x.object_id), [c.object_id]);
    assert.deepEqual((await search("museum", null, 2, 0)).map(x => x.object_id), [a.object_id, b.object_id]);
    assert.deepEqual((await search("museum", null, 2, 2)).map(x => x.object_id), [c.object_id]);
    assert.equal((await search("museum", null, 9999)).length, 3);
    assert.deepEqual((await list("cancelled", "2027-03-03T00:00Z", "2027-03-04T00:00Z")).map(x => x.object_id), [c.object_id]);
  });

  await t.test("anon/authenticated cannot read table or invoke RPCs; service role can", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await rejects(() => rows("select * from public.assistant_schedule_events"), "42501");
        await rejects(() => allDay("Denied"), "42501");
        await rejects(() => update("10000000-0000-4000-8000-000000000001", { title: "Denied" }), "42501");
        await rejects(() => rows("select * from public.assistant_cancel_schedule_event(gen_random_uuid())"), "42501");
        await rejects(() => list(), "42501");
        await rejects(() => search("Denied"), "42501");
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try {
      const event = await allDay("Service role");
      assert.equal((await one("select title from public.assistant_schedule_events where object_id=$1", [event.object_id])).title, "Service role");
      const timedEvent = await timed("Service timed");
      assert.equal(timedEvent.timezone, "Australia/Darwin");
    } finally { await db.exec("reset role"); }
    const funcs = await rows(`select proname, prosecdef from pg_proc where proname in
      ('assistant_create_schedule_event','assistant_update_schedule_event','assistant_cancel_schedule_event',
       'assistant_list_schedule_events','assistant_search_schedule_events')`);
    assert.equal(funcs.length, 5);
    assert.ok(funcs.every(x => x.prosecdef === false));
    const target = await allDay("Remind target");
    const reminder = await one("select * from public.assistant_create_reminder($1,now())", [target.object_id]);
    assert.equal(reminder.target_object_id, target.object_id);
  });
  await db.close();
});
