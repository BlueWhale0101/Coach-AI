# Assistant.AI Decision Log

## 2026-09-26 — Modularize Around Hidden Design Decisions
Status: accepted

Decision:
Organize Assistant.AI into modules that each hide a durable design decision and expose an interface. Tables belong to modules; UI surfaces do not own domain state.

Reason:
Changes inside one capability should not force unrelated modules or interfaces to understand its representation. The architecture should also remain legible to multiple implementation agents.

Consequences:
- Cross-module direct table manipulation is prohibited.
- Module contracts are documented before substantial implementation.
- Physical deployment may remain monolithic while logical module boundaries remain explicit.

## 2026-09-26 — Share Supabase Project, Separate Coach and Assistant Contracts
Status: accepted

Decision:
Assistant.AI will use the existing Supabase project used by Coach.AI, while introducing separate Assistant-owned tables, functions, and interfaces.

Reason:
The systems benefit from a shared personal knowledge space, while Coach's working domain model and action contracts should remain stable.

Consequences:
- Existing Coach objects are protected.
- Assistant integration with Coach is additive and explicit.
- Assistant does not repurpose generic-looking Coach tables such as log_entries or fitness_events.

## 2026-09-26 — Use an Object Registry for Cross-Module Identity
Status: accepted

Decision:
Introduce assistant_objects as a minimal identity kernel. Every Assistant object that may be referenced across module boundaries receives one durable registry identity.

The registry owns identity and type only. Domain meaning and mutable state remain in the owning module.

Reason:
Direct foreign keys between every pair of modules create coupling. Fully generic typed links lose database referential integrity. A registry provides stable FK targets without requiring generic modules to know another module's physical table.

Consequences:
- Other modules reference object IDs rather than another module's private primary keys.
- assistant_objects must remain deliberately minimal.
- Do not add title, status, arbitrary metadata, dates, or domain state to the registry.
- Object creation/deletion and the owning module row must be coordinated transactionally by the owning interface.
- Generic assistant_links is deferred until real many-to-many relationship requirements appear.

## 2026-09-26 — Tasks V0 Owns Only Actionable Commitment State
Status: accepted

Decision:
The Tasks module represents things that can become done. V0 status is open, completed, or cancelled. It may own intrinsic action timing (not_before and due_at), but does not own reminders, recurrence, external provenance, people/entities, or natural-language interpretation.

Reason:
Keeping these decisions separate allows reminders, recurrence, capture, and identity to evolve without redesigning Tasks.

Consequences:
- No remind_at or recurrence_rule columns in assistant_tasks.
- No Gmail/chat/source-specific IDs in assistant_tasks.
- Assignee support is deferred until an Entity/People identity capability exists.
- Task completion and cancellation are semantic operations, not arbitrary status-field mutations.


## 2026-09-26 — Treat GitHub Merge as the Supabase Deployment Gate
Status: accepted

Decision:
The shared Supabase project is connected to this GitHub repository. For deployment-managed Supabase definitions, merge to the deployment branch may cause production deployment automatically. PR review is therefore the primary pre-deployment gate.

Production schema changes must be represented by append-only forward migrations. Once a migration has been applied to Supabase, later changes must not be represented only by editing that historical migration.

Reason:
Tasks V0 exposed both behaviors: its Edge Functions deployed through the GitHub integration before a manual deployment was attempted, and the initial Tasks migration had already been applied before its RPC security mode was changed in source. A second live migration was required to bring production to the intended state.

Consequences:
- Supabase-affecting PRs are production-affecting changes.
- Codex and other implementation agents must not describe merge and deploy as necessarily separate steps.
- Applied migrations are immutable history; corrections use new migrations.
- Post-merge verification should compare live Supabase state with repository intent.


## 2026-09-26 — Knowledge V0 Owns Durable Reference Information
Status: accepted

Decision:
The Knowledge module represents coherent pieces of durable human-readable reference information. V0 stores a required title and textual content and has a minimal active/archived lifecycle.

Knowledge search is a module capability whose retrieval mechanics are private. V0 may use simple textual matching without making substring behavior part of the contract.

Reason:
Assistant needs a durable answer to “remember this” that is distinct from actionable Tasks. Keeping provenance, reminders, recurrence, entities, taxonomy, and retrieval technology outside the representation allows those decisions to evolve independently.

Consequences:
- Knowledge objects use the Object Registry with `object_type = 'knowledge'`.
- Title and content are required and nonblank.
- Active items may be treated as current reference information; archived items are retained but not normally current.
- Generic update changes title/content only; archiving is a semantic operation.
- V0 has no unarchive or public delete operation.
- Knowledge contains no source-specific provenance, tags/categories, entities, reminders, recurrence, embeddings, arbitrary JSON metadata, or scheduling semantics.


## 2026-09-26 — Reminders V0 Owns Time-Based Surfacing Requests

**Status:** Accepted

Reminders owns how Assistant.AI represents a request for an existing registered object to be surfaced at a particular time.

A reminder is a separate registry object targeting a substantive Assistant object. V0 supports one absolute `remind_at` timestamp and a `pending -> delivered|cancelled` lifecycle. Delivery means the reminder has been processed and handed to the configured surfacing mechanism; it does not assert that the human saw it.

Reminder targets may be Tasks, Knowledge, or future substantive registry types, but V0 prohibits reminders targeting reminders. Target lifecycle changes do not implicitly cancel or delete reminders.

Recurrence, natural-language time parsing, delivery channels/providers, acknowledgement, snooze, and duplicated reminder text are deliberately outside the module.


## 2026-09-26 — Scheduling V0 Owns Calendar Placement

**Status:** Accepted

Scheduling owns how Assistant.AI represents something positioned on a calendar. It distinguishes timed intervals from all-day date intervals rather than encoding all-day events as midnight timestamps.

Timed events preserve both absolute start/end instants and a validated IANA/PostgreSQL timezone name for human calendar context. All-day events use half-open date intervals with an exclusive end date. The two temporal representations are mutually exclusive.

Schedule events have a `scheduled -> cancelled` lifecycle; there is no completed state. Rescheduling preserves event identity, and scheduled events may atomically convert between complete timed and all-day representations.

Recurrence, reminders, natural-language time parsing, location/entities, attendees, provider-specific calendar IDs, and external synchronization are deliberately outside Scheduling V0.

## 2026-09-26 — Prefer Periodic Reconciliation Over a Continuous Agent Loop

**Status:** Accepted

Assistant.AI will not maintain a continuously running agent or general orchestration worker. Supabase is durable truth; interactive chat/UI changes are written synchronously and may propagate to UIs through Supabase change/realtime mechanisms.

External sources such as Google Calendar and Gmail will normally be reconciled by scheduled ChatGPT tasks several times per day, with an important early-morning refresh. Interactive chat may request an immediate reconciliation when freshness matters.

The system deliberately accepts bounded external-state staleness, typically measured in hours, because household state changes slowly and the operational value of second-level freshness is low.

Consequences:
- Scheduled reconciliation must be idempotent and checkpointed.
- Checkpoints advance only after successful processing.
- External adapters need explicit conflict policy and useful provenance/audit information.
- Precise reminder delivery may use an existing exact scheduling/notification facility without creating a general continuous loop.
- Queues, custom background workers, webhooks, backend cron, and custom LLM orchestration are not default architecture; they require a demonstrated need.
- LLM reasoning should perform semantic interpretation; deterministic Assistant module interfaces and PostgreSQL constraints protect durable state.


## 2026-09-26 — Recurrence V0 Owns Repeating Rules and Occurrence Identity

**Status:** Accepted

Recurrence owns repeating-rule semantics, calendar arithmetic, and the ledger of concrete objects already materialized for a series. It does not own or clone the private representation of Tasks or Schedule Events.

V0 supports calendar-anchored and completion-relative recurrence. Frequencies are daily, weekly, monthly, and yearly with positive intervals; weekly calendar rules may select ISO weekdays. Calendar recurrence distinguishes instant/timezone anchors from date-only anchors and uses human calendar arithmetic rather than fixed-second approximations.

Each recurrence is a registered object and begins from an existing Task or Schedule Event seed. Its occurrence ledger records the seed and later generated objects, providing idempotence when periodic reconciliation runs late or repeatedly.

Completion-relative recurrence is Task-only in V0 and calculates the next occurrence from actual completion time. Calendar recurrence can be queried for missing occurrences within explicit bounded horizons.

Consequences:
- Recurrence has no continuously running worker.
- Scheduled ChatGPT reconciliation or interactive orchestration asks Recurrence what occurrences are missing.
- The orchestrator creates concrete Tasks/Events through their owning module interfaces and then records them with Recurrence.
- Recurrence never directly reads/writes another module's private tables to clone an occurrence.
- Ending a recurrence does not mutate already-materialized objects.
- Full RRULE compatibility, advanced positional rules, holiday calendars, provider recurrence IDs, and reminder delivery are deferred.
