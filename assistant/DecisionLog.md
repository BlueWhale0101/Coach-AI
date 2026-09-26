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
