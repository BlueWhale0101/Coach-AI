# Assistant.AI Tasks API — V0

Status: implemented

This contract is separate from the protected Coach interfaces. Each operation is
an independently deployable Supabase Edge Function, uses `POST`, and accepts
`OPTIONS` for CORS preflight.

## Authentication and envelopes

Send `X-Action-Secret: <ACTION_API_SECRET>`. `Authorization: Bearer <secret>` is
accepted as a compatibility fallback. Successful responses use:

```json
{"ok": true, "data": {}}
```

Errors use a stable code and safe message:

```json
{"ok": false, "error": "Human-readable message", "code": "ERROR_CODE", "details": {}}
```

Common codes are `UNAUTHORIZED`, `INVALID_JSON`, `VALIDATION_ERROR`,
`MISSING_REQUIRED_FIELD`, `INVALID_TIMESTAMP`, `INVALID_TIME_WINDOW`,
`INVALID_OBJECT_ID`, `IMMUTABLE_FIELD`, `INVALID_PAGINATION`, `TASK_NOT_FOUND`,
`INVALID_TRANSITION`, and `DATABASE_ERROR`.

## Task representation

Every returned task contains `object_id`, `title`, nullable `description`,
`status`, nullable `priority`, `not_before`, `due_at`, `completed_at`, and
`cancelled_at`, plus `created_at` and `updated_at` timestamps. The durable
`object_id` is both the Tasks identity and its reference to `assistant_objects`.

Timestamps supplied by callers must be ISO 8601 timestamps with `Z` or an
explicit UTC offset. Titles cannot be blank. Status is `open`, `completed`, or
`cancelled`; priority is null, `low`, `normal`, or `high`. If both action-window
timestamps exist, `not_before` must not be later than `due_at`.

## Operations

### `create-task`

Request fields: required `title`; optional/nullable `description`, `priority`,
`not_before`, and `due_at`. It returns `{ "task": Task }`. The database RPC
creates the `assistant_objects` and `assistant_tasks` rows in one transaction;
callers never create registry rows themselves.

### `update-task`

Request fields: required `object_id`, plus at least one of `title`,
`description`, `priority`, `not_before`, or `due_at`. It returns
`{ "task": Task }`. These are the only mutable fields. In particular, callers
cannot update identity, status, terminal timestamps, or audit timestamps.

### `complete-task` and `cancel-task`

Request: `{ "object_id": "uuid" }`. Each returns `{ "task": Task }` and
atomically transitions an open task to its requested terminal state while
setting exactly the corresponding terminal timestamp. A completed or cancelled
task cannot transition again in V0.

### `get-task`

Request: `{ "object_id": "uuid" }`. Returns `{ "task": Task }`, or
`TASK_NOT_FOUND`.

### `list-tasks`

Supports optional `status`, `priority`, `due_from`, `due_to`, and
`actionable_at` filters. `actionable_at` includes tasks whose `not_before` is
null or no later than the supplied timestamp. `priority: null` selects tasks
without an explicit priority.

### `search-tasks`

Requires a non-blank `query` and supports the same filters as `list-tasks`.
V0 performs case-insensitive substring matching over title and description.

Both list operations accept integer `limit` (default 50, maximum 100) and
non-negative integer `offset`. Their data is:

```json
{
  "tasks": [],
  "limit": 50,
  "offset": 0,
  "count": 0,
  "has_more": false
}
```

Ordering is deterministic: due date ascending with nulls last, then creation
time and object identity ascending. The implementation fetches one extra row to
calculate `has_more` without exposing an unbounded query.

## Schema and enforcement notes

Migration `202609260001_assistant_object_registry_tasks_v0.sql` creates the two
Assistant-owned tables, their local constraints, two query-driven indexes, and
capability-specific RPCs. `assistant_objects.object_type` uses a lowercase
identifier-format check rather than an enum or a fixed list. This rejects empty
and obviously invalid types while allowing a future module to introduce its
type without changing the Object Registry schema.

A trigger enforces that every `assistant_tasks.object_id` references a registry
row whose type is `task`; the foreign key uses cascading deletion from registry
to domain row. No public deletion capability is included. Row-level security is
enabled, and table/RPC access is withheld from `anon` and `authenticated`; Edge
Functions access the module using the service role after action-secret
authentication.

The database constraints are the final enforcement layer for status, priority,
terminal timestamps, nonblank titles, and action-window ordering. The API also
validates these rules to provide stable errors before attempting persistence.
