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
const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);
const count = async table => (await one(`select count(*)::integer n from public.${table}`)).n;
const task = title => one("select * from public.assistant_create_task($1)", [title]);
const category = (name = "Household", color = "#336699", sort = 0) =>
  one("select * from public.assistant_create_category($1,$2,$3)", [name, color, sort]);
const tag = (name = "Errand") => one("select * from public.assistant_create_tag($1)", [name]);
const classification = id => one("select * from public.assistant_get_object_classification($1)", [id]);

test("Classification and Attention PostgreSQL contracts", async t => {
  await t.test("classification creation is atomic, normalized, unique, and registry typed", async () => {
    const c = await category(" Home ", "#a1b2c3", 3);
    assert.equal(c.name, "Home");
    assert.equal(c.color, "#A1B2C3");
    assert.equal(c.sort_order, 3);
    assert.equal((await one("select object_type from public.assistant_objects where id=$1", [c.object_id])).object_type, "category");
    const before = await count("assistant_objects");
    await rejects(() => category("home", "#000000"), "23505");
    await rejects(() => category("   ", "#000000"), "23514");
    await rejects(() => category("Bad color", "blue"), "23514");
    assert.equal(await count("assistant_objects"), before);
    const t1 = await tag(" Travel ");
    assert.equal(t1.name, "Travel");
    assert.equal((await one("select object_type from public.assistant_objects where id=$1", [t1.object_id])).object_type, "tag");
    await rejects(() => tag("travel"), "23505");
    await rejects(() => tag(" "), "23514");
    const fake = await one("insert into public.assistant_objects(object_type) values('task') returning id");
    await rejects(() => rows("insert into public.assistant_categories(object_id,name,color) values($1,'x','#000000')", [fake.id]), "23514");
    await rejects(() => rows("update public.assistant_objects set object_type='task' where id=$1", [c.object_id]), "23514");
    await rejects(() => rows("update public.assistant_objects set object_type='task' where id=$1", [t1.object_id]), "23514");
  });

  await t.test("category and tag update/archive lifecycle is terminal and preserves assignments", async () => {
    const target = await task("File papers");
    const c = await category("Admin", "#112233", 9);
    const t1 = await tag("paperwork");
    const updated = await one("select * from public.assistant_update_category($1,$2::jsonb)", [c.object_id, '{"name":" Admin 2 ","color":"#abcdef","sort_order":1}']);
    assert.equal(updated.name, "Admin 2");
    assert.equal(updated.color, "#ABCDEF");
    assert.equal(updated.sort_order, 1);
    const tagUpdated = await one("select * from public.assistant_update_tag($1,$2::jsonb)", [t1.object_id, '{"name":"Paperwork 2"}']);
    assert.equal(tagUpdated.name, "Paperwork 2");
    await rows("select * from public.assistant_set_object_category($1,$2)", [target.object_id, c.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [target.object_id, t1.object_id]);
    const archivedCategory = await one("select * from public.assistant_archive_category($1)", [c.object_id]);
    const archivedTag = await one("select * from public.assistant_archive_tag($1)", [t1.object_id]);
    assert.equal(archivedCategory.status, "archived");
    assert.equal(archivedTag.status, "archived");
    await rejects(() => rows("select * from public.assistant_update_category($1,'{\"name\":\"x\"}'::jsonb)", [c.object_id]), "55000");
    await rejects(() => rows("select * from public.assistant_archive_category($1)", [c.object_id]), "55000");
    await rejects(() => rows("select * from public.assistant_update_tag($1,'{\"name\":\"x\"}'::jsonb)", [t1.object_id]), "55000");
    assert.equal((await classification(target.object_id)).category.object_id, c.object_id);
    assert.deepEqual((await classification(target.object_id)).tags.map(x => x.object_id), [t1.object_id]);
    await rejects(async () => rows("select * from public.assistant_set_object_category($1,$2)", [(await task("Other")).object_id, c.object_id]), "P0002");
    await rejects(async () => rows("select * from public.assistant_add_object_tag($1,$2)", [(await task("Other tag")).object_id, t1.object_id]), "P0002");
    await rows("select public.assistant_clear_object_category($1)", [target.object_id]);
    await rows("select public.assistant_remove_object_tag($1,$2)", [target.object_id, t1.object_id]);
    const cleared = await classification(target.object_id);
    assert.equal(cleared.category, null);
    assert.deepEqual(cleared.tags, []);
  });

  await t.test("category replacement, clear, multiple tags, members and pagination are deterministic", async () => {
    const a = await task("Alpha"), b = await task("Beta"), c = await task("Gamma");
    const cat1 = await category("Ops", "#100000", 2);
    const cat2 = await category("Family", "#200000", 1);
    await rows("select * from public.assistant_set_object_category($1,$2)", [a.object_id, cat1.object_id]);
    await rows("select * from public.assistant_set_object_category($1,$2)", [a.object_id, cat2.object_id]);
    assert.equal((await classification(a.object_id)).category.object_id, cat2.object_id);
    await rows("select public.assistant_clear_object_category($1)", [a.object_id]);
    await rows("select public.assistant_clear_object_category($1)", [a.object_id]);
    assert.equal((await classification(a.object_id)).category, null);
    await rows("select * from public.assistant_set_object_category($1,$2)", [a.object_id, cat2.object_id]);
    await rows("select * from public.assistant_set_object_category($1,$2)", [b.object_id, cat2.object_id]);
    const tag1 = await tag("One"), tag2 = await tag("Two");
    await rows("select * from public.assistant_add_object_tag($1,$2)", [a.object_id, tag2.object_id]);
    const first = await one("select assigned_at from public.assistant_object_tags where target_object_id=$1 and tag_object_id=$2", [a.object_id, tag2.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [a.object_id, tag2.object_id]);
    assert.equal((await one("select assigned_at from public.assistant_object_tags where target_object_id=$1 and tag_object_id=$2", [a.object_id, tag2.object_id])).assigned_at.toISOString(), first.assigned_at.toISOString());
    await rows("select * from public.assistant_add_object_tag($1,$2)", [a.object_id, tag1.object_id]);
    await rows("select public.assistant_remove_object_tag($1,$2)", [a.object_id, tag1.object_id]);
    await rows("select public.assistant_remove_object_tag($1,$2)", [a.object_id, tag1.object_id]);
    assert.deepEqual((await classification(a.object_id)).tags.map(x => x.object_id), [tag2.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [b.object_id, tag2.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [c.object_id, tag2.object_id]);
    const categoryMembers = await rows("select * from public.assistant_list_category_members($1,1,0)", [cat2.object_id]);
    assert.equal(categoryMembers.length, 1);
    assert.deepEqual(
      (await rows("select * from public.assistant_list_tag_members($1,10,0)", [tag2.object_id])).map(x => x.target_object_id).sort(),
      [a.object_id, b.object_id, c.object_id].sort()
    );
    const listedCategories = await rows("select * from public.assistant_categories where object_id = any($1::uuid[]) order by sort_order, lower(name), object_id", [[cat1.object_id, cat2.object_id]]);
    assert.equal(listedCategories[0].object_id, cat2.object_id);
  });

  await t.test("tag replacement is atomic, complete, idempotent, and rolls back validation failures", async () => {
    const target = await task("Replace tag set");
    const kept = await tag("replace kept");
    const removed = await tag("replace removed");
    const added = await tag("replace added");
    await rows("select * from public.assistant_add_object_tag($1,$2)", [target.object_id, kept.object_id]);
    await rows("select * from public.assistant_add_object_tag($1,$2)", [target.object_id, removed.object_id]);

    const replaced = await one("select * from public.assistant_replace_object_tags($1,$2::uuid[])", [target.object_id, [kept.object_id, added.object_id, kept.object_id]]);
    assert.deepEqual(replaced.tags.map(x => x.object_id).sort(), [added.object_id, kept.object_id].sort());

    await rows("select * from public.assistant_archive_tag($1)", [added.object_id]);
    await rejects(() => rows("select * from public.assistant_replace_object_tags($1,$2::uuid[])", [target.object_id, [added.object_id]]), "P0002");
    assert.deepEqual((await classification(target.object_id)).tags.map(x => x.object_id).sort(), [added.object_id, kept.object_id].sort());

    const missing = await one("select gen_random_uuid() id");
    await rejects(() => rows("select * from public.assistant_replace_object_tags($1,$2::uuid[])", [target.object_id, [missing.id]]), "P0002");
    assert.deepEqual((await classification(target.object_id)).tags.map(x => x.object_id).sort(), [added.object_id, kept.object_id].sort());

    const cleared = await one("select * from public.assistant_replace_object_tags($1,$2::uuid[])", [target.object_id, []]);
    assert.deepEqual(cleared.tags, []);

    const definition = (await one("select pg_get_functiondef('public.assistant_replace_object_tags(uuid,uuid[])'::regprocedure) definition")).definition;
    const lockIndex = definition.indexOf("where t.object_id = any(v_distinct)\n    for update");
    const activeValidationIndex = definition.indexOf("where t.object_id = any(v_distinct) and t.status = 'active'");
    assert.ok(lockIndex > 0, "replacement must lock requested tag rows");
    assert.ok(activeValidationIndex > lockIndex, "active-tag validation must occur after requested tag rows are locked");
    assert.equal(definition.includes("and t.status = 'active'\n    for update"), false, "lock must not be limited to rows already active");
  });

  await t.test("category and tag listing uses documented case-insensitive SQL ordering across pages", async () => {
    const categoryAlpha = await category("alpha", "#010101", -1000);
    const categoryBravo = await category("Bravo", "#020202", -1000);
    const categoryCharlie = await category("charlie", "#030303", -1000);
    assert.deepEqual(
      (await rows("select object_id from public.assistant_list_categories('active',2,0)")).map(x => x.object_id),
      [categoryAlpha.object_id, categoryBravo.object_id]
    );
    assert.deepEqual(
      (await rows("select object_id from public.assistant_list_categories('active',2,1)")).map(x => x.object_id),
      [categoryBravo.object_id, categoryCharlie.object_id]
    );

    const tagAlpha = await tag("alpha-tag");
    const tagBravo = await tag("Bravo-tag");
    const tagCharlie = await tag("charlie-tag");
    assert.deepEqual(
      (await rows("select object_id from public.assistant_list_tags('active',2,0)")).map(x => x.object_id),
      [tagAlpha.object_id, tagBravo.object_id]
    );
    assert.deepEqual(
      (await rows("select object_id from public.assistant_list_tags('active',2,1)")).map(x => x.object_id),
      [tagBravo.object_id, tagCharlie.object_id]
    );
  });

  await t.test("attention pins existing targets, is idempotent, lists deterministically, and does not mutate targets", async () => {
    const a = await task("Pinned A"), b = await task("Pinned B");
    const before = await one("select priority, updated_at from public.assistant_tasks where object_id=$1", [a.object_id]);
    const first = await one("select * from public.assistant_pin_object($1)", [a.object_id]);
    await rows("select pg_sleep(0.001)");
    const second = await one("select * from public.assistant_pin_object($1)", [a.object_id]);
    assert.equal(second.pinned_at.toISOString(), first.pinned_at.toISOString());
    await rows("select * from public.assistant_pin_object($1)", [b.object_id]);
    const lookup = await one("select * from public.assistant_is_object_pinned($1)", [a.object_id]);
    assert.equal(lookup.pinned, true);
    assert.equal(lookup.pinned_at.toISOString(), first.pinned_at.toISOString());
    const listed = await rows("select * from public.assistant_list_pinned_objects(10,0)");
    assert.deepEqual(listed, await rows("select * from public.assistant_list_pinned_objects(10,0)"));
    const after = await one("select priority, updated_at from public.assistant_tasks where object_id=$1", [a.object_id]);
    assert.equal(after.priority, before.priority);
    assert.equal(after.updated_at.toISOString(), before.updated_at.toISOString());
    await rows("select public.assistant_unpin_object($1)", [a.object_id]);
    await rows("select public.assistant_unpin_object($1)", [a.object_id]);
    assert.equal((await one("select * from public.assistant_is_object_pinned($1)", [a.object_id])).pinned, false);
    await rejects(() => rows("select * from public.assistant_pin_object(gen_random_uuid())"), "23503");
  });

  await t.test("RLS, grants, invoker mode, protected modules and recurrence index", async () => {
    const functionNames = [
      "assistant_create_category", "assistant_update_category", "assistant_archive_category", "assistant_create_tag", "assistant_update_tag", "assistant_archive_tag",
      "assistant_set_object_category", "assistant_clear_object_category", "assistant_add_object_tag", "assistant_remove_object_tag", "assistant_get_object_classification",
      "assistant_replace_object_tags", "assistant_list_categories", "assistant_list_tags", "assistant_list_category_members", "assistant_list_tag_members", "assistant_pin_object", "assistant_unpin_object", "assistant_is_object_pinned", "assistant_list_pinned_objects",
    ];
    const funcs = await rows("select proname,prosecdef from pg_proc where proname=any($1::text[])", [functionNames]);
    assert.equal(funcs.length, functionNames.length);
    assert.ok(funcs.every(x => !x.prosecdef));
    const tables = await rows("select relname,relrowsecurity from pg_class where relname in ('assistant_categories','assistant_tags','assistant_object_categories','assistant_object_tags','assistant_pins')");
    assert.equal(tables.length, 5);
    assert.ok(tables.every(x => x.relrowsecurity));
    assert.equal((await one("select count(*)::integer n from pg_indexes where indexname='assistant_recurrences_seed_object_idx'")).n, 1);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await rejects(() => rows("select * from public.assistant_categories"), "42501");
        await rejects(() => rows("select * from public.assistant_tags"), "42501");
        await rejects(() => rows("select * from public.assistant_pins"), "42501");
        await rejects(() => rows("select * from public.assistant_create_category('x','#000000',0)"), "42501");
        await rejects(() => rows("select * from public.assistant_replace_object_tags(gen_random_uuid(),'{}'::uuid[])"), "42501");
        await rejects(() => rows("select * from public.assistant_pin_object(gen_random_uuid())"), "42501");
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try { assert.ok((await category("Service visible", "#010203")).object_id); } finally { await db.exec("reset role"); }
    assert.equal((await one("select * from public.assistant_create_knowledge('Keep','Protected')")).status, "active");
    assert.equal((await one("select * from public.assistant_create_task('Still works')")).status, "open");
  });
  await db.close();
});
