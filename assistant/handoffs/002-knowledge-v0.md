# Handoff 002 — Knowledge V0

Status: ready for Codex implementation

## Objective

Implement Assistant.AI Knowledge V0 as a bounded addition to the existing Object Registry and Tasks V0 system.

Read first:
- `assistant/Architecture.md`
- `assistant/DecisionLog.md`
- `assistant/modules/Knowledge.md`
- `assistant/modules/Tasks.md`
- `assistant/Interfaces.md`

Coach.AI documentation may be read for established repository patterns, but Coach-owned schema, Edge Functions, Actions, and contracts are protected.

## Scope

Implement:
1. `assistant_knowledge` persistence integrated with `assistant_objects`.
2. Knowledge capability operations:
   - `create_knowledge`
   - `update_knowledge`
   - `archive_knowledge`
   - `get_knowledge`
   - `list_knowledge`
   - `search_knowledge`
3. Edge Function/API implementation consistent with the existing Assistant Tasks patterns.
4. Automated tests.
5. Interface/schema documentation needed to make the implementation legible without this handoff.

Do not implement UI.

## Database requirements

Create a NEW append-only migration. Do not modify either already-applied Tasks migration:
- `202609260001_assistant_object_registry_tasks_v0.sql`
- `20260926091121_assistant_tasks_v0_invoker_hardening.sql`

The GitHub repository is connected to production Supabase. A merged migration or Edge Function change may deploy automatically. Treat the implementation PR as a production deployment gate.

Add `public.assistant_knowledge` with the representation and invariants defined in `assistant/modules/Knowledge.md`.

Requirements include:
- registry FK with stable `object_id`;
- `object_type='knowledge'` validation;
- protection against changing the registry type while a knowledge row exists;
- nonblank title/content;
- active/archived lifecycle and archive timestamp consistency;
- updated timestamp behavior;
- RLS enabled;
- no direct `anon` or `authenticated` table access;
- least privilege;
- any database RPCs used by Edge Functions must use `SECURITY INVOKER`, not `SECURITY DEFINER`;
- explicit function privileges consistent with the Tasks module.

Registry + knowledge creation must be one PostgreSQL transaction/capability operation so failure cannot leave an orphan registry row.

Do not alter the registry's intentionally open-ended `object_type` format constraint to enumerate known module types.

## API requirements

Follow the established Assistant response envelope and authentication pattern.

Operations must be capability-oriented rather than generic CRUD.

`update_knowledge` may mutate only title/content. Lifecycle transition is through `archive_knowledge`.

No public delete or unarchive operation in V0.

Reads use bounded pagination. Match Tasks' pagination convention unless a concrete reason requires otherwise.

List/search ordering must be deterministic and documented.

Search V0 may use simple case-insensitive matching across title and content. Keep retrieval mechanics hidden behind the `search_knowledge` capability.

## Required tests

At minimum cover:
- create produces both registry and knowledge records with one stable identity;
- failed knowledge creation leaves no orphan registry object;
- registry type mismatch is rejected;
- changing a live knowledge object's registry type is rejected;
- blank title rejected;
- blank content rejected;
- invalid status rejected at database boundary;
- archive sets status and timestamp consistently;
- archiving an already archived item is rejected;
- generic update cannot mutate identity/status/archive/audit fields;
- get success/not-found;
- list status filtering;
- list deterministic ordering and pagination/has-more behavior;
- search across title and content;
- search status filtering;
- search pagination;
- authorization/error envelope behavior;
- Tasks V0 behavior/contracts remain unchanged;
- Coach-owned files/contracts remain unchanged.

Where feasible, test real database invariants rather than only duplicating them in mocks. Static SQL-text assertions do not by themselves prove transactional behavior.

## Explicit exclusions

Do not add:
- provenance/source fields;
- Gmail/chat identifiers;
- reminders;
- recurrence;
- entities/assignees;
- tags/categories;
- embeddings/vector columns;
- generic JSON metadata;
- scheduling/calendar semantics;
- generic cross-module links;
- UI;
- changes to Tasks V0 schema/contract;
- changes to Coach.AI schema/contract.

## Completion criteria

The implementation is ready for review when:
- tests pass;
- migration is append-only and production-safe;
- Knowledge module invariants are enforced at appropriate boundaries;
- Edge Functions/API match the documented capability contract;
- no protected Coach/Tasks behavior was changed;
- docs reflect actual implementation;
- the PR description explicitly notes that merge may trigger Supabase deployment.
