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

---

# Assistant.AI Knowledge API — V0

The Knowledge capability is separate from Tasks and Coach. Each operation is a
Supabase Edge Function with a hyphenated name, accepts `POST` JSON and `OPTIONS`
preflight, and uses the same `X-Action-Secret` header (or `Authorization: Bearer`
fallback) and `{ "ok": true, "data": ... }` / `{ "ok": false, "error": ..., "code": ..., "details": ... }`
envelopes described above. The service role is held only in the Edge Function.

Returned Knowledge items have stable `object_id`, nonblank `title` and `content`,
`status` (`active` or `archived`), nullable `archived_at`, and `created_at` and
`updated_at` timestamps. Callers do not create or mutate registry rows directly.

| Function | Request | Response data |
| --- | --- | --- |
| `create-knowledge` | Required `title`, `content` | `{ "knowledge": Knowledge }` |
| `update-knowledge` | `object_id`, at least one of `title`, `content` | `{ "knowledge": Knowledge }` |
| `archive-knowledge` | `object_id` | `{ "knowledge": Knowledge }` |
| `get-knowledge` | `object_id` | `{ "knowledge": Knowledge }` |
| `list-knowledge` | Optional `status`, `limit`, `offset` | Page described below |
| `search-knowledge` | Required nonblank `query`; optional `status`, `limit`, `offset` | Page described below |

`update-knowledge` changes title/content on active items only. The archive
operation changes an active item to archived and records `archived_at` atomically.
There is no unarchive or delete operation. Missing items return
`KNOWLEDGE_NOT_FOUND` (404); archived-item transitions return
`INVALID_TRANSITION` (409). Other validation codes include
`MISSING_REQUIRED_FIELD`, `VALIDATION_ERROR`, `INVALID_OBJECT_ID`,
`IMMUTABLE_FIELD`, and `INVALID_PAGINATION`; unauthorized calls return
`UNAUTHORIZED` (401). Internal database errors are not exposed to callers.

List and search return:

```json
{ "knowledge": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }
```

Limit defaults to 50 and cannot exceed 100; offset defaults to zero. The
results are ordered by creation time descending, then object ID ascending.
The server reads one extra row to determine `has_more`. Search V0 matches
case-insensitive text in titles and content; callers should depend on the
search capability rather than a particular retrieval algorithm.

The forward migration `20260926093922_assistant_knowledge_v0.sql` adds
`assistant_knowledge`, type and timestamp protection triggers, local lifecycle
constraints, and create/update/archive/search RPCs. The create RPC inserts the
registry and Knowledge rows in one PostgreSQL transaction. All Knowledge RPCs
are `SECURITY INVOKER`; the table has RLS enabled, no `anon` or `authenticated`
table access, and explicit service-role privileges. The registry's open-ended
object-type format and the existing Tasks and Coach contracts are unchanged.

---

# Assistant.AI Reminders API — V0

Each operation is a `POST` Supabase Edge Function with `OPTIONS` preflight. It
uses the Assistant action secret and success/error envelopes described above;
all six functions declare `verify_jwt = false` in `supabase/config.toml` so the
handler can authenticate `X-Action-Secret` (or the Bearer fallback). The service
role key stays on the server. No natural-language parsing or delivery worker is
included.

A returned reminder contains `object_id`, `target_object_id`, `remind_at`,
`status` (`pending`, `delivered`, `cancelled`), nullable `delivered_at` and
`cancelled_at`, `created_at`, and `updated_at`. Delivery means processing and
handoff to a surfacing mechanism; it does not establish human acknowledgement.
The target is an existing substantive Assistant object (including a completed
Task or archived Knowledge item), never a reminder.

| Function | Request | Response data |
| --- | --- | --- |
| `create-reminder` | Required `target_object_id` UUID, absolute `remind_at` | `{ "reminder": Reminder }` |
| `update-reminder-time` | Required `object_id` UUID, new `remind_at` | `{ "reminder": Reminder }` |
| `cancel-reminder` | Required `object_id` UUID | `{ "reminder": Reminder }` |
| `mark-reminder-delivered` | Required `object_id` UUID | `{ "reminder": Reminder }` |
| `get-reminder` | Required `object_id` UUID | `{ "reminder": Reminder }` |
| `list-reminders` | Optional `status`, `target_object_id`, `due_after`, `due_before`, `limit`, `offset` | Page described below |

All caller timestamps must be ISO 8601 with `Z` or an explicit UTC offset.
`due_after` and `due_before` are inclusive bounds on `remind_at`. When both
are supplied, the first must not be later than the second. List defaults to
limit 50, offset 0; limit is an integer from 1 to 100. Ordering is
`remind_at ASC, created_at ASC, object_id ASC`. One extra row determines
`has_more`:

```json
{ "reminders": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }
```

Missing/wrong-type reminder IDs return `REMINDER_NOT_FOUND` (404); missing
targets return `TARGET_NOT_FOUND` (404). Self-targets and reminder targets
return `INVALID_TARGET` (400). Attempts to mutate a terminal reminder return
`INVALID_TRANSITION` (409). Other errors include `UNAUTHORIZED`, `INVALID_JSON`,
`INVALID_OBJECT_ID`, `INVALID_TIMESTAMP`, `INVALID_TIME_WINDOW`,
`INVALID_PAGINATION`, `IMMUTABLE_FIELD`, `VALIDATION_ERROR`, and a safe
`DATABASE_ERROR`. Lifecycle changes only through the semantic API operations.

Migration `20260926095952_assistant_reminders_v0.sql` adds the Reminders table,
referential checks and lifecycle triggers, and invoker create/update-time/cancel/
deliver RPCs. Registry and reminder creation share a PostgreSQL transaction.
The table has RLS enabled, no `anon` or `authenticated` access, and explicit
service-role grants. No public delete, search, recurrence, or notification
delivery capability exists in V0.

---

# Assistant.AI Scheduling API — V0

Each Scheduling capability is a `POST` Supabase Edge Function with `OPTIONS`
preflight. It uses the Assistant `X-Action-Secret` header (or Bearer fallback),
and the same success/error envelopes documented above. The service-role key
stays in the Edge Function. Every new function is declared with
`verify_jwt = false` in `supabase/config.toml` for handler authentication.

A returned event has stable `object_id`, `title`, nullable `description`,
`time_kind`, nullable `starts_at`, `ends_at`, `timezone`, `start_date`,
`end_date`, `status`, `cancelled_at`, `created_at`, and `updated_at`. Timed events
have `time_kind: "timed"`, absolute start/end instants with `Z` or explicit
offset, and a separately supplied timezone name for display context. The
database validates the name against PostgreSQL timezone data. All-day events
have `time_kind: "all_day"` and ISO dates with an **exclusive** `end_date`;
they have no timestamp or timezone fields. A single-day event on November 14
uses `start_date: "2026-11-14"` and `end_date: "2026-11-15"`.

| Function | Request | Response data |
| --- | --- | --- |
| `create-schedule-event` | Required `title` and one complete timed (`time_kind`, `starts_at`, `ends_at`, `timezone`) or all-day (`time_kind`, `start_date`, `end_date`) representation; optional nullable `description` | `{ "event": Event }` |
| `update-schedule-event` | `object_id` plus `title`, `description`, or a **complete** replacement timed/all-day representation | `{ "event": Event }` |
| `cancel-schedule-event` | `object_id` | `{ "event": Event }` |
| `get-schedule-event` | `object_id` | `{ "event": Event }` |
| `list-schedule-events` | Optional `status`, window pairs below, `limit`, `offset` | Page below |
| `search-schedule-events` | Required nonblank `query`; optional `status`, `limit`, `offset` | Page below |

An update with any temporal field requires the entire new representation,
even when staying in the same kind. A timed/all-day conversion replaces all
temporal fields in one database update. Only scheduled events can be updated
or cancelled. There is no public delete or completed status.

Calendar overlap fields are **optional complete pairs**:

- `timed_overlap_start` and `timed_overlap_end`: absolute timestamps defining
  a half-open interval `[start, end)` for timed events.
- `all_day_overlap_start` and `all_day_overlap_end`: ISO dates defining a
  half-open date interval `[start, end)` for all-day events.

Each start must precede its end. An event overlaps a window when its start is
strictly before the window end and its end is strictly after the window start.
With only one pair, results contain only that event kind; with both pairs,
results contain the matching events of both kinds. With neither, all event
kinds are eligible. No date is converted using the server timezone. Optional
`status` is `scheduled` or `cancelled` in both list and search.

List and search default to `limit: 50`, `offset: 0`; limit is an integer from
1 to 100. They fetch one extra row to compute `has_more`:

```json
{ "events": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }
```

Chronological order is the event's local calendar date (all-day `start_date`
or timed `starts_at` in its stored timezone), with all-day events first on a
date, then timed start instant, creation time, and object ID ascending. Search
V0 matches title and description case-insensitively; callers should depend on
the search capability, not its current matching algorithm.

Errors include `EVENT_NOT_FOUND` (404), `INVALID_TRANSITION` (409),
`INVALID_OBJECT_ID`, `INVALID_TIMESTAMP`, `INVALID_DATE`, `INVALID_TIMEZONE`,
`INVALID_TIME_WINDOW`, `INVALID_PAGINATION`, `MISSING_REQUIRED_FIELD`,
`IMMUTABLE_FIELD`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `INVALID_JSON`, and
safe `DATABASE_ERROR`. Missing or wrong-type event IDs return
`EVENT_NOT_FOUND`. Invalid timezone names are rejected at the database
boundary and returned as `INVALID_TIMEZONE`.

Forward migration `20260926102646_assistant_scheduling_v0.sql` adds the event
table, representation and lifecycle checks, registry type guards, timezone
validation, and invoker capability RPCs. Registry and event creation are one
transaction. RLS is enabled with no direct anon/authenticated table access;
only the service role has the required table and RPC privileges. Existing
Tasks, Knowledge, Reminders, and Coach contracts are unchanged.
