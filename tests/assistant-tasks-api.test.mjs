import test from "node:test";
import assert from "node:assert/strict";
import { createTaskHandler, TaskApiError } from "../supabase/functions/_shared/task-api.mjs";

const SECRET = "test-secret";
const IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];

class MemoryTasks {
  constructor() {
    this.tasks = new Map();
    this.registry = new Set();
  }
  async create(input) {
    if (input.title === "force database failure") throw new Error("database failure");
    const object_id = IDS[this.tasks.size];
    const now = new Date(1_800_000_000_000 + this.tasks.size * 1000).toISOString();
    const task = { object_id, ...input, status: "open", completed_at: null, cancelled_at: null, created_at: now, updated_at: now };
    this.registry.add(object_id);
    this.tasks.set(object_id, task);
    return task;
  }
  async update(id, patch) {
    const current = await this.get(id);
    const next = { ...current, ...patch };
    if (next.not_before && next.due_at && Date.parse(next.not_before) > Date.parse(next.due_at)) {
      throw new TaskApiError("VALIDATION_ERROR", "Task data violates a validation rule");
    }
    this.tasks.set(id, next);
    return next;
  }
  async complete(id) { return this.#terminal(id, "completed"); }
  async cancel(id) { return this.#terminal(id, "cancelled"); }
  async #terminal(id, status) {
    const current = await this.get(id);
    if (current.status !== "open") throw new TaskApiError("INVALID_TRANSITION", "Only an open task can enter a terminal state", 409);
    const next = { ...current, status, completed_at: status === "completed" ? new Date().toISOString() : null, cancelled_at: status === "cancelled" ? new Date().toISOString() : null };
    this.tasks.set(id, next);
    return next;
  }
  async get(id) {
    const task = this.tasks.get(id);
    if (!task) throw new TaskApiError("TASK_NOT_FOUND", "Task not found", 404);
    return task;
  }
  async list(options) { return this.#find(options); }
  async search(options) { return this.#find(options, options.query); }
  #find(options, search) {
    let rows = [...this.tasks.values()]
      .filter((task) => options.status === undefined || task.status === options.status)
      .filter((task) => options.priority === undefined || task.priority === options.priority)
      .filter((task) => !options.due_from || (task.due_at && task.due_at >= options.due_from))
      .filter((task) => !options.due_to || (task.due_at && task.due_at <= options.due_to))
      .filter((task) => !options.actionable_at || !task.not_before || task.not_before <= options.actionable_at)
      .filter((task) => !search || `${task.title} ${task.description ?? ""}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    rows = rows.slice(options.offset, options.offset + options.limit + 1);
    return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
  }
}

async function call(repository, operation, body, secret = SECRET) {
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json", "x-action-secret": secret },
    body: JSON.stringify(body),
  });
  const result = await createTaskHandler({ operation, repository, actionSecret: SECRET })(request);
  return { status: result.status, body: await result.json() };
}

test("authentication uses a safe stable error envelope", async () => {
  const result = await call(new MemoryTasks(), "list_tasks", {}, "wrong");
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED", details: {} });
});

test("create_task returns a durable registry identity", async () => {
  const repository = new MemoryTasks();
  const result = await call(repository, "create_task", { title: "Book dentist", priority: "high" });
  assert.equal(result.status, 200);
  assert.match(result.body.data.task.object_id, /^[0-9a-f-]{36}$/);
  assert.equal(result.body.data.task.status, "open");
  assert(repository.registry.has(result.body.data.task.object_id));
  assert.equal((await repository.get(result.body.data.task.object_id)).title, "Book dentist");
});

test("invalid priority and caller-controlled status are rejected", async () => {
  const repository = new MemoryTasks();
  const priority = await call(repository, "create_task", { title: "Task", priority: "urgent" });
  assert.equal(priority.body.code, "VALIDATION_ERROR");
  const created = await call(repository, "create_task", { title: "Task" });
  const update = await call(repository, "update_task", { object_id: created.body.data.task.object_id, status: "completed" });
  assert.equal(update.body.code, "IMMUTABLE_FIELD");
});

test("invalid time windows are rejected on create and update", async () => {
  const repository = new MemoryTasks();
  const invalid = { not_before: "2026-10-02T10:00:00Z", due_at: "2026-10-01T10:00:00Z" };
  const create = await call(repository, "create_task", { title: "Task", ...invalid });
  assert.equal(create.body.code, "INVALID_TIME_WINDOW");
  const made = await call(repository, "create_task", { title: "Task", due_at: "2026-10-01T10:00:00Z" });
  const update = await call(repository, "update_task", { object_id: made.body.data.task.object_id, not_before: "2026-10-02T10:00:00Z" });
  assert.equal(update.body.code, "VALIDATION_ERROR");
});

test("complete and cancel set exactly one terminal timestamp", async () => {
  const repository = new MemoryTasks();
  const first = (await call(repository, "create_task", { title: "First" })).body.data.task.object_id;
  const second = (await call(repository, "create_task", { title: "Second" })).body.data.task.object_id;
  const completed = (await call(repository, "complete_task", { object_id: first })).body.data.task;
  const cancelled = (await call(repository, "cancel_task", { object_id: second })).body.data.task;
  assert.equal(completed.status, "completed");
  assert(completed.completed_at);
  assert.equal(completed.cancelled_at, null);
  assert.equal(cancelled.status, "cancelled");
  assert(cancelled.cancelled_at);
  assert.equal(cancelled.completed_at, null);
});

test("terminal tasks reject another terminal transition", async () => {
  const repository = new MemoryTasks();
  const id = (await call(repository, "create_task", { title: "Task" })).body.data.task.object_id;
  await call(repository, "complete_task", { object_id: id });
  const result = await call(repository, "cancel_task", { object_id: id });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "INVALID_TRANSITION");
});

test("get/list use identity, filters, and bounded pagination", async () => {
  const repository = new MemoryTasks();
  const first = (await call(repository, "create_task", { title: "First", priority: "high", due_at: "2026-10-01T10:00:00Z" })).body.data.task;
  await call(repository, "create_task", { title: "Second", priority: "low", not_before: "2027-01-01T00:00:00Z" });
  await call(repository, "create_task", { title: "Third", priority: "high", due_at: "2026-12-01T10:00:00Z" });
  const get = await call(repository, "get_task", { object_id: first.object_id });
  assert.equal(get.body.data.task.title, "First");
  const list = await call(repository, "list_tasks", { priority: "high", due_to: "2026-11-01T00:00:00Z", actionable_at: "2026-10-01T00:00:00Z", limit: 1, offset: 0 });
  assert.equal(list.body.data.count, 1);
  assert.equal(list.body.data.tasks[0].title, "First");
  const tooLarge = await call(repository, "list_tasks", { limit: 101 });
  assert.equal(tooLarge.body.code, "INVALID_PAGINATION");
});

test("search_tasks searches title and description and paginates", async () => {
  const repository = new MemoryTasks();
  await call(repository, "create_task", { title: "Buy groceries", description: "milk and apples" });
  await call(repository, "create_task", { title: "Call Sam", description: "discuss grocery budget" });
  await call(repository, "create_task", { title: "Run" });
  const result = await call(repository, "search_tasks", { query: "grocer", limit: 1, offset: 0 });
  assert.equal(result.body.data.count, 1);
  assert.equal(result.body.data.has_more, true);
});

test("failed creation exposes no registry or task row", async () => {
  const repository = new MemoryTasks();
  const result = await call(repository, "create_task", { title: "force database failure" });
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "DATABASE_ERROR");
  assert.equal(repository.registry.size, 0);
  assert.equal(repository.tasks.size, 0);
});
