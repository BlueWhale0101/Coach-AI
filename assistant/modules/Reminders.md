# Reminders V0

## Hidden design decision

Reminders owns **how Assistant.AI represents a request for an existing durable object to be surfaced at a particular time**.

A reminder is not the task, fact, appointment, or other substantive object. It is a time-based surfacing request that refers to another registered Assistant object.

Examples:

- "Pay Jenny" is a Task. "Remind me at 5 PM" creates a Reminder targeting that Task.
- A durable fact can be Knowledge. "Remind me tomorrow morning" creates a Reminder targeting that Knowledge.

Reminder semantics must not leak into Tasks, Knowledge, Scheduling, or other owning modules.

## V0 representation

```text
assistant_reminders
-------------------
object_id        uuid primary key references assistant_objects(id)
target_object_id uuid not null references assistant_objects(id)
remind_at        timestamptz not null
status           text not null
delivered_at     timestamptz null
cancelled_at     timestamptz null
created_at       timestamptz not null default now()
updated_at       timestamptz not null default now()
```

Allowed status values:

- `pending`
- `delivered`
- `cancelled`

Every reminder has its own registry identity with `object_type = 'reminder'`.

## Meaning of delivery

`delivered` means Assistant.AI has processed the reminder as due and handed it to the configured notification or surfacing mechanism.

It does **not** mean the human definitely saw or acknowledged it.

Delivery mechanism is outside this module. Do not add channel, device, notification text, push-provider state, ChatGPT automation IDs, email fields, or similar delivery-policy representation to Reminders V0.

## Target semantics

`target_object_id` refers to the substantive registered object to surface.

V0 rules:

- target must exist in `assistant_objects`;
- reminder cannot target itself;
- reminder cannot target an object whose `object_type` is `reminder`;
- target lifecycle does not automatically cancel or delete the reminder;
- reminder does not duplicate the target title/content.

This permits reminders for completed Tasks, archived Knowledge, and future registered object types when that is semantically useful.

## Lifecycle

V0 transitions:

```text
pending -> delivered
pending -> cancelled
```

`delivered` and `cancelled` are terminal.

Only a pending reminder may have its `remind_at` changed.

## Interface

```text
create_reminder(target_object_id, remind_at)
update_reminder_time(object_id, remind_at)
cancel_reminder(object_id)
mark_reminder_delivered(object_id)
get_reminder(object_id)
list_reminders(...)
```

### create_reminder

Atomically creates:

1. an `assistant_objects` row with `object_type = 'reminder'`;
2. the `assistant_reminders` row.

The target must already exist and must not be a reminder.

### update_reminder_time

Changes only `remind_at`.

Reject attempts to edit terminal reminders. Generic arbitrary patch/update semantics are intentionally excluded.

### cancel_reminder

Transitions a pending reminder to cancelled and records `cancelled_at` atomically.

Reject repeated cancellation and transitions from delivered.

### mark_reminder_delivered

Transitions a pending reminder to delivered and records `delivered_at` atomically.

This is a system-facing semantic capability as well as an API capability. It does not claim human acknowledgement.

### get_reminder

Returns one reminder by registry identity. Missing IDs and wrong object types must be distinguishable from successful retrieval.

### list_reminders

Supports deterministic retrieval by:

- `status?`
- `target_object_id?`
- `due_after?`
- `due_before?`
- bounded `limit`
- `offset`

Ordering must be deterministic. V0 default: `remind_at ASC, created_at ASC, object_id ASC`.

A notification worker can therefore ask for pending reminders due by a given time without learning the private table representation.

No textual `search_reminders` capability exists in V0.

## Invariants

- R1. Every reminder row has exactly one registry object whose `object_type` is `reminder`.
- R2. `object_id` is stable for the lifetime of the reminder.
- R3. `target_object_id` references an existing registered Assistant object.
- R4. A reminder cannot target itself.
- R5. A reminder cannot target an object whose registry type is `reminder`.
- R6. Status is exactly one of `pending`, `delivered`, or `cancelled`.
- R7. `delivered_at` is non-null iff status is `delivered`.
- R8. `cancelled_at` is non-null iff status is `cancelled`.
- R9. Delivered and cancelled are terminal in V0.
- R10. Only pending reminders may change `remind_at`.
- R11. Registry + reminder creation is atomic through the Reminders interface.
- R12. Registry type cannot change away from `reminder` while a reminder row exists.
- R13. Changes to the target object's lifecycle do not implicitly mutate the reminder.
- R14. Delivery-channel/provider state is not part of Reminders V0.
- R15. Recurrence is not part of Reminders V0.

Enforce local relational/lifecycle invariants in PostgreSQL where practical rather than relying solely on Edge Functions.

## Deliberate exclusions

V0 does not include:

- recurrence or repeating rules;
- natural-language time parsing;
- notification channel selection;
- device/provider IDs;
- human acknowledgement/read receipts;
- snooze;
- reminder text duplicated from the target;
- textual search;
- generic cross-module links;
- cascading lifecycle behavior from target objects.

Natural-language interpretation belongs to the calling agent. Recurrence belongs to a future Recurrence module. Delivery implementation belongs behind a separate boundary.

## Relationship to other modules

Tasks and Knowledge own their substantive state. Reminders only owns when a registered object should be surfaced.

Future Scheduling objects may also be reminder targets without requiring a Reminders schema redesign.

Future Recurrence may generate or re-arm reminder occurrences, but recurrence rules must remain outside the Reminders private representation.
