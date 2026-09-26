# Attention V0

## Hidden design decision

Attention owns **which durable Assistant objects the user has explicitly selected for prominent surfacing**.

The first behavior is "pin" or "bump this so it appears on the main page."

Attention is distinct from Task priority: a low-priority Task may be pinned while a high-priority Task may remain unpinned.

## Representation

Conceptually:

    assistant_pins
    target_object_id  uuid PK -> assistant_objects
    pinned_at         timestamptz not null default now()

A pin is relationship/attention state, not a substantive Assistant object, so it has no registry identity.

Any existing registered Assistant object may be pinned. Attention does not inspect the target module's private representation.

## Interface

- pin_object
- unpin_object
- is_object_pinned
- list_pinned_objects

pin_object is idempotent. Re-pinning preserves the original pinned_at; V0 does not interpret it as ranking or "move to top."

unpin_object is idempotent.

is_object_pinned returns whether the target is pinned and pinned_at when present.

list_pinned_objects is bounded and deterministic, ordered by pinned_at DESC, target_object_id ASC. It returns target identities and pin state, not another module's private fields.

## Invariants

- A1. Every pin targets an existing Object Registry identity.
- A2. A target can be pinned at most once.
- A3. Pin/unpin never mutates the target.
- A4. Repeated pin preserves pinned_at.
- A5. Repeated unpin is harmless.
- A6. Pins have no registry identity.
- A7. Attention does not encode Task priority, due dates, reminder semantics, category, or tag state.
- A8. Attention never reads or writes another module's private tables.

## Deliberate exclusions

V0 excludes pin ranking/manual ordering, expiration, reasons/notes, notification behavior, automatic pinning rules, per-device pin sets, multiple attention levels, and arbitrary metadata.

If future usage demonstrates a need beyond binary explicit prominence, that is a future Attention design decision.
