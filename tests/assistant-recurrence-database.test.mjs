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
const day = value => value?.toISOString().slice(0, 10);
const instant = value => value?.toISOString();
const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);
const count = async table => (await one(`select count(*)::integer n from public.${table}`)).n;
const task = async () => one("select * from public.assistant_create_task('Series member')");
const event = async () => one("select * from public.assistant_create_schedule_event('Series event',null,'all_day',null,null,null,'2026-01-31','2026-02-01')");
const make = async ({ seed, basis = "calendar", frequency = "daily", interval = 1, kind = "date", at = null, date = "2026-01-31", timezone = null, weekdays = null, seedAt = at, seedDate = date } = {}) => {
  const owner = seed ?? await task();
  return one("select * from public.assistant_create_recurrence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [owner.object_id, basis, frequency, interval, kind, at, date, timezone, weekdays, seedAt, seedDate]);
};
const calendar = async (id, sequence) => one("select * from public.assistant_recurrence_position($1,$2)", [id, sequence]);
const due = (fromAt = null, throughAt = null, fromDate = null, throughDate = null, limit = 50, offset = 0) =>
  rows("select * from public.assistant_list_due_recurrence_occurrences($1,$2,$3,$4,$5,$6)", [fromAt, throughAt, fromDate, throughDate, limit, offset]);
const record = (id, sequence, position, generated, predecessor = null, completedAt = null) =>
  one("select * from public.assistant_record_recurrence_occurrence($1,$2,$3,$4,$5,$6,$7)",
    [id, sequence, position.occurrence_at ?? null, position.occurrence_date ?? null, generated.object_id, predecessor, completedAt]);
const next = (id, predecessor, completedAt) =>
  rows("select * from public.assistant_next_after_completion($1,$2,$3)", [id, predecessor, completedAt]);

test("Recurrence PostgreSQL contract", async t => {
  await t.test("atomic registry, seed ledger, types, rule shape and rollback", async () => {
    const owner = await task();
    const r = await make({ seed: owner });
    assert.equal((await one("select object_type from public.assistant_objects where id=$1", [r.object_id])).object_type, "recurrence");
    assert.deepEqual((await one("select sequence,generated_object_id,occurrence_date from public.assistant_recurrence_occurrences where recurrence_object_id=$1", [r.object_id])).sequence, 0);
    assert.equal((await one("select generated_object_id from public.assistant_recurrence_occurrences where recurrence_object_id=$1", [r.object_id])).generated_object_id, owner.object_id);
    await rejects(() => rows("update public.assistant_objects set object_type='knowledge' where id=$1", [r.object_id]), "23514");
    await rejects(() => rows("update public.assistant_objects set object_type='knowledge' where id=$1", [owner.object_id]), "23514");
    const before = await count("assistant_objects");
    const invalidOwner = await one("insert into public.assistant_objects(object_type) values('knowledge') returning id");
    const afterOwner = await count("assistant_objects");
    await rejects(() => make({ seed: { object_id: invalidOwner.id } }), "22023");
    assert.equal(await count("assistant_objects"), afterOwner);
    await rejects(() => make({ interval: 0 }), "23514");
    await rejects(() => make({ seedDate: "2026-02-01" }), "22023");
    await rejects(() => make({ kind: "instant", at: "2026-01-31T10:00Z", date: null, timezone: "Mars/Olympus", seedDate: null }), "22023");
    await rejects(() => make({ kind: "instant", at: "2026-01-31T10:00Z", date: null, seedDate: null }), "23514");
    await rejects(() => make({ kind: "date", timezone: "UTC" }), "23514");
    assert.ok(await count("assistant_objects") > before); // The explicit test seeds were created; failed RPCs left no recurrence identities.
    assert.equal(await count("assistant_recurrences"), 1);
    const schedule = await event();
    const scheduled = await make({ seed: schedule });
    assert.equal(scheduled.seed_object_id, schedule.object_id);
    await rejects(async () => make({ seed: await event(), basis: "after_completion", kind: null, at: null, date: null, timezone: "UTC", seedAt: "2026-01-31T10:00Z", seedDate: null }), "22023");
    await rejects(() => make({ seed: owner }), "23505");
  });

  await t.test("daily, weekly selections and N-week anchor, monthly clamps and yearly leap clamp", async () => {
    const daily = await make({ date: "2026-03-07" });
    assert.equal(day((await calendar(daily.object_id, 1)).occurrence_date), "2026-03-08");
    const weekly = await make({ frequency: "weekly", interval: 2, date: "2026-09-28", weekdays: [5, 1, 3] });
    assert.deepEqual(weekly.weekdays, [1, 3, 5]);
    const weeklyDates = [];
    for (let i = 1; i <= 6; i++) weeklyDates.push(day((await calendar(weekly.object_id, i)).occurrence_date));
    assert.deepEqual(weeklyDates, ["2026-09-30", "2026-10-02", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-26"]);
    const weeklySingle = await make({ frequency: "weekly", interval: 2, date: "2026-09-28" });
    assert.equal(day((await calendar(weeklySingle.object_id, 1)).occurrence_date), "2026-10-12");
    for (const days of [[], [0], [8], [1, 1], [2]]) {
      await rejects(() => make({ frequency: "weekly", date: "2026-09-28", weekdays: days }), "22023");
    }
    await rejects(() => make({ weekdays: [1] }), "22023");
    for (const [anchor, expected] of [["2026-01-29", "2026-02-28"], ["2026-01-30", "2026-02-28"], ["2026-01-31", "2026-02-28"], ["2024-01-31", "2024-02-29"]]) {
      const r = await make({ frequency: "monthly", date: anchor });
      assert.equal(day((await calendar(r.object_id, 1)).occurrence_date), expected);
      assert.equal(day((await calendar(r.object_id, 2)).occurrence_date), anchor.slice(0, 4) + "-03-" + anchor.slice(8));
    }
    const leap = await make({ frequency: "yearly", date: "2024-02-29" });
    assert.deepEqual(await Promise.all([1, 2, 3, 4].map(async i => day((await calendar(leap.object_id, i)).occurrence_date))), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  await t.test("instant wall time and PostgreSQL DST gap/fold policy", async () => {
    const gap = await make({ kind: "instant", at: "2026-03-07T07:30:00Z", date: null, seedDate: null, timezone: "America/New_York" });
    assert.equal(instant((await calendar(gap.object_id, 1)).occurrence_at), "2026-03-08T07:30:00.000Z"); // 02:30 nonexistent -> 03:30 EDT
    assert.equal(instant((await calendar(gap.object_id, 2)).occurrence_at), "2026-03-09T06:30:00.000Z"); // original 02:30 restored
    const fold = await make({ kind: "instant", at: "2026-10-31T05:30:00Z", date: null, seedDate: null, timezone: "America/New_York" });
    assert.equal(instant((await calendar(fold.object_id, 1)).occurrence_at), "2026-11-01T06:30:00.000Z"); // ambiguous 01:30 -> EST
    const weekly = await make({ kind: "instant", frequency: "weekly", at: "2026-03-02T12:00:00Z", date: null, seedDate: null, timezone: "America/New_York" });
    assert.equal(instant((await calendar(weekly.object_id, 1)).occurrence_at), "2026-03-09T11:00:00.000Z");
  });

  await t.test("missing due positions, bounds, page order, recording, conflicts and immutable ledger", async () => {
    const r = await make({ frequency: "daily", date: "2026-06-01" });
    const all = await due(null, null, "2026-06-02", "2026-06-04", 100);
    assert.deepEqual(all.filter(x => x.recurrence_object_id === r.object_id).map(x => x.sequence), [1, 2, 3]);
    assert.deepEqual(all, await due(null, null, "2026-06-02", "2026-06-04", 100));
    assert.deepEqual(await due(null, null, "2026-06-02", "2026-06-04", 2, 0), all.slice(0, 2));
    assert.deepEqual(await due(null, null, "2026-06-02", "2026-06-04", 2, 2), all.slice(2, 4));
    const generated = await task();
    const descriptor = await calendar(r.object_id, 1);
    const recorded = await record(r.object_id, 1, descriptor, generated);
    assert.equal(recorded.generated_object_id, generated.object_id);
    assert.equal((await record(r.object_id, 1, descriptor, generated)).generated_object_id, generated.object_id);
    assert.deepEqual((await due(null, null, "2026-06-02", "2026-06-04")).filter(x => x.recurrence_object_id === r.object_id).map(x => x.sequence), [2, 3]);
    await rejects(async () => record(r.object_id, 1, descriptor, await task()), "23505");
    await rejects(async () => record(r.object_id, 2, await calendar(r.object_id, 2), generated), "23505");
    await rejects(async () => record(r.object_id, 2, { occurrence_date: "2026-06-10" }, await task()), "22023");
    await rejects(async () => record(r.object_id, 2, await calendar(r.object_id, 2), await event()), "22023");
    await rejects(() => rows("update public.assistant_recurrence_occurrences set occurrence_date='2026-07-01' where recurrence_object_id=$1 and sequence=1", [r.object_id]), "55000");
    await rejects(() => rows("delete from public.assistant_recurrence_occurrences where recurrence_object_id=$1 and sequence=1", [r.object_id]), "55000");
    await rejects(() => rows("update public.assistant_objects set object_type='knowledge' where id=$1", [generated.object_id]), "23514");
    const other = await make({ date: "2026-06-01" });
    await rejects(async () => record(other.object_id, 1, await calendar(other.object_id, 1), generated), "23505");
    const instantRule = await make({ kind: "instant", at: "2026-06-01T10:00Z", date: null, seedDate: null, timezone: "UTC" });
    const instants = await due("2026-06-02T00:00Z", "2026-06-02T23:59Z");
    assert.ok(instants.some(x => x.recurrence_object_id === instantRule.object_id));
    assert.ok(instants.every(x => x.occurrence_date === null));
    await rejects(() => due(null, "2026-06-02T00:00Z"), "22023");
    await rejects(() => due(null, null, "2026-06-03", "2026-06-02"), "22023");
    await rejects(() => due(null, null, "2026-06-01", "2026-06-02", 50, 10001), "22023");
  });

  await t.test("completion-relative four frequencies, membership, one successor, idempotence", async () => {
    const completedAt = "2026-01-31T15:30:00Z"; // 10:30 local New York
    for (const [frequency, expected] of [["daily", "2026-02-01T15:30:00.000Z"], ["weekly", "2026-02-07T15:30:00.000Z"], ["monthly", "2026-02-28T15:30:00.000Z"], ["yearly", "2027-01-31T15:30:00.000Z"]]) {
      const seed = await task();
      const r = await make({ seed, basis: "after_completion", frequency, kind: null, at: null, date: null, timezone: "America/New_York", seedAt: "2026-01-01T15:30Z", seedDate: null });
      assert.equal(day((await one("select occurrence_at from public.assistant_recurrence_occurrences where recurrence_object_id=$1", [r.object_id])).occurrence_at), "2026-01-01");
      const [descriptor] = await next(r.object_id, seed.object_id, completedAt);
      assert.equal(descriptor.sequence, 1);
      assert.equal(instant(descriptor.occurrence_at), expected);
      assert.deepEqual(await next(r.object_id, seed.object_id, completedAt), [descriptor]);
      await rejects(async () => next(r.object_id, (await task()).object_id, completedAt), "22023");
      await rejects(async () => record(r.object_id, 1, { occurrence_at: "2026-02-03T10:00Z" }, await task(), seed.object_id, completedAt), "22023");
      const child = await task();
      await record(r.object_id, 1, descriptor, child, seed.object_id, completedAt);
      assert.deepEqual(await next(r.object_id, seed.object_id, completedAt), []);
      const nextChild = await next(r.object_id, child.object_id, "2026-03-31T14:30Z");
      assert.equal(nextChild[0].sequence, 2);
    }
    const spring = await make({ basis: "after_completion", kind: null, at: null, date: null, timezone: "America/New_York", seedAt: "2026-03-07T07:30Z", seedDate: null });
    assert.equal(instant((await next(spring.object_id, spring.seed_object_id, "2026-03-07T07:30Z"))[0].occurrence_at), "2026-03-08T07:30:00.000Z");
  });

  await t.test("rule updates preserve history; terminal status stops all calculation and recording without touching seed", async () => {
    const seed = await task();
    const r = await make({ seed, date: "2026-08-01" });
    const updated = await one("select * from public.assistant_update_recurrence($1,$2::jsonb)", [r.object_id, '{"interval_count":2}']);
    assert.equal(updated.interval_count, 2);
    assert.equal(day((await calendar(r.object_id, 1)).occurrence_date), "2026-08-03");
    const child = await task();
    await record(r.object_id, 1, await calendar(r.object_id, 1), child);
    await rejects(() => rows("select * from public.assistant_update_recurrence($1,'{\"interval_count\":3}'::jsonb)", [r.object_id]), "55000");
    await rejects(() => rows("select * from public.assistant_update_recurrence($1,'{\"anchor_date\":\"2026-09-01\"}'::jsonb)", [r.object_id]), "22023");
    assert.equal((await one("select interval_count from public.assistant_recurrences where object_id=$1", [r.object_id])).interval_count, 2);
    const ended = await one("select * from public.assistant_end_recurrence($1)", [r.object_id]);
    assert.equal(ended.status, "ended"); assert.ok(ended.ended_at);
    assert.equal((await one("select status from public.assistant_tasks where object_id=$1", [seed.object_id])).status, "open");
    assert.equal((await one("select status from public.assistant_tasks where object_id=$1", [child.object_id])).status, "open");
    assert.ok(!(await due(null, null, "2026-08-03", "2026-08-09")).some(x => x.recurrence_object_id === r.object_id));
    await rejects(() => calendar(r.object_id, 2), "55000");
    await rejects(() => rows("select * from public.assistant_end_recurrence($1)", [r.object_id]), "55000");
    await rejects(() => rows("select * from public.assistant_update_recurrence($1,'{\"frequency\":\"weekly\"}'::jsonb)", [r.object_id]), "55000");
    await rejects(async () => record(r.object_id, 2, { occurrence_date: "2026-08-05" }, await task()), "55000");
    await rejects(() => rows("update public.assistant_recurrences set status='active',ended_at=null where object_id=$1", [r.object_id]), "55000");
    const relative = await make({ basis: "after_completion", kind: null, at: null, date: null, timezone: "UTC", seedAt: "2026-01-01T00:00Z", seedDate: null });
    await rows("select * from public.assistant_end_recurrence($1)", [relative.object_id]);
    await rejects(() => next(relative.object_id, relative.seed_object_id, "2026-01-01T00:00Z"), "55000");
  });

  await t.test("RLS, explicit grants, invoker mode and protected module regression", async () => {
    const functionNames = ["assistant_create_recurrence", "assistant_update_recurrence", "assistant_end_recurrence", "assistant_list_recurrences", "assistant_list_due_recurrence_occurrences", "assistant_next_after_completion", "assistant_record_recurrence_occurrence"];
    const funcs = await rows("select proname,prosecdef from pg_proc where proname=any($1::text[])", [functionNames]);
    assert.equal(funcs.length, functionNames.length); assert.ok(funcs.every(x => !x.prosecdef));
    const tables = await rows("select relname,relrowsecurity from pg_class where relname in ('assistant_recurrences','assistant_recurrence_occurrences')");
    assert.equal(tables.length, 2); assert.ok(tables.every(x => x.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await rejects(() => rows("select * from public.assistant_recurrences"), "42501");
        await rejects(() => rows("select * from public.assistant_recurrence_occurrences"), "42501");
        await rejects(() => rows("select * from public.assistant_list_recurrences()"), "42501");
        await rejects(() => rows("select * from public.assistant_list_due_recurrence_occurrences(null,null,'2026-01-01','2026-01-02')"), "42501");
        await rejects(() => rows("select * from public.assistant_next_after_completion(gen_random_uuid(),gen_random_uuid(),now())"), "42501");
        await rejects(() => rows("select * from public.assistant_end_recurrence(gen_random_uuid())"), "42501");
        await rejects(() => rows("select * from public.assistant_update_recurrence(gen_random_uuid(),'{}'::jsonb)"), "42501");
        await rejects(() => rows("select * from public.assistant_record_recurrence_occurrence(gen_random_uuid(),1,now(),null,gen_random_uuid())"), "42501");
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try { assert.ok((await rows("select * from public.assistant_list_recurrences()" )).length); } finally { await db.exec("reset role"); }
    assert.equal((await one("select * from public.assistant_complete_task($1)", [(await task()).object_id])).status, "completed");
    assert.equal((await one("select * from public.assistant_create_knowledge('Notes','Content')")).status, "active");
  });
  await db.close();
});
