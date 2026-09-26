# Scheduling V0

## Hidden design decision

Scheduling owns **how Assistant.AI represents something positioned on a calendar**, including both timed intervals and all-day date intervals.

Scheduling does not own tasks, reminders, recurrence, natural-language time parsing, or external calendar synchronization.

Examples:

- "Dentist appointment Tuesday at 2 PM" is Scheduling.
- "Book the dentist" is a Task.
- "Dentist is Dr. Smith" is Knowledge.
- "Remind me an hour before the dentist" is a Reminder targeting the scheduled event.
- Repeating calendar rules belong to future Recurrence.

## V0 representation

```text
assistant_schedule_events
-------------------------
object_id       uuid primary key references assistant_objects(id)

title           text not null
description     text null

time_kind       text not null -- timed | all_day

starts_at       timestamptz null
ends_at         timestamptz null
timezone        text null

start_date      date null
end_date        date null

status          text not null -- scheduled | cancelled
cancelled_at    timestamptz null

created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```

Every schedule event has registry identity with `object_type = 'schedule_event'`.

## Timed events

A timed event represents a real interval between two instants.

For `time_kind = 'timed'`:

- `starts_at`, `ends_at`, and `timezone` are required;
- `start_date` and `end_date` are null;
- `starts_at < ends_at`;
- `timezone` is a valid PostgreSQL/IANA timezone name.

The timestamps identify the actual instants. The timezone preserves the human calendar context in which the event was expressed and should be displayed.

The storage layer does not invent a duration when one is unknown.

## All-day events

An all-day event represents a half-open date interval.

For `time_kind = 'all_day'`:

- `start_date` and `end_date` are required;
- `starts_at`, `ends_at`, and `timezone` are null;
- `start_date < end_date`.

`end_date` is exclusive. Therefore an event occupying only 2026-11-14 is represented as `[2026-11-14, 2026-11-15)`.

All-day events are not represented as midnight timestamps.

## Lifecycle

V0 statuses:

- `scheduled`
- `cancelled`

Cancellation preserves the historical calendar object.

`cancelled_at` is non-null iff status is `cancelled`.

Cancelled events are terminal and cannot be edited in V0.

Scheduling deliberately has no `completed` status. A past event remains a historical scheduled event.

## Interface

```text
create_schedule_event
update_schedule_event
cancel_schedule_event
get_schedule_event
list_schedule_events
search_schedule_events
```

### create_schedule_event

Atomically creates the registry object and schedule-event row.

The caller supplies either a complete timed representation or a complete all-day representation. Natural-language parsing is outside Scheduling.

### update_schedule_event

Updates mutable event-owned properties while status is `scheduled`:

- title;
- description;
- calendar placement.

Rescheduling is an update to the same event identity.

A caller may change between timed and all-day representation only by supplying a complete, valid replacement temporal representation. The database must never expose a mixed or partially converted state.

The operation cannot modify identity, lifecycle status, cancellation timestamp, or audit timestamps.

### cancel_schedule_event

Transitions `scheduled -> cancelled` and records `cancelled_at` atomically.

Repeated cancellation is rejected.

### get_schedule_event

Returns one event by registry identity.

### list_schedule_events

Provides deterministic calendar retrieval. It supports:

- `status?`;
- `overlapping_start?`;
- `overlapping_end?`;
- bounded `limit`;
- `offset`.

The temporal filter contract means **events overlapping the requested interval**. It must work correctly for both timed and all-day events without callers learning the private representation.

For V0, callers should provide the overlap bounds appropriate to the event kind they are querying; the API may expose separate timestamp/date overlap fields if that keeps the contract unambiguous. Do not silently convert an all-day date into a timestamp using a server timezone.

Default ordering should produce stable chronological calendar results, with registry ID as the final tie-breaker.

### search_schedule_events

Finds schedule events relevant to a textual query over event-owned human-readable content.

The contract does not promise substring matching or any specific search technology. V0 may use simple case-insensitive title/description matching; search mechanics remain private.

Search supports status and bounded pagination and returns deterministic results.

## Invariants

- S1. Every schedule-event row has exactly one registry object whose `object_type` is `schedule_event`.
- S2. `object_id` is stable for the event lifetime.
- S3. Title is nonblank.
- S4. `time_kind` is exactly `timed` or `all_day`.
- S5. Timed events have non-null `starts_at`, `ends_at`, and `timezone`, and null date fields.
- S6. Timed events satisfy `starts_at < ends_at`.
- S7. Timed-event timezone is a valid PostgreSQL/IANA timezone name.
- S8. All-day events have non-null `start_date` and `end_date`, and null timestamp/timezone fields.
- S9. All-day events satisfy `start_date < end_date`; end date is exclusive.
- S10. Status is exactly `scheduled` or `cancelled`.
- S11. `cancelled_at` is non-null iff status is `cancelled`.
- S12. Cancelled events are terminal and immutable in V0.
- S13. Registry + event creation is atomic through the Scheduling interface.
- S14. Registry type cannot change away from `schedule_event` while an event row exists.
- S15. Generic update cannot modify identity, lifecycle, cancellation, or audit fields.
- S16. Changing between timed and all-day representation is atomic and cannot expose a mixed temporal state.
- S17. Reminder behavior is not implemented in Scheduling.
- S18. Recurrence is not implemented in Scheduling.
- S19. External calendar provider state is not implemented in Scheduling.
- S20. Search mechanics are private implementation detail.

Enforce local relational, temporal, and lifecycle invariants in PostgreSQL where practical.

## Timezone validation

V0 stores the canonical timezone name as text but validates it against PostgreSQL's available timezone names at the database boundary.

Do not use a database enum or hard-coded application list of timezone names.

The API requires absolute timestamps to include `Z` or an explicit UTC offset. The separate timezone field preserves display/calendar context and must not be inferred from that offset alone.

## Deliberate exclusions

V0 does not include:

- recurrence;
- reminders or notification settings;
- natural-language date/time parsing;
- free-text or structured location;
- attendees;
- organizer semantics;
- external Google/Apple/Outlook calendar IDs;
- sync state;
- RSVP state;
- travel time;
- availability/free-busy policy;
- arbitrary metadata JSON;
- deletion as a public capability.

Location is deliberately deferred rather than adding a free-text field that may later conflict with an Entities/Places model. Descriptive location information may temporarily live in `description`.

## Relationship to other modules

Tasks own actionable commitments. Knowledge owns durable reference information. Scheduling owns calendar placement. Reminders may target schedule-event registry objects without knowing Scheduling's representation.

Future Recurrence may create or manage repeated schedule occurrences, but recurrence rules must remain outside Scheduling's private representation.

Future external-calendar integration should be an adapter around Scheduling rather than embedding provider-specific representation in this module.
