# Classification V0

## Hidden design decision

Classification owns **how Assistant.AI gives durable objects a primary category and flexible tags for organization, filtering, grouping, and visual treatment**.

Classification does not change the meaning or lifecycle of the classified object. Tasks, Knowledge, Scheduling, and future modules do not gain category/tag columns.

## Semantics

V0 distinguishes:

- **Category** — zero or one primary classification for an object. It answers "where does this primarily belong?" and supplies the object's category color in UI projections.
- **Tag** — zero or many lightweight groupings. Tags answer "what sets does this belong to?" and do not determine primary visual treatment.

An object cannot have multiple categories in V0. Use tags for many-to-many grouping.

## Categories

Categories are durable, externally referenceable Assistant objects and use the Object Registry with object_type `category`.

Conceptual representation:

    assistant_categories
    object_id       uuid PK -> assistant_objects
    name            text not null
    color           text not null
    sort_order      integer not null default 0
    status          text not null -- active | archived
    archived_at     timestamptz null
    created_at      timestamptz
    updated_at      timestamptz

Category names are nonblank and case-insensitively unique.

Color is a canonical six-digit RGB hex string `#RRGGBB`. Classification owns this representation.

Lower sort_order values display first; name and object ID are deterministic tie-breakers.

Lifecycle is active -> archived. Archived is terminal in V0.

Archiving does not remove existing object assignments. Existing objects may still report the archived category and color. Archived categories cannot be newly assigned.

## Category assignment

Conceptually:

    assistant_object_categories
    target_object_id    uuid PK -> assistant_objects
    category_object_id  uuid -> assistant_categories
    assigned_at         timestamptz

The target primary key enforces zero-or-one category.

Assignments are Classification-private relationship state and have no registry identity.

Classification may categorize any existing registered target without knowing the target module's private representation.

Setting a category atomically replaces the prior category. Clearing removes only the assignment.

## Tags

Tags are durable, externally referenceable Assistant objects with registry type `tag`.

Conceptually:

    assistant_tags
    object_id       uuid PK -> assistant_objects
    name            text not null
    status          text not null -- active | archived
    archived_at     timestamptz null
    created_at      timestamptz
    updated_at      timestamptz

Tag names are nonblank and case-insensitively unique.

Lifecycle is active -> archived and terminal in V0. Archiving preserves existing assignments but prevents new ones.

Relationships:

    assistant_object_tags
    target_object_id  uuid -> assistant_objects
    tag_object_id     uuid -> assistant_tags
    assigned_at       timestamptz
    PK (target_object_id, tag_object_id)

Adding an existing tag is idempotent. Removing a missing tag is harmless.
Replacing an object's tag set is a complete replacement of the target's
Classification-owned tag assignments. It validates that every supplied Tag ID
is an existing active Tag before changing assignments, and applies the complete
replacement atomically.

## Interface

- create_category
- update_category
- archive_category
- get_category
- list_categories
- set_object_category
- clear_object_category
- create_tag
- update_tag
- archive_tag
- get_tag
- list_tags
- add_object_tag
- remove_object_tag
- replace_object_tags
- get_object_classification
- list_category_members
- list_tag_members

Category update may change active name, color, and sort_order. Tag update may rename an active tag. Generic updates cannot change identity/lifecycle/audit fields.

Category listing supports status and bounded pagination ordered by sort_order, lower(name), object_id. Tag listing uses lower(name), object_id.

New assignments require active category/tag objects. Existing archived assignments remain readable and removable.
Complete tag replacement likewise requires all supplied Tags to be active and
does not partially apply when any supplied Tag is missing or archived.

get_object_classification returns the target's category, if any, and assigned tags, including archived assigned classification.

Member-list operations return deterministic bounded target registry identities for composition. They do not return another module's private fields.

## Invariants

- C1. Every Category has one registry object of type `category`.
- C2. Every Tag has one registry object of type `tag`.
- C3. Category/Tag registry identities are stable and protected.
- C4. Names are nonblank and case-insensitively unique within their kind.
- C5. Category color is canonical `#RRGGBB`.
- C6. Status is active or archived; archived_at is populated iff archived.
- C7. Archived categories/tags are terminal.
- C8. Each target has at most one category.
- C9. A target/tag pair appears at most once.
- C10. All relationship identities exist in Object Registry.
- C11. New assignments require active categories/tags.
- C12. Archiving does not implicitly delete assignments.
- C13. Assignment removal does not mutate registered objects.
- C14. Classification never reads or writes another module's private tables.
- C15. Category/tag creation coordinates registry + owned row atomically.
- C16. Assignment rows are not registry objects.

## Deliberate exclusions

V0 excludes hierarchical categories, multiple categories per object, tag colors, category icons, arbitrary metadata, automatic classification rules, inheritance, public deletion, saved filters/views, and UI-specific grouping definitions.

Natural-language classification belongs to the calling agent.
