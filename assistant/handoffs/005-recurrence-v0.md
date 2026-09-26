# Handoff 005 — Implement Recurrence V0

Implement the Assistant.AI Recurrence V0 package defined in `assistant/modules/Recurrence.md`.

## Read first

Read:

- `assistant/Architecture.md`
- `assistant/DecisionLog.md`
- `assistant/modules/Recurrence.md`
- `assistant/modules/Tasks.md`
- `assistant/modules/Scheduling.md`
- `assistant/modules/Reminders.md`
- `assistant/Interfaces.md`
- all existing Assistant migrations, shared Edge Function code, APIs, and tests
- `supabase/config.toml`

Follow established Assistant conventions unless this handoff explicitly differs.

## Scope

Implement Recurrence as a rule-calculation and occurrence-ledger module.

Implement:

- recurrence persistence;
- recurrence occurrence ledger;
- registry/type/lifecycle protection;
- rule calculation for V0 frequencies;
- eight capability operations;
- Edge Function/API layer;
- executable PostgreSQL and API tests;
- interface documentation;
- declarations for every new Edge Function in `supabase/config.toml`.

Do **not** implement a background worker, scheduled job, UI, Google Calendar sync, Gmail processing, reminder delivery, or direct Task/Scheduling cloning.

## Architectural boundary

Recurrence may reference registry identities and inspect registry object types.

It must not read or write `assistant_tasks` or `assistant_schedule_events` private tables to materialize occurrences. Concrete Task/Event creation belongs to orchestration through those modules' public interfaces.

The occurrence ledger is Recurrence-owned.

Assistant has no continuous orchestration loop. Periodic ChatGPT reconciliation and interactive chat will call these capabilities. Design for late/repeated calls and idempotence.

## Migration discipline

Create one new append-only migration. Never edit a migration already applied to Supabase.

Merge to `main` may deploy production automatically. Leave implementation in a PR for review.

## Database requirements

Implement the invariants in `Recurrence.md`.

Particular attention:

- registry type `recurrence`;
- atomic registry + recurrence + sequence-0 seed occurrence creation;
- seed types restricted to Task or Schedule Event via registry type, without reading private module tables;
- active/ended lifecycle;
- immutable history;
- unique series membership for generated objects;
- unique occurrence positions within a recurrence;
- exact one-of instant/date occurrence representation;
- positive interval;
- ISO weekday validation and uniqueness;
- PostgreSQL timezone validation;
- calendar arithmetic performed in local calendar semantics;
- DST behavior deterministic and tested;
- monthly end-of-month clamp;
- leap-year clamp;
- completion-relative rules Task-only;
- RLS enabled;
- no direct anon/authenticated table access;
- capability RPCs `SECURITY INVOKER`;
- explicit revokes/default-public execution protection and service-role-only grants.

Do not add recurrence columns to Tasks, Scheduling, Reminders, Knowledge, or the Object Registry.

## Capability/API requirements

Implement and document:

- `create-recurrence`
- `update-recurrence`
- `end-recurrence`
- `get-recurrence`
- `list-recurrences`
- `list-due-recurrence-occurrences`
- `next-after-completion`
- `record-recurrence-occurrence`

Use established `ACTION_API_SECRET` authentication and safe response envelopes.

All new Edge Functions must be declared in `supabase/config.toml` with deliberate `verify_jwt = false`.

### Due-occurrence API

Keep instant and date horizons explicit. Do not silently convert dates using server timezone.

Return deterministic occurrence descriptors sufficient for an orchestrator to create the substantive object and later record the resulting registry ID.

Do not create Tasks or Schedule Events from the Recurrence RPC.

### Completion-relative API

Require the completed concrete object to already be a recorded member of the recurrence series.

Use the supplied completion instant as the calculation basis. The Recurrence module does not independently decide whether the Task is actually completed; the orchestrator is responsible for calling this after successful Task completion.

### Recording

Recording must be idempotent for the same recurrence/occurrence/generated-object association and reject conflicts.

The generated object's registry type must match the seed series type.

## Tests

At minimum exercise:

- atomic recurrence + registry + seed occurrence creation;
- rollback/no orphan registry on invalid rule;
- seed registry type restrictions;
- registry type protection;
- positive interval validation;
- calendar instant anchor shape;
- calendar date anchor shape;
- valid/invalid timezone;
- weekly weekday validation, uniqueness, and N-week anchor behavior;
- daily calendar calculation;
- weekly calculation;
- monthly calculation including 29/30/31 day clamps;
- yearly leap-day clamp;
- local wall-clock preservation across DST;
- explicit deterministic nonexistent/ambiguous DST behavior;
- completion-relative daily/weekly/monthly/yearly calculation;
- completion-relative restricted to Tasks;
- completed predecessor must be series member;
- sequence-0 seed ledger;
- record generated occurrence;
- duplicate identical recording is idempotent;
- conflicting object for same occurrence rejected;
- generated object cannot join multiple V0 recurrence series;
- generated object type must match seed type;
- historical ledger immutable;
- active -> ended transition;
- ended recurrence rejects update/new occurrence recording/calculation;
- ending does not mutate seed/generated substantive objects;
- rule update preserves historical occurrences;
- due listing returns only missing occurrences within bounds;
- repeated due listing before recording is deterministic;
- after recording, occurrence disappears from missing list;
- instant/date bounds remain distinct;
- deterministic ordering and bounded pagination;
- API validation/auth/safe errors;
- anon/authenticated cannot access recurrence tables/capability RPCs;
- capability RPCs are invoker;
- existing Tasks, Knowledge, Reminders, Scheduling tests continue to pass;
- Coach contracts remain untouched;
- TOML contains every new Recurrence function and all existing declarations.

Use executable PostgreSQL tests for recurrence math and database invariants, not only static migration inspection.

## Completion gate

Ready for review when:

- all tests pass;
- migration is append-only;
- recurrence math and DST behavior are explicit and tested;
- occurrence materialization is idempotent;
- no cross-module private-table manipulation was introduced;
- API/docs agree;
- all eight functions are registered;
- protected contracts are unchanged;
- PR notes that merge may deploy production.
