# Handoff 003 — Implement Reminders V0

Implement the Assistant.AI Reminders V0 package defined in `assistant/modules/Reminders.md`.

## Read first

Before changing code, read:

- `assistant/Architecture.md`
- `assistant/DecisionLog.md`
- `assistant/modules/Reminders.md`
- `assistant/modules/Tasks.md`
- `assistant/modules/Knowledge.md`
- `assistant/Interfaces.md`
- existing Tasks and Knowledge migrations, shared Edge Function code, APIs, and tests
- `supabase/config.toml`

Follow existing Assistant conventions unless this handoff explicitly says otherwise.

## Scope

Implement:

- `assistant_reminders` persistence;
- six Reminders capability operations;
- Edge Function/API layer;
- tests;
- interface/documentation updates;
- `supabase/config.toml` declarations for every new Reminders Edge Function.

Do not implement UI, notification delivery infrastructure, recurrence, scheduling, or natural-language parsing.

## Migration discipline

Create a **new append-only migration**.

Do not edit any migration already applied to Supabase. GitHub merge is a production deployment gate, so leave implementation in a PR for review rather than merging it.

## Database requirements

Implement the invariants in `Reminders.md`, including:

- registry FK and target registry FK;
- registry object type validation for reminder identity;
- prevent registry type mutation while a reminder row exists;
- prohibit self-targets;
- prohibit reminder-to-reminder targets;
- pending/delivered/cancelled lifecycle;
- timestamp/status consistency;
- only pending reminders may change `remind_at`;
- updated timestamp behavior;
- RLS enabled;
- no direct anon/authenticated table access;
- least privilege;
- DB RPCs used by Edge Functions must be `SECURITY INVOKER`;
- explicitly revoke default/public execution and grant only the service role consistent with Tasks/Knowledge;
- atomic registry + reminder creation.

Do not add a registry check constraint enumerating all object types.

## Capability/API requirements

Implement:

- `create-reminder`
- `update-reminder-time`
- `cancel-reminder`
- `mark-reminder-delivered`
- `get-reminder`
- `list-reminders`

Use the established Assistant `ACTION_API_SECRET` authentication and response envelope.

Add all six functions to `supabase/config.toml` with the same deliberate `verify_jwt = false` configuration used by Tasks and Knowledge.

`create_reminder` accepts a target object ID and an absolute timestamp. The API does not parse natural language.

`update_reminder_time` changes only `remind_at`.

Lifecycle changes occur only through the semantic cancel/deliver operations.

`list_reminders` supports status, target object, due-after, due-before, bounded pagination, and deterministic ordering by remind time then creation time then object ID.

Do not implement `search_reminders`.

## Tests

At minimum test:

- create produces registry + reminder with same identity;
- failed creation leaves no orphan registry row;
- missing target rejected;
- self-target rejected;
- reminder-to-reminder target rejected;
- registry type mismatch rejected;
- changing a live reminder registry type rejected;
- invalid status rejected at DB boundary;
- delivered timestamp consistency;
- cancelled timestamp consistency;
- deliver pending succeeds;
- cancel pending succeeds;
- repeat terminal transitions rejected;
- delivered -> cancelled rejected;
- cancelled -> delivered rejected;
- reminder time update succeeds while pending;
- reminder time update rejected after terminal transition;
- target lifecycle changes do not automatically alter reminder;
- get success/not-found behavior;
- list filters, ordering, pagination, and has-more behavior;
- authentication/error envelope;
- anon/authenticated cannot directly execute capability RPCs;
- existing Tasks tests remain passing;
- existing Knowledge tests remain passing;
- Coach contracts remain untouched.

Prefer executable database invariant tests over static SQL assertions when transactional behavior matters.

## Completion gate

The PR is ready for review when:

- tests pass;
- migration is append-only and production-safe;
- Reminders invariants are enforced at appropriate boundaries;
- API matches the documented capability contract;
- all six new Edge Functions are declared in `supabase/config.toml`;
- no protected Coach, Tasks, or Knowledge contract has been reshaped;
- docs match implementation;
- PR description explicitly notes that merge may deploy migration and Edge Functions to production through the Supabase GitHub integration.
