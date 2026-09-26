# Recurrence V0

## Hidden design decision

Recurrence owns **how Assistant.AI represents repeating rules, calculates occurrence positions, and records which concrete objects have already been materialized**.

Recurrence does not own the substantive Task or Schedule Event. It does not clone another module's private rows. Creation of a concrete occurrence is orchestration across module interfaces.

Examples:

- "Put the bins out every Thursday" is a calendar recurrence associated with a Task.
- "CrossFit every Monday, Wednesday, and Friday at 06:00" is a calendar recurrence associated with a Schedule Event.
- "Change the HVAC filter every three months after I actually do it" is completion-relative recurrence associated with a Task.
- "Remind me every Thursday" is not implemented by putting recurrence fields in Reminders; an orchestrator may create concrete reminders/targets from recurrence later.

## Execution assumption

Assistant.AI has no continuously running recurrence worker.

Calendar occurrences may be materialized by periodic scheduled ChatGPT reconciliation. Completion-relative occurrences may be materialized immediately by an interactive agent when it completes a Task, or by a later reconciliation run.

Correctness therefore depends on **idempotent occurrence recording**, not on a continuously running loop or exact execution time.

## V0 supported semantics

V0 supports two bases:

- `calendar` — occurrences are anchored to human calendar positions independent of when previous occurrences were completed.
- `after_completion` — the next occurrence is calculated from the actual completion of the preceding Task occurrence.

V0 frequencies:

- `daily`
- `weekly`
- `monthly`
- `yearly`

Every rule has a positive integer `interval_count`.

Weekly calendar rules may additionally select one or more weekdays. Weekdays are rule data, not a separate frequency.

V0 deliberately does not attempt full iCalendar RRULE compatibility.

## Registry and series membership

Each recurrence has registry identity with `object_type = 'recurrence'`.

A recurrence has one `seed_object_id`: the existing registered object from which the series begins. V0 permits seed types:

- `task`
- `schedule_event`

The seed remains owned by its substantive module. Recurrence may inspect registry type but must not read or mutate the seed module's private table.

The occurrence ledger records both the seed and later generated objects as members of the series. A concrete object may belong to at most one V0 recurrence series.

## V0 representation

Conceptually:

```text
assistant_recurrences
---------------------
object_id          uuid primary key references assistant_objects(id)
seed_object_id     uuid not null references assistant_objects(id)

basis              text not null -- calendar | after_completion
frequency          text not null -- daily | weekly | monthly | yearly
interval_count     integer not null

anchor_kind        text null     -- instant | date (calendar rules only)
anchor_at          timestamptz null
anchor_date        date null
timezone           text null
weekdays           smallint[] null

status             text not null -- active | ended
ended_at           timestamptz null

created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()
```

Weekday numbers use ISO weekday numbering: Monday = 1 through Sunday = 7.

### Calendar anchors

A calendar recurrence is either instant-based or date-based.

For `anchor_kind = instant`:

- `anchor_at` is required;
- `timezone` is required and validated against PostgreSQL timezone data;
- `anchor_date` is null;
- recurrence arithmetic is performed in the named local timezone and converted back to an absolute instant.

For `anchor_kind = date`:

- `anchor_date` is required;
- `anchor_at` and `timezone` are null;
- recurrence arithmetic remains date-only.

This prevents daylight-saving transitions from moving a rule such as "every Monday at 07:00" to 06:00 or 08:00 local time.

### Completion-relative rules

V0 completion-relative recurrence is supported only for Task series.

It does not have a fixed calendar anchor. The next occurrence is calculated from the supplied completion instant of the preceding concrete Task.

A timezone is required so daily/monthly/yearly calendar arithmetic has stable human-time semantics. `anchor_kind`, `anchor_at`, `anchor_date`, and `weekdays` are null.

Completion-relative weekly rules mean N calendar weeks after completion; weekday-set rules are not supported in this basis.

## Calendar arithmetic

Recurrence arithmetic is a module decision and must be tested explicitly.

- Daily: advance by calendar days in the rule's local date/date-only domain.
- Weekly without weekday selection: advance by `interval_count` calendar weeks from the anchor.
- Weekly with weekday selection: selected ISO weekdays occur within every Nth anchor-relative week.
- Monthly: preserve the anchor day-of-month when possible; if that day does not exist in the target month, use the target month's last calendar day.
- Yearly: preserve month/day when possible; February 29 clamps to February 28 in non-leap years.

For instant-based rules, preserve the anchor's local wall-clock time across DST transitions. PostgreSQL timezone rules determine the resulting absolute instant.

V0 must document and test behavior for ambiguous/nonexistent local wall times around DST. Prefer a deterministic PostgreSQL-derived policy rather than application-specific timezone tables.

## Occurrence ledger

```text
assistant_recurrence_occurrences
--------------------------------
recurrence_object_id uuid not null references assistant_recurrences(object_id)
sequence              bigint not null

occurrence_at         timestamptz null
occurrence_date       date null

generated_object_id   uuid not null references assistant_objects(id)
created_at            timestamptz not null default now()

primary key (recurrence_object_id, sequence)
```

Exactly one of `occurrence_at` or `occurrence_date` is populated.

The seed is recorded as sequence 0 when the recurrence is created. Later concrete objects use increasing sequence numbers.

Required uniqueness/idempotence:

- one generated object may appear at most once in the occurrence ledger;
- one recurrence may record a given instant/date occurrence at most once;
- recording the same occurrence/object association twice should be safely recognizable as already recorded rather than creating a duplicate;
- a conflicting object for an already-recorded occurrence is rejected.

The ledger is Recurrence-owned private state. Other modules do not write it directly.

## Materialization protocol

Recurrence calculates **where an occurrence belongs**. The owning module creates **what the occurrence is**.

Typical calendar flow:

```text
scheduled reconciliation
  -> Recurrence: list occurrences due through horizon
  -> Scheduling/Tasks: read seed or prior occurrence through public interface
  -> Scheduling/Tasks: create concrete next object
  -> Recurrence: record generated object for occurrence
```

Typical completion-relative flow:

```text
complete Task occurrence
  -> Tasks.complete_task(...)
  -> Recurrence: calculate next from completed_at
  -> Tasks.create_task(...)
  -> Recurrence: record generated Task
```

The orchestrator may copy appropriate human-facing properties through the owning module's public get/create interfaces. Recurrence itself must not clone Tasks or Scheduling tables.

Concrete-object creation and occurrence recording cross module/API boundaries and are not claimed to be exactly-once atomic in V0. The occurrence ledger prevents duplication once an occurrence is recorded, but there is a small partial-failure window if object creation succeeds and recording does not.

A caller that has an uncertain create/record outcome must not blindly create another object for the same occurrence. It should inspect/reconcile the owning module through its public interfaces and either attach the already-created object or surface the ambiguity for resolution. Do not solve this by coupling Recurrence directly to another module's private tables. If this recovery case becomes operationally significant, add a dedicated orchestration/idempotency mechanism as a separate design decision.

## Materialization horizon

V0 does not require a continuously maintained long future horizon.

The scheduled reconciler may ask for calendar occurrences due through a bounded horizon appropriate to the caller. The Recurrence module returns deterministic missing occurrence descriptors; it does not decide how often reconciliation runs.

Completion-relative rules produce at most one next missing occurrence from a completed predecessor.

## Lifecycle

Statuses:

- `active`
- `ended`

Ending a recurrence stops future occurrence calculation/materialization and records `ended_at`.

Ending does not cancel, delete, complete, or otherwise mutate already-materialized Tasks or Schedule Events.

V0 has no resume operation. A materially new repeating series may be represented by a new recurrence object.

## Interface

```text
create_recurrence
update_recurrence
end_recurrence
get_recurrence
list_recurrences
list_due_recurrence_occurrences
next_after_completion
record_recurrence_occurrence
```

### create_recurrence

Creates registry + recurrence atomically and records the seed as occurrence sequence 0.

Caller supplies a complete rule representation and the seed object. The caller also supplies the seed occurrence position needed to make the series internally consistent; Recurrence does not read the seed's private Task/Scheduling row.

### update_recurrence

Updates an active rule's future semantics only.

Identity, seed, lifecycle, audit fields, and historical occurrence ledger are immutable. Rule changes do not rewrite prior occurrences.

V0 may reject updates that would make the new rule inconsistent with already-recorded occurrence history.

### end_recurrence

Transitions active -> ended and records `ended_at`. Terminal in V0.

### get_recurrence / list_recurrences

Return recurrence state and deterministic bounded listings. Listing supports at least status, seed object, basis, and bounded pagination.

### list_due_recurrence_occurrences

For active calendar rules, returns deterministic **missing** occurrence descriptors within caller-supplied bounds/horizon. It does not create Tasks or Schedule Events.

Bounds must distinguish instant-based and date-based rules rather than silently converting dates through a server timezone.

### next_after_completion

For an active completion-relative Task series, accepts:

- recurrence identity;
- completed concrete object identity;
- completion instant.

It verifies that the completed object belongs to the series and returns the next missing occurrence descriptor. It does not create the next Task.

### record_recurrence_occurrence

Associates a generated registered object with a calculated occurrence position and sequence.

It validates:

- recurrence is active;
- generated object registry type is compatible with the seed series;
- occurrence descriptor is valid for the recurrence;
- generated object is not already a member of another series;
- duplicate/conflicting occurrence rules above.

## Invariants

- RC1. Every recurrence has one registry object with `object_type = 'recurrence'`.
- RC2. Recurrence identity and seed identity are stable.
- RC3. V0 seed registry type is `task` or `schedule_event`.
- RC4. Basis is `calendar` or `after_completion`.
- RC5. Frequency is daily, weekly, monthly, or yearly; interval_count >= 1.
- RC6. Calendar rule has exactly one valid anchor representation.
- RC7. Instant calendar anchors have a valid PostgreSQL/IANA timezone.
- RC8. Date calendar anchors have no timezone.
- RC9. Weekday selections are unique ISO weekday integers 1..7 and valid only for weekly calendar rules.
- RC10. Completion-relative rules are Task-only, require timezone, and have no fixed anchor/weekday set.
- RC11. Status is active or ended; ended_at is non-null iff ended.
- RC12. Ended recurrences are terminal.
- RC13. Registry + recurrence + seed-ledger creation is atomic.
- RC14. Historical occurrence records are immutable.
- RC15. Each generated object belongs to at most one V0 recurrence series.
- RC16. A recurrence occurrence position cannot materialize two different objects.
- RC17. Recurrence never directly mutates Tasks, Scheduling, Reminders, or Knowledge private state.
- RC18. Repeated calculation/recording of already-recorded occurrences is idempotent; callers must explicitly reconcile uncertain cross-module create/record outcomes rather than blindly recreating them.
- RC19. Rule calculation uses calendar semantics, not fixed-second approximations for days/weeks/months/years.
- RC20. No continuous worker is required for correctness.

## Deliberate exclusions

V0 does not include:

- full RFC 5545/RRULE support;
- "third Thursday", "last business day", holiday calendars, or exception-date syntax;
- automatic cloning of Task/Scheduling private rows;
- a background daemon, queue, or recurrence worker;
- reminder delivery;
- Google Calendar recurring-series IDs or provider sync state;
- natural-language recurrence parsing;
- automatic cancellation of already-generated occurrences when a series ends;
- resume/reactivation;
- arbitrary metadata JSON.

External Google Calendar synchronization may choose to import concrete provider occurrences rather than recreating a provider recurrence rule internally. Provider mapping belongs outside Recurrence.

## Relationship to periodic reconciliation

Assistant's normal execution model accepts bounded staleness. A scheduled ChatGPT reconciliation may run several times per day and ask Recurrence for missing occurrences.

The 04:30 household refresh can therefore materialize anything needed for the upcoming day/horizon before the morning tablet view. If immediate freshness matters, an interactive chat can invoke the same module interfaces on demand.

Recurrence correctness must not depend on the exact cadence.
