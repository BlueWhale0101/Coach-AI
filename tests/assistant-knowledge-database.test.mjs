import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "202609260001_assistant_object_registry_tasks_v0.sql",
  "20260926091121_assistant_tasks_v0_invoker_hardening.sql",
  "20260926093922_assistant_knowledge_v0.sql",
];
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
for (const file of migrations) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const create = (title, content) => rows("select * from public.assistant_create_knowledge($1, $2)", [title, content]);
const count = (table) => rows(`select count(*)::integer as count from public.${table}`);
const errorCode = async (fn, code) => assert.rejects(fn, (error) => error.code === code);

test("real PostgreSQL constraints and capability transactions", async (t) => {
  await t.test("create uses one registry identity and failed insert rolls back both rows", async () => {
    const [item] = await create("Garage filters", "Top shelf");
    assert.equal(item.status, "active");
    assert.equal(item.archived_at, null);
    assert.equal((await rows("select object_type from public.assistant_objects where id = $1", [item.object_id]))[0].object_type, "knowledge");
    const beforeObjects = (await count("assistant_objects"))[0].count;
    await errorCode(() => create(" ", "Valid content"), "23514");
    assert.equal((await count("assistant_objects"))[0].count, beforeObjects);
    assert.equal((await count("assistant_knowledge"))[0].count, 1);
  });

  await t.test("type mismatch and registry type change are rejected", async () => {
    const [registry] = await rows("insert into public.assistant_objects(object_type) values ('task') returning id");
    await errorCode(() => rows("insert into public.assistant_knowledge(object_id,title,content) values ($1,'a','b')", [registry.id]), "23514");
    const [item] = await create("Match", "Type");
    await errorCode(() => rows("update public.assistant_objects set object_type = 'task' where id = $1", [item.object_id]), "23514");
  });

  await t.test("database enforces content, status, archive consistency, identity and timestamps", async () => {
    const [item] = await create("Constraints", "Body");
    await errorCode(() => create("Valid", "   "), "23514");
    await errorCode(() => rows("update public.assistant_knowledge set status = 'unknown' where object_id = $1", [item.object_id]), "23514");
    await errorCode(() => rows("update public.assistant_knowledge set status = 'archived' where object_id = $1", [item.object_id]), "23514");
    await errorCode(() => rows("update public.assistant_knowledge set title = '  ' where object_id = $1", [item.object_id]), "23514");
    await errorCode(() => rows("update public.assistant_knowledge set content = '  ' where object_id = $1", [item.object_id]), "23514");
    await errorCode(() => rows("update public.assistant_knowledge set object_id = gen_random_uuid() where object_id = $1", [item.object_id]), "23514");
    const [updated] = await rows("select * from public.assistant_update_knowledge($1, $2::jsonb)", [item.object_id, JSON.stringify({ content: "New body" })]);
    assert.equal(updated.title, item.title);
    assert.equal(updated.content, "New body");
    assert.equal(new Date(updated.created_at).getTime(), new Date(item.created_at).getTime());
    assert.ok(new Date(updated.updated_at) >= new Date(item.updated_at));
    for (const field of ["object_id", "status", "archived_at", "created_at", "updated_at", "unknown"]) {
      await errorCode(() => rows("select * from public.assistant_update_knowledge($1,$2::jsonb)", [item.object_id, JSON.stringify({ [field]: "x" })]), "22023");
    }
    const [archived] = await rows("select * from public.assistant_archive_knowledge($1)", [item.object_id]);
    assert.equal(archived.status, "archived");
    assert.ok(archived.archived_at);
    await errorCode(() => rows("select * from public.assistant_archive_knowledge($1)", [item.object_id]), "55000");
    await errorCode(() => rows("select * from public.assistant_update_knowledge($1,$2::jsonb)", [item.object_id, '{"title":"Changed"}']), "55000");
  });

  await t.test("search filters title and content with stable ordering and bounded pagination", async () => {
    const [a] = await create("needle first", "alpha");
    const [b] = await create("middle", "needle beta");
    const [c] = await create("needle last", "gamma");
    const [other] = await create("irrelevant", "other");
    await rows("select * from public.assistant_archive_knowledge($1)", [b.object_id]);
    const search = (status, limit, offset) => rows("select * from public.assistant_search_knowledge('needle',$1,$2,$3)", [status, limit, offset]);
    assert.deepEqual((await search(null, 2, 0)).map(x => x.object_id), [c.object_id, b.object_id]);
    assert.deepEqual((await search(null, 2, 2)).map(x => x.object_id), [a.object_id]);
    assert.deepEqual((await search("active", 10, 0)).map(x => x.object_id), [c.object_id, a.object_id]);
    assert.deepEqual((await search("archived", 10, 0)).map(x => x.object_id), [b.object_id]);
    assert.ok(!(await search(null, 20, 0)).some(x => x.object_id === other.object_id));
    assert.equal((await search(null, 9999, 0)).length, 3);
  });

  await t.test("list status, deterministic ordering, and one-extra-row pagination", async () => {
    const list = (status, limit, offset) => rows(`select * from public.assistant_knowledge
      where ($1::text is null or status = $1)
      order by created_at desc, object_id asc limit $2 offset $3`, [status, limit + 1, offset]);
    const active = await list("active", 2, 0);
    assert.equal(active.length, 3);
    assert.equal(active.slice(0, 2).length, 2);
    assert.ok(active.every(x => x.status === "active"));
    assert.deepEqual(active.map(x => x.object_id), (await list("active", 2, 0)).map(x => x.object_id));
    const archived = await list("archived", 100, 0);
    assert.ok(archived.length >= 2);
    assert.ok(archived.every(x => x.status === "archived"));
    assert.ok(!(await list("active", 100, 0)).some(x => x.object_id === archived[0].object_id));
  });

  await t.test("anonymous roles have no table or RPC access; Tasks still operate", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await errorCode(() => rows("select * from public.assistant_knowledge"), "42501");
        await errorCode(() => create("No", "access"), "42501");
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try {
      const [item] = await create("Role allowed", "Private body");
      assert.equal((await rows("select content from public.assistant_knowledge where object_id = $1", [item.object_id]))[0].content, "Private body");
    } finally { await db.exec("reset role"); }
    const [task] = await rows("select * from public.assistant_create_task('existing task')");
    assert.equal(task.status, "open");
    assert.equal((await rows("select * from public.assistant_complete_task($1)", [task.object_id]))[0].status, "completed");
  });
  await db.close();
});
