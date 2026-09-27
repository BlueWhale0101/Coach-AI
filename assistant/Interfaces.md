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

---

# Assistant.AI Recurrence API — V0

The eight `POST` Edge Functions accept `OPTIONS` for CORS and the established
`X-Action-Secret: <ACTION_API_SECRET>` header (Bearer fallback). Responses use
`{ "ok": true, "data": ... }` or a safe `{ "ok": false, "code": ...,
"error": ..., "details": ... }` envelope. All are configured with
`verify_jwt = false`; only their server-side service-role client accesses
Recurrence. Timestamps require an explicit `Z` or UTC offset; dates are
`YYYY-MM-DD`. No natural-language parsing is performed.

| Function | Request | Response data |
| --- | --- | --- |
| `create-recurrence` | `seed_object_id`, `basis`, `frequency`, `interval_count`, complete anchor and seed position | `{ "recurrence": Recurrence }` |
| `update-recurrence` | `object_id` and one or more of `frequency`, `interval_count`, `timezone`, `weekdays` | `{ "recurrence": Recurrence }` |
| `end-recurrence` | `object_id` | `{ "recurrence": Recurrence }` |
| `get-recurrence` | `object_id` | `{ "recurrence": Recurrence }` |
| `list-recurrences` | Optional `status`, `seed_object_id`, `basis`, `limit`, `offset` | `{ "recurrences": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |
| `list-due-recurrence-occurrences` | Inclusive `from_at`/`through_at` and/or `from_date`/`through_date`; optional `limit`, `offset` | `{ "occurrences": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |
| `next-after-completion` | `object_id`, recorded `completed_object_id`, actual `completed_at` | `{ "occurrence": OccurrenceDescriptor \| null }` |
| `record-recurrence-occurrence` | `object_id`, `sequence` (>= 1), exactly one `occurrence_at` or `occurrence_date`, `generated_object_id`; for completion-relative also `completed_object_id`, `completed_at` | `{ "occurrence": LedgerEntry }` |

The returned `Recurrence` has `object_id`, `seed_object_id`, `basis` (`calendar`
or `after_completion`), `frequency` (`daily`, `weekly`, `monthly`, `yearly`),
positive `interval_count`, nullable `anchor_kind`, `anchor_at`, `anchor_date`,
`timezone`, `weekdays`, `status` (`active` or `ended`), `ended_at`, `created_at`,
and `updated_at`. The seed must be a registered Task or Schedule Event. The
caller supplies its position; Recurrence only checks registry type and does
not inspect the owning module's private representation.

`create-recurrence` accepts three complete shapes:

- Calendar instant: `anchor_kind: "instant"`, `anchor_at`, validated PostgreSQL
  `timezone`, and `seed_occurrence_at` equal to `anchor_at`; no date fields.
- Calendar date: `anchor_kind: "date"`, `anchor_date`, and
  `seed_occurrence_date` equal to `anchor_date`; no timezone or instant fields.
- Completion-relative: Task seed only; `timezone`, `seed_occurrence_at`;
  no fixed anchor, weekday selection, or date fields.

Weekly calendar rules may supply a nonempty set of unique ISO `weekdays`
(Monday=1, Sunday=7). The anchor must fall on a selected weekday. Sequence 0
is the seed, followed by later selected weekdays in the same anchor ISO week,
then selected weekdays in every Nth later ISO week. Weekly rules without a
selection move N local calendar weeks from the original anchor. Daily and
weekly intervals are calendar days/weeks, not fixed seconds. Monthly
occurrences clamp the original anchor day to the target month end, then
recover that day in longer months. February 29 yearly recurrences use
February 28 in non-leap years and recover February 29 in leap years.

Instant rules preserve the original anchor's local wall clock. PostgreSQL
`AT TIME ZONE` resolves nonexistent spring wall times with the
pre-transition standard offset (New York 2026-03-08 02:30 -> 07:30Z,
displayed as 03:30 EDT) and ambiguous fall wall times with standard time
(New York 2026-11-01 01:30 -> 06:30Z). Subsequent occurrences return to
the original local clock time. Completion-relative rules calculate from the
supplied actual completion instant in the named timezone; weekly means N
local calendar weeks after completion, without weekday selections.

An `OccurrenceDescriptor` contains `recurrence_object_id`, `seed_object_id`,
`sequence`, and exactly one populated `occurrence_at` (instant) or
`occurrence_date` (date). Due listing only returns missing positions of
active calendar rules within caller-supplied inclusive bounds. Instant/date
windows remain distinct; supplying both selects both kinds. Order is
`recurrence_object_id ASC, sequence ASC`. Each rule scans at most 10,000
candidate positions per call; a wider horizon fails explicitly instead of
truncating. Pagination defaults to limit 50, offset 0, with maximum limit
100 and offset 10,000; an extra row determines `has_more`.

`next-after-completion` requires a recorded series member, uses the supplied
completion instant, and returns its next missing descriptor. It returns
`null` after a successor has been recorded. Recurrence cannot independently
check Task completion; the caller invokes this after successful Task
completion. The caller then creates the next Task through Tasks and records
the returned descriptor with its generated registry ID, predecessor ID, and
the same completion instant. Recording validates sequence and position and
returns an existing entry for an identical retry. A different generated
object for the same sequence/position or one already in another series
raises `OCCURRENCE_CONFLICT` (409).

The seed/basis/anchor stay fixed on update. Once any generated member is
recorded, temporal rule changes are rejected to preserve all historical
positions; identical patches remain possible. Ending is terminal and stops
new calculations/recordings, without changing concrete Tasks or Events.
Ledger history is immutable.

Concrete creation and ledger recording cross module/API transactions. If
creation succeeds and recording fails, the caller must inspect or reconcile
the concrete object through its owning module's public get/list interface
and attach it, or surface the ambiguity. It must not blindly create a
replacement. The ledger is idempotent after successful recording but does
not promise exactly-once concrete creation. No worker, queue, cron, or
private-table recovery mechanism is included.

Errors include `UNAUTHORIZED`, `INVALID_JSON`, `INVALID_OBJECT_ID`,
`INVALID_TIMESTAMP`, `INVALID_DATE`, `INVALID_TIME_WINDOW`,
`INVALID_PAGINATION`, `INVALID_TIMEZONE`, `MISSING_REQUIRED_FIELD`,
`IMMUTABLE_FIELD`, `VALIDATION_ERROR`, `RECURRENCE_NOT_FOUND` (404),
`INVALID_TRANSITION` (409), `OCCURRENCE_CONFLICT` (409), and safe
`DATABASE_ERROR` (500). Forward migration
`20260926105535_assistant_recurrence_v0.sql` adds only Recurrence-owned
tables/indexes/triggers/functions and a registry type guard. RLS is on;
anonymous/authenticated roles have no table or RPC privileges; Recurrence
capabilities are `SECURITY INVOKER` and service-role-only.

---

# Assistant.AI Classification API — V0

Classification owns primary Categories and flexible Tags across registered
Assistant objects. It does not add category/tag fields to Tasks, Knowledge,
Scheduling, Reminders, Recurrence, or Coach tables. Categories and Tags are
registry objects; assignment rows are Classification-private relationship
state.

All operations are `POST` Edge Functions with `OPTIONS` preflight,
`X-Action-Secret` or Bearer fallback authentication, and the standard
`{ "ok": true, "data": ... }` / safe error envelope. Every function is declared
with `verify_jwt = false` and uses the server-side service role.

| Function | Request | Response data |
| --- | --- | --- |
| `create-category` | `name`, `color`, optional `sort_order` | `{ "category": Category }` |
| `update-category` | `object_id`, one or more of `name`, `color`, `sort_order` | `{ "category": Category }` |
| `archive-category` | `object_id` | `{ "category": Category }` |
| `get-category` | `object_id` | `{ "category": Category }` |
| `list-categories` | Optional `status`, `limit`, `offset` | `{ "categories": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |
| `set-object-category` | `target_object_id`, active `category_object_id` | `{ "classification": Classification }` |
| `clear-object-category` | `target_object_id` | `{ "classification": Classification }` |
| `create-tag` | `name` | `{ "tag": Tag }` |
| `update-tag` | `object_id`, `name` | `{ "tag": Tag }` |
| `archive-tag` | `object_id` | `{ "tag": Tag }` |
| `get-tag` | `object_id` | `{ "tag": Tag }` |
| `list-tags` | Optional `status`, `limit`, `offset` | `{ "tags": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |
| `add-object-tag` | `target_object_id`, active `tag_object_id` | `{ "classification": Classification }` |
| `remove-object-tag` | `target_object_id`, `tag_object_id` | `{ "classification": Classification }` |
| `replace-object-tags` | `target_object_id`, complete `tag_object_ids` array of active Tag IDs | `{ "classification": Classification }` |
| `get-object-classification` | `target_object_id` | `{ "classification": Classification }` |
| `list-category-members` | `category_object_id`, optional `limit`, `offset` | `{ "members": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |
| `list-tag-members` | `tag_object_id`, optional `limit`, `offset` | `{ "members": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |

Category names and Tag names are nonblank and case-insensitively unique within
their kind. Category color is canonical `#RRGGBB`; lowercase input is stored
uppercase. Category list order is `sort_order ASC, name ASC, object_id ASC`.
Tag list order is `name ASC, object_id ASC`. Member lists return target
registry identities only, ordered by `target_object_id ASC`, so callers can
compose with owning module interfaces without Classification reading private
module tables.

Archiving a Category or Tag is terminal. Archived Categories and Tags cannot be
newly assigned, but existing assignments remain readable and removable. Setting
a Category atomically replaces the previous Category for the target. Clearing a
Category and removing a Tag are idempotent. Adding an already assigned Tag is
idempotent and preserves the original assignment timestamp.

---

# Assistant.AI Attention API — V0

Attention owns explicit user-selected prominence. A pin is relationship state,
not a registry object. It references an existing Assistant registry object and
does not change Task priority or any other target state.

All operations follow the same `POST`, `OPTIONS`, action-secret, service-role,
and response-envelope conventions as the other Assistant APIs.

| Function | Request | Response data |
| --- | --- | --- |
| `pin-object` | `target_object_id` | `{ "pin": Pin }` |
| `unpin-object` | `target_object_id` | `{ "pin": { "target_object_id": "...", "pinned": false, "pinned_at": null } }` |
| `is-object-pinned` | `target_object_id` | `{ "pin": { "target_object_id": "...", "pinned": true/false, "pinned_at": "..." } }` |
| `list-pinned-objects` | Optional `limit`, `offset` | `{ "pins": [], "limit": 50, "offset": 0, "count": 0, "has_more": false }` |

`pin-object` requires an existing registry target and is idempotent. Re-pinning
preserves the original `pinned_at`. `unpin-object` is idempotent. Listing is
bounded and deterministic: `pinned_at DESC, target_object_id ASC`.

Forward migration `20260926112231_assistant_classification_attention_v0.sql`
adds only Classification-owned tables, Attention-owned pin state, invoker
capability RPCs, RLS, explicit service-role grants, and the forward Recurrence
index `assistant_recurrences_seed_object_idx` for seed-only recurrence filters.
Existing module tables and protected Coach contracts are unchanged.

---

# Assistant.AI Projection API — Household Board V0

Projection owns read-only assembly for consumption surfaces. It owns no durable
household state and has no mutation operations.

## `get-household-board`

This is a `POST` Edge Function with `OPTIONS` preflight, the standard
`X-Action-Secret`/Bearer fallback, service-role backend access, and the same
success/error envelope as other Assistant capabilities. It is declared with
`verify_jwt = false`.

Request fields are optional:

```json
{
  "display_date": "2026-09-27",
  "timezone": "Australia/Darwin",
  "now": "2026-09-27T07:30:00+09:30",
  "task_limit": 15
}
```

`timezone` defaults to `Australia/Darwin` and is validated by PostgreSQL
timezone names. `display_date` defaults to the local date of `now` in that
timezone. `task_limit` defaults to 15 and is bounded to 1-50.

Response data is:

```json
{
  "board": {
    "metadata": {
      "generated_at": "...",
      "now": "...",
      "timezone": "Australia/Darwin",
      "today": "2026-09-27",
      "tomorrow": "2026-09-28",
      "task_limit": 15,
      "task_policy": "projection_v0_pinned_overdue_due_soon_actionable"
    },
    "tasks": [],
    "days": [
      {
        "id": "today",
        "date": "2026-09-27",
        "all_day_events": [],
        "timed_events": []
      },
      {
        "id": "tomorrow",
        "date": "2026-09-28",
        "all_day_events": [],
        "timed_events": []
      }
    ]
  }
}
```

Tasks contain the Task-owned display fields (`object_id`, `title`, nullable
`description`, status, priority, nullable `not_before`, nullable `due_at`),
Attention pin state, Classification category/tags when assigned, and a
Projection-owned `surface_reason`.

V0 task surfacing includes open Tasks when they are pinned, overdue, due within
the next seven local calendar days, or currently actionable (`not_before` null
or no later than `now`). Ordering is:

1. pinned;
2. overdue;
3. due soon;
4. actionable;
5. `due_at ASC NULLS LAST`;
6. `pinned_at DESC NULLS LAST`;
7. task `created_at ASC`;
8. `object_id ASC`.

Due dates are not invented. Missing `due_at` stays null and should render as a
blank deadline area in the tablet UI.

Calendar events contain Scheduling-owned timed/all-day fields plus category and
pin state when assigned. Today and Tomorrow are complete local dates in the
requested timezone. Timed windows are converted to absolute instants for
Scheduling overlap semantics; all-day windows use Scheduling's half-open date
intervals. Empty time is not represented.

Errors include `UNAUTHORIZED`, `INVALID_JSON`, `INVALID_DATE`,
`INVALID_TIMESTAMP`, `INVALID_TIMEZONE`, `INVALID_PAGINATION`,
`VALIDATION_ERROR`, `IMMUTABLE_FIELD`, and safe `DATABASE_ERROR`.

Forward migration `20260927074730_assistant_projection_household_board_v0.sql`
adds no tables. It adds only read-only `SECURITY INVOKER` Projection RPCs and
service-role-only execute grants. Existing Coach and Assistant module
contracts are unchanged.

---

# Assistant.AI MCP / Plugin Surface — V0

The MCP surface is a server-side conversational adapter over existing Assistant
Edge Function capabilities. It owns no durable state and exposes no database
or registry mutation primitive. Tool calls use the owning module capability
and return agent-facing structured content with stable `object_id` values where
subsequent mutation may be possible.

The portable plugin package is in `assistant/plugin/assistant-ai`; its bundled
skill describes the semantic distinctions the model should apply. The MCP
server implementation is in `assistant/mcp` and uses the official
`@modelcontextprotocol/sdk` server with Streamable HTTP transport at `/mcp`.

V0 exposes these conversational tools:

```text
find_tasks, get_task, create_task, update_task, complete_task, cancel_task
find_knowledge, get_knowledge, remember, update_knowledge, archive_knowledge
find_events, get_event, create_event, update_event, cancel_event
set_reminder
set_recurrence, update_recurrence, end_recurrence
set_category, set_tags
pin, unpin
get_household_board
```

Read tools are annotated read-only. Terminal V0 operations (`complete_task`,
`cancel_task`, `archive_knowledge`, `cancel_event`, `end_recurrence`) are
annotated destructive/consequential. Writes require stable object IDs. The MCP
adapter does not silently resolve vague references before mutation; the model
must search/read and ask for clarification when identity remains ambiguous.

`set_category` resolves an existing active Category by name or clears with
`category_name: null`. Unknown category names return `UNKNOWN_CATEGORY` with
available active categories and perform no mutation. `set_tags` resolves all
requested active Tag names first. If any tag is unknown, it returns
`UNKNOWN_TAG` and performs no mutation. Once names resolve, MCP invokes the
Classification-owned `replace-object-tags` capability to atomically replace
the complete tag set with exactly the requested existing active Tags.

The server calls Assistant Edge Functions with server-side
`ACTION_API_SECRET`. Browsers never receive the action secret or service-role
credentials. Published ChatGPT plugin deployment requires a secure HTTPS MCP
endpoint and the current OpenAI MCP authorization flow; V0 source includes the
portable plugin package but does not choose a new external host or identity
provider.

The checked 15-case utterance suite is a set of golden behavioral
specifications/fixtures for intended tool sequences. It does not execute a
model; actual model-selection evaluation remains blocked until the MCP server
can be connected to ChatGPT developer mode.
