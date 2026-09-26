# Assistant.AI Architecture

Status: early design

Assistant.AI is a persistent personal/household state system exposed through conversational, mobile, and ambient interfaces.

## Architectural principle

Modules are organized around durable design decisions rather than UI screens or incidental data groupings. Each module owns its representation and exposes a stable interface. Other modules should not depend on its private tables.

This follows the information-hiding approach associated with Parnas: isolate decisions likely to change behind module interfaces.

## Relationship to Coach.AI

Assistant.AI and Coach.AI share the same Supabase project, but they are separate subsystems.

Existing Coach tables, Edge Functions, GPT Actions, and interface contracts are protected. Assistant development must not modify Coach-owned objects unless an explicit integration decision is made.

Assistant may reuse implementation patterns from Coach, but not its domain tables.

## Interface surfaces

The same durable Assistant state may be used by:
- conversational ChatGPT/GPT tools for reasoning and manipulation;
- a phone UI for capture, browsing, search, and management;
- a kitchen/tablet UI for ambient calendar and household views.

No interface owns the data model.

## Initial module map

- Object Registry: cross-module durable identity.
- Tasks: actionable commitments and their lifecycle.
- Knowledge: durable reference information.
- Scheduling: things situated in time.
- Recurrence: repeating rules and occurrence generation.
- Reminders: conditions under which an object should surface.
- Capture: transformation of external input into operations on durable modules.
- Entities: durable identity for people/places/things; deferred until demonstrated need.

Generic graph-style Links are deferred. Known semantic relationships should use explicit references to registry object IDs.

## Cross-module rule

A module must not directly manipulate another module's private representation. Cross-module behavior should occur through module interfaces.

Physical co-location in one database or Edge Function deployment does not remove the logical boundary.

## Development model

The repository is the durable source of architectural intent.

- Main design chat: architecture, contracts, small changes, inspection, troubleshooting, iterative feedback.
- Codex: bounded implementation packages with clear inputs, constraints, tests, and completion criteria.
- Throwaway chats: substantial enhancement rounds with explicit entry and exit gates.

Implementation agents should be able to understand module ownership without reconstructing prior conversations.
