# Knowledge Module

Status: V0 design accepted

## Hidden design decision

Knowledge owns how Assistant.AI represents durable information worth remembering, independent of where the information came from or how an interface presents it.

A knowledge item is one coherent piece of durable reference information. It is not an actionable commitment and does not become done.

Examples:
- Spare air filters are on the top shelf in the garage.
- Susan prefers text messages.
- Tor's library card is in the kitchen drawer.
- The Gardena house uses a 20×25×1 HVAC filter.
- A vendor quote and its useful summary.

## Representation

Knowledge items use the Object Registry for durable cross-module identity.

Conceptual schema:

```text
assistant_objects
  id
  object_type = "knowledge"
  created_at
        |
        +-- assistant_knowledge
              object_id
              title
              content
              status
              archived_at
              created_at
              updated_at
```

V0 fields:
- `object_id uuid primary key`, referencing `assistant_objects(id)`.
- `title text not null`, nonblank.
- `content text not null`, nonblank.
- `status text not null`, one of `active` or `archived`; default `active`.
- `archived_at timestamptz null`.
- `created_at timestamptz not null default now()`.
- `updated_at timestamptz not null default now()`.

Content is text, not arbitrary JSONB. Knowledge owns human-readable durable reference information, not an untyped metadata container.

## Lifecycle

V0 lifecycle:
- `active`: available as current reference information.
- `archived`: retained but not normally treated as current knowledge.

Archived does not imply false. An item may be archived because it is outdated, superseded, no longer useful, or intentionally put away.

Editing an active item's title/content is allowed. If preserving a historical distinction matters, callers should archive the old item and create a new item.

V0 does not expose an unarchive operation.

## Invariants

K1. Every knowledge row has exactly one registry object whose `object_type` is `knowledge`.
K2. `object_id` is stable for the lifetime of the item.
K3. `title` and `content` are nonblank.
K4. Status is exactly `active` or `archived`.
K5. `status = 'archived'` iff `archived_at` is non-null.
K6. Registry and knowledge creation are atomic through the Knowledge interface.
K7. A registry object's type cannot be changed away from `knowledge` while its knowledge row exists.
K8. Generic update cannot modify identity, status, archive timestamp, or audit timestamps.
K9. Search mechanics are private implementation detail; callers depend on semantic textual retrieval, not a particular SQL/search technology.
K10. No source-specific provenance, reminders, recurrence, entities, tags/categories, or embeddings are part of Knowledge V0.

Prefer database constraints/triggers for invariants PostgreSQL can enforce locally.

## Interface

Knowledge V0 exposes capability-oriented operations:

### create_knowledge
Creates the registry object and knowledge row atomically.

Inputs:
- `title`
- `content`

Returns the created knowledge item.

### update_knowledge
Updates mutable Knowledge-owned content only.

Inputs:
- `object_id`
- one or more of `title`, `content`

Must not permit arbitrary status/lifecycle or identity mutation.

### archive_knowledge
Transitions an active item to archived and sets `archived_at` atomically.

Archiving an already archived item is an invalid lifecycle transition.

### get_knowledge
Retrieves one item by stable object ID.

### list_knowledge
Deterministic browsing operation. V0 supports:
- optional status filter;
- bounded limit/offset pagination;
- deterministic ordering.

### search_knowledge
Finds knowledge relevant to a textual query, with:
- required nonblank `query`;
- optional status filter;
- bounded limit/offset pagination;
- deterministic ordering.

V0 may implement search with simple title/content substring matching. The interface must not promise substring semantics, because retrieval may later change to PostgreSQL FTS, trigram, embeddings, or hybrid retrieval.

## Explicit non-responsibilities

Knowledge does not own:
- where information came from or source identifiers: Capture/provenance;
- notification timing: Reminders;
- repeating behavior: Recurrence;
- people/place/thing identity: Entities;
- actionable commitments: Tasks;
- calendar semantics: Scheduling;
- tags or taxonomy;
- embedding/vector representation;
- natural-language interpretation.

A conversational agent decides that an utterance is worth storing as Knowledge and supplies structured operation inputs.

## UI implications

A required title gives phone/tablet/search surfaces a compact representation without loading full content. If the user does not provide a title, the conversational agent may generate one.

No UI surface owns Knowledge state.
