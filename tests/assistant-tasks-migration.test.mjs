import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/202609260001_assistant_object_registry_tasks_v0.sql", import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("registry stays minimal and extensible", () => {
  const table = sql.match(/create table public\.assistant_objects \(([\s\S]*?)\n\);/i)?.[1] ?? "";
  assert.match(table, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(table, /object_type text not null/i);
  assert.match(table, /object_type ~ '\^\[a-z\]/i);
  assert.doesNotMatch(table, /title|status|metadata|due_at/i);
});

test("task constraints encode lifecycle, priority, timestamps, and action window", () => {
  assert.match(sql, /status in \('open', 'completed', 'cancelled'\)/i);
  assert.match(sql, /priority in \('low', 'normal', 'high'\)/i);
  assert.match(sql, /status = 'completed' and completed_at is not null and cancelled_at is null/i);
  assert.match(sql, /status = 'cancelled' and cancelled_at is not null and completed_at is null/i);
  assert.match(sql, /not_before <= due_at/i);
  assert.match(sql, /references public\.assistant_objects\(id\) on delete cascade/i);
});

test("create RPC atomically inserts registry and task rows", () => {
  const rpc = sql.match(/create function public\.assistant_create_task[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(rpc, /insert into public\.assistant_objects/i);
  assert.match(rpc, /values \('task'\)/i);
  assert.match(rpc, /insert into public\.assistant_tasks/i);
});

test("semantic transition RPCs only update open tasks", () => {
  assert.match(sql, /assistant_complete_task[\s\S]*?where object_id = p_object_id and status = 'open'/i);
  assert.match(sql, /assistant_cancel_task[\s\S]*?where object_id = p_object_id and status = 'open'/i);
});
