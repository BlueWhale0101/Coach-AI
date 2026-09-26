import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const files = [
  "202609260001_assistant_object_registry_tasks_v0.sql",
  "20260926091121_assistant_tasks_v0_invoker_hardening.sql",
  "20260926093922_assistant_knowledge_v0.sql",
  "20260926095952_assistant_reminders_v0.sql",
];
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
for (const file of files) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const task = async (title) => (await rows("select * from public.assistant_create_task($1)", [title]))[0];
const knowledge = async (title) => (await rows("select * from public.assistant_create_knowledge($1, 'Body')", [title]))[0];
const create = async (target, time = "2026-10-01T17:00:00Z") => (await rows("select * from public.assistant_create_reminder($1,$2)", [target, time]))[0];
const count = async (name) => (await rows(`select count(*)::integer as n from public.${name}`))[0].n;
const rejects = (operation, code) => assert.rejects(operation, error => error.code === code);

test("Reminders PostgreSQL invariants and capability operations", async (t) => {
  await t.test("creation is atomic, target must exist and must not be a reminder or self", async () => {
    const target = await task("Pay Jenny");
    const item = await create(target.object_id);
    assert.equal(item.target_object_id, target.object_id);
    assert.equal(item.status, "pending");
    assert.equal(item.delivered_at, null);
    assert.equal(item.cancelled_at, null);
    assert.equal((await rows("select object_type from public.assistant_objects where id=$1", [item.object_id]))[0].object_type, "reminder");
    const before = await count("assistant_objects");
    await rejects(() => create("f803efc0-f979-4395-8078-36413f05155a"), "23503");
    await rejects(() => create(item.object_id), "22023");
    await rejects(() => create(target.object_id, null), "23502");
    assert.equal(await count("assistant_objects"), before);
    const [anotherIdentity] = await rows("insert into public.assistant_objects(object_type) values ('reminder') returning id");
    await rejects(() => rows("insert into public.assistant_reminders(object_id,target_object_id,remind_at) values ($1,$1,now())", [anotherIdentity.id]), "22023");
    const [wrongType] = await rows("insert into public.assistant_objects(object_type) values ('other') returning id");
    await rejects(() => rows("insert into public.assistant_reminders(object_id,target_object_id,remind_at) values ($1,$2,now())", [wrongType.id, target.object_id]), "23514");
  });

  await t.test("registry type checks guard both reminder identity and target", async () => {
    const target = await knowledge("Address");
    const item = await create(target.object_id);
    await rejects(() => rows("update public.assistant_objects set object_type='other' where id=$1", [item.object_id]), "23514");
    const [bare] = await rows("insert into public.assistant_objects(object_type) values ('substantive_future') returning id");
    await create(bare.id);
    await rejects(() => rows("update public.assistant_objects set object_type='reminder' where id=$1", [bare.id]), "23514");
    const [wrong] = await rows("insert into public.assistant_objects(object_type) values ('task') returning id");
    await rejects(() => rows("update public.assistant_reminders set target_object_id=$1 where object_id=$2", [wrong.id, item.object_id]), "23514");
  });

  await t.test("constraints and trigger enforce status, timestamps, identity, and pending-only time changes", async () => {
    const target = await task("State boundary");
    const item = await create(target.object_id);
    await rejects(() => rows("update public.assistant_reminders set status='unknown' where object_id=$1", [item.object_id]), "23514");
    await rejects(() => rows("update public.assistant_reminders set status='delivered' where object_id=$1", [item.object_id]), "23514");
    await rejects(() => rows("update public.assistant_reminders set delivered_at=now() where object_id=$1", [item.object_id]), "23514");
    await rejects(() => rows("update public.assistant_reminders set status='cancelled' where object_id=$1", [item.object_id]), "23514");
    await rejects(() => rows("update public.assistant_reminders set cancelled_at=now() where object_id=$1", [item.object_id]), "23514");
    await rejects(() => rows("update public.assistant_reminders set object_id=gen_random_uuid() where object_id=$1", [item.object_id]), "23514");
    const [updated] = await rows("select * from public.assistant_update_reminder_time($1,$2)", [item.object_id, "2026-10-02T09:00:00Z"]);
    assert.equal(new Date(updated.remind_at).toISOString(), "2026-10-02T09:00:00.000Z");
    assert.equal(new Date(updated.created_at).getTime(), new Date(item.created_at).getTime());
    assert.ok(new Date(updated.updated_at) >= new Date(item.updated_at));
    await rejects(() => rows("update public.assistant_reminders set status='delivered', delivered_at=now(), remind_at=now() where object_id=$1", [item.object_id]), "55000");
  });

  await t.test("delivery and cancellation are terminal and mutually exclusive", async () => {
    const target = await task("Transitions");
    const a = await create(target.object_id);
    const b = await create(target.object_id);
    const [delivered] = await rows("select * from public.assistant_mark_reminder_delivered($1)", [a.object_id]);
    const [cancelled] = await rows("select * from public.assistant_cancel_reminder($1)", [b.object_id]);
    assert.equal(delivered.status, "delivered");
    assert.ok(delivered.delivered_at);
    assert.equal(delivered.cancelled_at, null);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.cancelled_at);
    assert.equal(cancelled.delivered_at, null);
    for (const id of [a.object_id, b.object_id]) {
      await rejects(() => rows("select * from public.assistant_mark_reminder_delivered($1)", [id]), "55000");
      await rejects(() => rows("select * from public.assistant_cancel_reminder($1)", [id]), "55000");
      await rejects(() => rows("select * from public.assistant_update_reminder_time($1,now())", [id]), "55000");
      await rejects(() => rows("update public.assistant_reminders set remind_at=now() where object_id=$1", [id]), "55000");
    }
    await rejects(() => rows("select * from public.assistant_cancel_reminder(gen_random_uuid())"), "P0002");
  });

  await t.test("target lifecycle changes leave reminders intact", async () => {
    const action = await task("Complete me");
    const fact = await knowledge("Archive me");
    const a = await create(action.object_id);
    const b = await create(fact.object_id);
    await rows("select * from public.assistant_complete_task($1)", [action.object_id]);
    await rows("select * from public.assistant_archive_knowledge($1)", [fact.object_id]);
    assert.equal((await rows("select status from public.assistant_reminders where object_id=$1", [a.object_id]))[0].status, "pending");
    assert.equal((await rows("select status from public.assistant_reminders where object_id=$1", [b.object_id]))[0].status, "pending");
  });

  await t.test("list filters, ordering and one-extra-row pagination", async () => {
    const target = await task("List target");
    const other = await task("Other target");
    const late = await create(target.object_id, "2026-11-03T00:00:00Z");
    const early = await create(target.object_id, "2026-11-01T00:00:00Z");
    const middle = await create(target.object_id, "2026-11-02T00:00:00Z");
    await create(other.object_id, "2026-11-02T00:00:00Z");
    const query = (status, targetId, after, before, limit, offset) => rows(`select * from public.assistant_reminders
      where ($1::text is null or status=$1)
        and ($2::uuid is null or target_object_id=$2)
        and ($3::timestamptz is null or remind_at >= $3)
        and ($4::timestamptz is null or remind_at <= $4)
      order by remind_at asc, created_at asc, object_id asc limit $5 offset $6`, [status, targetId, after, before, limit + 1, offset]);
    const filtered = await query("pending", target.object_id, "2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z", 2, 0);
    assert.deepEqual(filtered.map(x => x.object_id), [early.object_id, middle.object_id, late.object_id]);
    assert.equal(filtered.slice(0, 2).length, 2);
    assert.deepEqual((await query("pending", target.object_id, null, null, 2, 2)).map(x => x.object_id), [late.object_id]);
    assert.deepEqual((await query("pending", target.object_id, "2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z", 2, 0)).map(x => x.object_id), [middle.object_id]);
    assert.deepEqual((await query("delivered", target.object_id, null, null, 10, 0)).map(x => x.object_id), []);
    assert.deepEqual((await query("pending", target.object_id, null, null, 2, 0)).map(x => x.object_id), filtered.map(x => x.object_id));
  });

  await t.test("equal reminder and creation times break ties by object ID", async () => {
    const target = await task("Tie target");
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    for (const id of [secondId, firstId]) {
      await rows("insert into public.assistant_objects(id,object_type) values ($1,'reminder')", [id]);
      await rows(`insert into public.assistant_reminders(object_id,target_object_id,remind_at,created_at)
        values ($1,$2,'2026-11-04T00:00:00Z','2026-09-26T00:00:00Z')`, [id, target.object_id]);
    }
    const result = await rows(`select object_id from public.assistant_reminders
      where target_object_id=$1 and remind_at='2026-11-04T00:00:00Z'
      order by remind_at asc, created_at asc, object_id asc`, [target.object_id]);
    assert.deepEqual(result.map(x => x.object_id), [firstId, secondId]);
  });

  await t.test("only service_role can use table or capability RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await rejects(() => rows("select * from public.assistant_reminders"), "42501");
        await rejects(() => rows("select * from public.assistant_create_reminder(gen_random_uuid(),now())"), "42501");
        await rejects(() => rows("select * from public.assistant_update_reminder_time(gen_random_uuid(),now())"), "42501");
        await rejects(() => rows("select * from public.assistant_cancel_reminder(gen_random_uuid())"), "42501");
        await rejects(() => rows("select * from public.assistant_mark_reminder_delivered(gen_random_uuid())"), "42501");
      } finally { await db.exec("reset role"); }
    }
    const target = await task("Service role target");
    await db.exec("set role service_role");
    try {
      const item = await create(target.object_id);
      assert.equal((await rows("select status from public.assistant_reminders where object_id=$1", [item.object_id]))[0].status, "pending");
    } finally { await db.exec("reset role"); }
    const functions = await rows(`select proname, prosecdef from pg_proc
      where proname in ('assistant_create_reminder','assistant_update_reminder_time','assistant_cancel_reminder','assistant_mark_reminder_delivered')`);
    assert.equal(functions.length, 4);
    assert.ok(functions.every(fn => fn.prosecdef === false));
  });
  await db.close();
});
