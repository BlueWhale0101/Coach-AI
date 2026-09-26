# Tasks Module — V0 Contract

Status: accepted for implementation

## Hidden decision

Tasks hides how Assistant.AI represents an actionable commitment and its lifecycle.

A task is something that can become done.

## Ownership

Tasks owns:
- title and optional description;
- lifecycle state;
- optional explicit priority;
- intrinsic action window: not_before and due_at;
- completion/cancellation timestamps;
- task timestamps.

Tasks does not own:
- reminders or notification delivery;
- recurrence;
- calendar event representation;
- natural-language interpretation;
- email/chat/external provenance;
- people/entity identity or assignment in V0.

## Proposed representation

assistant_tasks:
- object_id uuid primary key, FK to assistant_objects(id)
- title text not null
- description text null
- status text not null: open | completed | cancelled
- priority text null: low | normal | high
- not_before timestamptz null
- due_at timestamptz null
- completed_at timestamptz null
- cancelled_at timestamptz null
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

NULL priority means no explicit priority has been assigned.

not_before means the task should not yet be considered actionable.
due_at means the obligation should be completed by that time.
Neither means the user should be notified; that belongs to Reminders.

## Invariants

T1. Every task has exactly one registry object whose object_type is task.
T2. object_id is stable for the task's lifetime.
T3. status=completed requires completed_at; otherwise completed_at is null.
T4. status=cancelled requires cancelled_at; otherwise cancelled_at is null.
T5. A task cannot be completed and cancelled simultaneously.
T6. When both are present, not_before <= due_at.
T7. Tasks contains no reminder implementation.
T8. Tasks contains no recurrence implementation.
T9. Tasks contains no source-specific provenance fields.
T10. Registry-row and task-row creation/deletion are coordinated transactionally through the Tasks interface.

Prefer database constraints for invariants that PostgreSQL can enforce locally.

## V0 interface

### create_task
Creates the registry identity and task atomically.

Inputs:
- title required
- description optional
- priority optional
- not_before optional
- due_at optional

Returns at minimum the durable object_id and resulting task state.

### update_task
Updates task-owned mutable properties. It must not manipulate reminders, recurrence, capture provenance, or other modules.

### complete_task
Semantic operation. Atomically transitions an open task to completed and records completed_at.

### cancel_task
Semantic operation. Atomically transitions an open task to cancelled and records cancelled_at.

### get_task
Returns one task by durable object identity.

### list_tasks
Deterministic structured retrieval. V0 should support useful filters such as status, priority, due range/actionability, plus limit and offset.

### search_tasks
Textual recall over task-owned textual fields. Initial implementation may be simple; search mechanics are hidden by the module contract.

## Semantic boundary

The GPT/caller decides whether user language represents a task and supplies structured arguments. Tasks validates and persists task semantics; it does not interpret natural language.

Example:
"I need to bring my badge tomorrow. Remind me tonight."

The orchestrator creates a Task for the actionable commitment and, once Reminders exists, separately asks Reminders to surface that task tonight.

## Deferred decisions

- assignment/assignee;
- richer workflow states such as blocked, waiting, deferred, in_progress;
- tags/categories/projects;
- arbitrary cross-object links;
- recurrence;
- reminder behavior;
- task history/revisions.

These should be added only when usage demonstrates the requirement.
