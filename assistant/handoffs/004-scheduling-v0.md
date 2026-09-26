# Handoff 004 — Implement Scheduling V0

Implement the Assistant.AI Scheduling V0 package defined in `assistant/modules/Scheduling.md`.

## Read first

Read:

- `assistant/Architecture.md`
- `assistant/DecisionLog.md`
- `assistant/modules/Scheduling.md`
- `assistant/modules/Tasks.md`
- `assistant/modules/Knowledge.md`
- `assistant/modules/Reminders.md`
- `assistant/Interfaces.md`
- existing Assistant migrations, shared Edge Function code, APIs, and tests
- `supabase/config.toml`

Follow established Assistant conventions unless this handoff explicitly differs.

## Scope

Implement:

- `assistant_schedule_events` persistence;
- six Scheduling capability operations;
- Edge Function/API layer;
- executable database/API tests;
- interface documentation;
- declarations for every new Scheduling Edge Function in `supabase/config.toml`.

Do not implement UI, recurrence, reminders, notification delivery, Entities/Places, or external calendar synchronization.

## Migration discipline

Create one new append-only migration. Never edit a migration already applied to Supabase.

Merging Supabase definitions to `main` is a production deployment gate. Leave the completed implementation in a PR for review.

## Database requirements

Implement the invariants in `Scheduling.md`.

Particular attention:

- atomic registry + event creation with registry type `schedule_event`;
- nonblank title;
- mutually exclusive and complete timed/all-day representations;
- strict start-before-end interval validation;
- all-day end-date-exclusive semantics;
- validate timed timezone names using PostgreSQL timezone data rather than a hard-coded list;
- scheduled/cancelled lifecycle and timestamp consistency;
- cancelled events terminal;
- protect identity and registry type;
- atomic timed/all-day conversion on update;
- RLS enabled;
- no direct anon/authenticated table access;
- least privilege;
- capability RPCs `SECURITY INVOKER`;
- explicitly revoke default/public execution and grant only service role, consistent with existing Assistant modules.

Do not enumerate registry object types in the registry schema.

## Capability/API requirements

Implement:

- `create-schedule-event`
- `update-schedule-event`
- `cancel-schedule-event`
- `get-schedule-event`
- `list-schedule-events`
- `search-schedule-events`

Use established `ACTION_API_SECRET` authentication and response envelopes.

Register all six functions in `supabase/config.toml` with deliberate `verify_jwt = false`.

### Temporal input

For timed events, require:

- title;
- `time_kind = timed`;
- absolute `starts_at` and `ends_at` timestamps containing timezone offsets;
- a valid IANA/PostgreSQL timezone name.

For all-day events, require:

- title;
- `time_kind = all_day`;
- ISO dates `start_date` and exclusive `end_date`.

Reject mixed representations.

### Update

Allow scheduled events to update title, description, or temporal representation. A timed/all-day conversion must be submitted as a complete replacement representation and committed atomically.

Do not permit arbitrary lifecycle or audit-field patches.

### Calendar listing

Design an explicit API for overlap queries that does not conflate dates and timestamps. Prefer separate optional bounds for timed and all-day filtering if needed. Document the exact request fields and semantics in `assistant/Interfaces.md`.

Do not silently interpret a date in the server timezone.

Ordering must be deterministic and useful for calendar display.

### Search

V0 may use simple case-insensitive title/description search. Keep the public contract technology-neutral. Support status and bounded pagination.

## Tests

At minimum exercise:

- atomic create and rollback/no orphan registry;
- registry type validation/protection;
- blank title rejection;
- valid timed event;
- invalid/missing timezone;
- valid all-day event;
- mixed temporal representation rejected;
- start == end rejected;
- start > end rejected;
- all-day exclusive-end representation;
- scheduled event title/description update;
- timed reschedule;
- all-day reschedule;
- timed -> all-day conversion;
- all-day -> timed conversion;
- incomplete conversion rejected atomically;
- cancellation and timestamp consistency;
- repeated cancellation rejected;
- cancelled update rejected;
- identity/audit/lifecycle fields cannot be generically modified;
- get success/not-found;
- overlap filtering at interval boundaries for timed events;
- overlap filtering at interval boundaries for all-day events;
- deterministic chronological ordering and tie-breaking;
- search title and description;
- search/list status filters and pagination;
- API timestamp/date/timezone validation;
- auth and safe error envelope;
- anon/authenticated cannot access table/capability RPCs;
- capability RPCs are invoker;
- Tasks, Knowledge, and Reminders tests continue to pass;
- Coach contracts remain untouched;
- config contains all six Scheduling functions and existing declarations.

Use executable PostgreSQL tests for database behavior rather than relying only on static migration text.

## Completion gate

Ready for review when tests pass, migration is append-only, module invariants are enforced, API and docs agree, all six functions are declared in TOML, protected contracts are unchanged, and the PR explicitly notes that merge may deploy to production.
