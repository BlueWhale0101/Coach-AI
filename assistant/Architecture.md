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
- Classification: primary categories, colors, and flexible tags across registered objects.
- Attention: explicit user-selected prominence/pinning across registered objects.
- Projection: read-only assembly of independently modeled objects for specific consumption surfaces.
- MCP / Plugin Surface: safe agent-facing presentation of existing Assistant capabilities.
- Capture: transformation of external input into operations on durable modules.
- Entities: durable identity for people/places/things; deferred until demonstrated need.

Generic graph-style Links are deferred. Known semantic relationships should use explicit references to registry object IDs.

## Cross-module rule

A module must not directly manipulate another module's private representation. Cross-module behavior should occur through module interfaces.

Physical co-location in one database or Edge Function deployment does not remove the logical boundary.

## Execution model

Assistant.AI deliberately has no continuously running agent or orchestration loop.

Durable truth lives in Supabase. Interactive chat and UI operations write state synchronously through module interfaces. UIs may react to Supabase change/realtime signals for prompt display updates.

External systems and derived state are reconciled periodically by scheduled ChatGPT tasks rather than by a custom always-on worker. A typical household cadence may run several times per day, with an important early-morning reconciliation before the household wakes. Immediate freshness remains available by asking the interactive agent to reconcile on demand.

The architecture therefore accepts **bounded staleness**—usually hours—for external sources in exchange for substantially lower infrastructure and orchestration complexity.

Periodic reconciliation must be designed around:
- idempotent operations;
- checkpoints that advance only after successful processing;
- lightweight provenance/auditability for inferred changes;
- explicit conflict policy at external-system adapter boundaries.

Precise notification deadlines are a separate concern: a reminder that must surface at an exact time may use an existing scheduled ChatGPT/notification facility without introducing a general continuous backend loop.

Do not introduce queues, background workers, webhook infrastructure, custom LLM orchestration services, or backend cron merely to reduce ordinary household-state staleness unless a demonstrated requirement justifies them.

## Development model

The repository is the durable source of architectural intent.

- Main design chat: architecture, contracts, small changes, inspection, troubleshooting, iterative feedback.
- Codex: bounded implementation packages with clear inputs, constraints, tests, and completion criteria.
- Throwaway chats: substantial enhancement rounds with explicit entry and exit gates.

Implementation agents should be able to understand module ownership without reconstructing prior conversations.


## Deployment model

The repository is connected to the shared Supabase project through GitHub integration. Changes merged to deployment-managed Supabase definitions can therefore deploy automatically; merging such changes is a production-affecting operation, not merely source control bookkeeping.

Development rules:
- Treat a PR that changes Supabase migrations or Edge Functions as a deployment review gate.
- Do not assume a separate manual deploy step will follow merge.
- Before merge, review database privileges, RLS posture, Edge Function authentication, and compatibility with Coach.AI.
- After merge, verify the live Supabase state and run relevant integration checks/advisors.
- Never rewrite an already-applied migration to represent a later production change. Add a new forward migration so repository history and Supabase migration history remain reproducible.
