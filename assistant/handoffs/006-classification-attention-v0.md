# Handoff 006 — Implement Classification + Attention V0

Implement the two independent modules defined in `assistant/modules/Classification.md` and `assistant/modules/Attention.md`.

Read Architecture, DecisionLog, Interfaces, existing module specs, migrations, shared Edge Function patterns, tests, and `supabase/config.toml` first.

## Scope

Implement both modules in one bounded PR while preserving separate logical ownership. Add persistence, semantic capability APIs/Edge Functions, executable database/API tests, interface documentation, and config declarations.

Do not implement the tablet UI.

## Boundaries

Neither module may read or mutate Tasks, Knowledge, Scheduling, Reminders, Recurrence, or Coach private tables. Both may reference `assistant_objects`.

Categories and Tags are registry objects. Classification assignments and Pins are not.

Do not add category/tag/pin columns to other modules.

## Migration discipline

Use new append-only migration(s). Never edit applied migrations. Merge to main may deploy production automatically; leave implementation in a PR for review.

## Classification requirements

Implement all Classification.md invariants, including registry types `category` and `tag`, atomic registry creation, nonblank case-insensitively unique names, canonical category color `#RRGGBB`, sort_order, terminal archive lifecycle, preserved archived assignments, active-only new assignments, one category per target, many tags, atomic category replacement, idempotent tag add/remove and category clear, deterministic member/list pagination, registry type protection, RLS, and service-role-only access.

Implement one semantic endpoint per documented capability using established auth/envelope conventions.

## Attention requirements

Implement pin persistence with Object Registry FK, one pin per target, pinned_at, idempotent pin preserving original timestamp, idempotent unpin, lookup, and bounded listing ordered newest pin first with target-ID tie-breaker.

Implement endpoints `pin-object`, `unpin-object`, `is-object-pinned`, and `list-pinned-objects`.

Attention must not infer or modify Task priority.

## Security

Follow existing Assistant conventions: RLS on exposed tables; no anon/authenticated table access; capability RPCs SECURITY INVOKER; explicit public/anon/authenticated revokes and service-role grants; ACTION_API_SECRET Edge Function authentication; every new function declared in config.toml with verify_jwt=false; no service-role credentials in clients.

## Tests

At minimum cover Classification atomic creation/rollback, type guards, blank and case-insensitive duplicate names, color validation/normalization, update/archive lifecycle, terminal archive, category replacement, category-clear idempotence, active-only assignment, multiple tags, duplicate tag-add idempotence, tag-remove idempotence, archived assignments remaining readable/removable, classification read shape, member listings, deterministic pagination, RLS/grants/invoker mode.

Cover Attention pin existing target, missing target rejection, duplicate pin preserving timestamp, idempotent unpin, lookup, deterministic pagination, target non-mutation, and RLS/grants/invoker mode.

Run the complete repository suite and ensure protected Coach and existing Assistant contracts remain unchanged.

## Completion gate

Ready for review when tests pass, migrations are append-only, module boundaries are intact, APIs/docs agree, all new functions are configured, and the PR explicitly notes that merge may deploy production.
