Interfaces.md

Fitness Logging & Analysis System

Interface Version: v0.1

Purpose

This document defines the interface contracts between the major system components:

Custom GPT
  -> GPT Actions
  -> Supabase Edge Functions
  -> PostgreSQL
GitHub Pages Admin App
  -> Supabase Edge Functions
  -> PostgreSQL

The purpose of this document is to prevent interface drift across implementation sessions.

The database is the source of truth.

The GPT performs extraction and coaching.

The Edge Functions validate, authorize, and store data.

⸻

Interface Philosophy

1. GPT Extracts, Edge Function Stores

The GPT is responsible for:

* understanding natural language
* splitting raw messages into events
* estimating nutrition/training ranges
* assigning confidence values
* setting review flags

The Edge Function is responsible for:

* validating payload shape
* enforcing allowed values
* sanitizing inputs
* inserting/updating rows transactionally
* returning stable IDs
* protecting the database

The Edge Function should not attempt to re-interpret the diary entry in v0.1.

⸻

2. Raw Text Must Always Be Preserved

Any write interface that accepts a user log must preserve the original raw_text.

Structured extraction may be incomplete or wrong.

Raw text remains authoritative.

⸻

3. Structured Data Is Allowed to Be Incomplete

The system should not reject useful records just because optional fields are missing.

Missing uncertain information should remain absent or null.

⸻

4. Facts, Estimates, and Interpretations Stay Separate

Every fitness_event has:

{
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Rules for what belongs in each object are defined in DataSemantics.md.

⸻

5. Read Interfaces Must Support Pagination

All read actions must support:

{
  “limit”: 100,
  “offset”: 0
}

This prevents future interface changes as historical data grows.

⸻

Authentication and Security

v0.1 Assumption

This is a one-user system.

The Custom GPT and Admin UI call Supabase Edge Functions using a shared action/API secret or equivalent project-specific authentication mechanism.

Edge Function Responsibilities

Each Edge Function must:

* verify authentication
* reject unauthenticated requests
* validate request body
* avoid exposing service-role credentials
* return safe error messages
* avoid leaking internal stack traces

Frontend Security

The GitHub Pages Admin App must not contain privileged database credentials.

If direct Supabase client access is used, it must be limited by RLS policies.

Preferred write path:

Admin UI -> Edge Function -> Database

⸻

Common Types

Date

Use ISO date strings:

YYYY-MM-DD

Example:

“2026-06-01”

Time

Use local 24-hour time strings when available:

HH:MM

Example:

“08:30”

Use null when unknown.

Confidence

Confidence values are numbers from 0.0 to 1.0.

“extraction_confidence”: 0.95

Use null when not applicable.

Pagination

Read requests should support:

{
  “limit”: 100,
  “offset”: 0
}

Default:

{
  “limit”: 100,
  “offset”: 0
}

Recommended maximum limit:

500

Event Types

Allowed fitness_events.event_type values:

meal
workout
weigh_in
recovery
sleep
note
social_event
alcohol
symptom

Source Values

Allowed log_entries.source values:

gpt_action
chat_backfill
web_admin
manual

⸻

Common Response Envelope

All Edge Functions should return a consistent response shape.

Success

{
  “ok”: true,
  “data”: {}
}

Some actions may also return top-level convenience fields for GPT ergonomics.

Failure

{
  “ok”: false,
  “error”: “Human-readable error message”,
  “code”: “MACHINE_READABLE_CODE”,
  “details”: {}
}

Example:

{
  “ok”: false,
  “error”: “Invalid event_type”,
  “code”: “INVALID_EVENT_TYPE”,
  “details”: {
    “event_type”: “bodyweight”,
    “allowed_event_types”: [
      “meal”,
      “workout”,
      “weigh_in”,
      “recovery”,
      “sleep”,
      “note”,
      “social_event”,
      “alcohol”,
      “symptom”
    ]
  }
}

⸻

Action Inventory

v0.1 exposes six primary actions:

Write

* add_log_entry
* update_event

Read

* get_logs
* search_events
* get_day_summary

Analysis Support

* get_trends

⸻

Action: add_log_entry

Purpose

Primary write action for conversational logging.

The GPT sends:

one raw conversational entry
plus zero or more extracted fitness_events

The Edge Function stores the entry and events transactionally.

Caller

Custom GPT.

Possible future caller:

* Admin UI
* import workflow

When Called

Call when the user provides new fitness-relevant information, including:

* meal
* workout
* weigh-in
* sleep
* recovery
* hunger
* energy
* symptoms
* alcohol
* social context
* training/nutrition notes

The GPT should automatically decide when a user message is fitness-relevant.

The user should not need to say “log this.”

Request

{
  “occurred_date”: “2026-06-01”,
  “occurred_time”: null,
  “raw_text”: “Weighed 198.0. Hard HYROX. Brekky eggs and mushrooms.”,
  “source”: “gpt_action”,
  “events”: [
    {
      “event_type”: “weigh_in”,
      “title”: “Weigh-in”,
      “description”: “Weighed 198.0”,
      “source_text_span”: “Weighed 198.0”,
      “facts”: {
        “weight_value”: 198.0,
        “weight_unit”: “lb”,
        “measurement_source”: “user_text”
      },
      “estimates”: {},
      “interpretations”: {},
      “extraction_confidence”: 1.0,
      “estimate_confidence”: null,
      “needs_review”: false
    },
    {
      “event_type”: “workout”,
      “title”: “HYROX workout”,
      “description”: “Hard HYROX.”,
      “source_text_span”: “Hard HYROX”,
      “facts”: {
        “workout_type”: “hyrox”,
        “intensity_reported”: “hard”
      },
      “estimates”: {
        “training_load”: “hard”
      },
      “interpretations”: {},
      “extraction_confidence”: 0.95,
      “estimate_confidence”: 0.70,
      “needs_review”: false
    },
    {
      “event_type”: “meal”,
      “title”: “Breakfast”,
      “description”: “Eggs and mushrooms.”,
      “source_text_span”: “Brekky eggs and mushrooms”,
      “facts”: {
        “meal_label”: “breakfast”,
        “foods”: [“eggs”, “mushrooms”],
        “quantity_text”: “eggs and mushrooms”
      },
      “estimates”: {
        “calories_low”: 250,
        “calories_high”: 450,
        “protein_g_low”: 18,
        “protein_g_high”: 35
      },
      “interpretations”: {},
      “extraction_confidence”: 0.90,
      “estimate_confidence”: 0.55,
      “needs_review”: false
    }
  ]
}

Required Top-Level Fields

occurred_date
raw_text
source
events

Optional Top-Level Fields

occurred_time

Required Event Fields

event_type
description
facts
estimates
interpretations

Optional Event Fields

title
occurred_time
source_text_span
extraction_confidence
estimate_confidence
needs_review

Validation Rules

The Edge Function must validate:

* request body is valid JSON
* occurred_date is a valid ISO date
* occurred_time is null or valid time
* raw_text is non-empty
* source is allowed
* events is an array
* each event_type is allowed
* each event description is non-empty
* each event facts is an object
* each event estimates is an object
* each event interpretations is an object
* confidence values are null or between 0.0 and 1.0
* needs_review is boolean when provided

Behavior

The Edge Function should:

1. Authenticate request.
2. Validate payload.
3. Insert one row into log_entries.
4. Insert zero or more rows into fitness_events.
5. Set log_entries.extraction_status:
    * extracted if one or more events are inserted
    * skipped if no events are provided
    * failed only if validation/storage fails
6. Return created IDs.

Response

{
  “ok”: true,
  “data”: {
    “log_entry_id”: “uuid”,
    “event_ids”: [“uuid”],
    “events_created”: 3,
    “needs_review”: false
  },
  “log_entry_id”: “uuid”,
  “event_ids”: [“uuid”],
  “events_created”: 3,
  “needs_review”: false
}

Failure Example

{
  “ok”: false,
  “error”: “Invalid event_type”,
  “code”: “INVALID_EVENT_TYPE”,
  “details”: {
    “event_type”: “bodyweight”
  }
}

GPT Behavior Rules

The GPT should:

* preserve raw_text exactly
* extract only what is supported by user text or visible attachments
* use source_text_span whenever possible
* store facts only when explicitly stated
* store estimates as ranges when practical
* leave unknown fields absent
* set needs_review when uncertain
* avoid creating coach interpretations as facts
* call this action automatically for fitness-relevant logs

Important Non-Behavior

add_log_entry should not automatically create coach_observations.

Logging and coaching analysis are intentionally separated.

⸻

Action: update_event

Purpose

Correct, revise, or annotate an existing fitness_event.

This action updates structured extraction only.

It does not edit the original raw log entry.

Caller

Custom GPT or Admin UI.

When Called

Use when the user corrects or clarifies previously stored structured data.

Examples:

Actually that was 196.8, not 198.
That workout was 45 minutes.
Change that to lunch, not breakfast.
That estimate is too high.

Request

{
  “event_id”: “uuid”,
  “changes”: {
    “description”: “Weighed 196.8”,
    “facts”: {
      “weight_value”: 196.8,
      “weight_unit”: “lb”,
      “measurement_source”: “user_text”
    },
    “needs_review”: false
  },
  “change_reason”: “User corrected weight value from 198.0 to 196.8.”
}

Required Fields

event_id
changes

Optional Fields

change_reason

Allowed Change Fields

v0.1 may allow updates to:

title
description
occurred_date
occurred_time
source_text_span
facts
estimates
interpretations
extraction_confidence
estimate_confidence
needs_review

Changing event_type should be allowed only with caution.

Recommended v0.1 behavior:

* allow event_type change only if explicitly included
* validate new event type
* return the changed field clearly

Not Allowed

update_event must not modify:

log_entries.raw_text
log_entries.source
log_entries.import_batch_id

Validation Rules

The Edge Function must validate:

* event_id exists
* changes is an object
* only allowed fields are changed
* facts, estimates, and interpretations remain objects
* confidence values remain null or 0.0 to 1.0
* needs_review remains boolean
* event_type, if changed, is allowed

Response

{
  “ok”: true,
  “data”: {
    “event_id”: “uuid”,
    “updated_fields”: [
      “description”,
      “facts”,
      “needs_review”
    ]
  },
  “event_id”: “uuid”,
  “updated_fields”: [
    “description”,
    “facts”,
    “needs_review”
  ]
}

Failure Example

{
  “ok”: false,
  “error”: “Event not found”,
  “code”: “EVENT_NOT_FOUND”,
  “details”: {
    “event_id”: “uuid”
  }
}

GPT Behavior Rules

The GPT should use update_event instead of creating a new log when:

* the user is clearly correcting a previous extraction
* the target event can be identified
* the user is clarifying details of a previous entry

If the target event cannot be confidently identified, GPT should retrieve likely events first or create a note with needs_review.

⸻

Action: get_logs

Purpose

Retrieve raw log entries and their extracted events for a date range.

This is the basic recall action.

Caller

Custom GPT or Admin UI.

When Called

Use when the user asks about past logs over a known date range.

Examples:

What did I eat yesterday?
Show me last week’s workouts.
What did I log today?
Pull up my entries from the weekend.

Request

{
  “start_date”: “2026-05-25”,
  “end_date”: “2026-06-01”,
  “event_type”: “meal”,
  “include_raw”: true,
  “include_events”: true,
  “limit”: 100,
  “offset”: 0
}

Required Fields

start_date
end_date

Optional Fields

event_type
include_raw
include_events
limit
offset

Defaults:

{
  “include_raw”: true,
  “include_events”: true,
  “limit”: 100,
  “offset”: 0
}

Validation Rules

The Edge Function must validate:

* start_date and end_date are valid ISO dates
* end_date is greater than or equal to start_date
* event_type is allowed if provided
* limit is reasonable
* offset is zero or greater

Response

{
  “ok”: true,
  “data”: {
    “logs”: [
      {
        “log_entry_id”: “uuid”,
        “occurred_date”: “2026-06-01”,
        “occurred_time”: null,
        “raw_text”: “Weighed 198.0. Hard HYROX. Brekky eggs and mushrooms.”,
        “events”: [
          {
            “event_id”: “uuid”,
            “event_type”: “weigh_in”,
            “title”: “Weigh-in”,
            “description”: “Weighed 198.0”,
            “source_text_span”: “Weighed 198.0”,
            “facts”: {
              “weight_value”: 198.0,
              “weight_unit”: “lb”
            },
            “estimates”: {},
            “interpretations”: {},
            “needs_review”: false
          }
        ]
      }
    ],
    “limit”: 100,
    “offset”: 0,
    “count”: 1,
    “has_more”: false
  }
}

GPT Behavior Rules

Use get_logs when the user asks for historical recall by date range.

Do not use get_logs for broad trend analysis unless the requested range is small.

Use get_trends for trend-specific questions.

⸻

Action: search_events

Purpose

Search logs and events by keyword, event type, review state, or date range.

This is the fuzzy recall action.

Caller

Custom GPT or Admin UI.

When Called

Use when the user asks to find records but may not know the exact date.

Examples:

Find every time I mentioned low energy.
Show HYROX workouts.
Find meals with smoked salmon.
Show items needing review.
When did I mention poor sleep?

Request

{
  “query”: “low energy”,
  “event_type”: “recovery”,
  “start_date”: “2026-04-01”,
  “end_date”: “2026-06-01”,
  “needs_review”: false,
  “limit”: 50,
  “offset”: 0
}

Optional Fields

query
event_type
start_date
end_date
needs_review
limit
offset

At least one search constraint must be provided.

Search Scope

Search should include:

* log_entries.raw_text
* fitness_events.description
* fitness_events.source_text_span
* relevant JSONB fields in facts
* relevant JSONB fields in estimates
* optionally coach_observations.observation_text in future versions

Validation Rules

The Edge Function must validate:

* at least one search constraint is provided
* event_type is allowed if provided
* date filters are valid if provided
* end_date >= start_date if both provided
* limit is reasonable
* offset is zero or greater

Response

{
  “ok”: true,
  “data”: {
    “results”: [
      {
        “event_id”: “uuid”,
        “log_entry_id”: “uuid”,
        “occurred_date”: “2026-05-12”,
        “occurred_time”: null,
        “event_type”: “recovery”,
        “title”: “Low energy and hunger”,
        “description”: “Low energy and hungry”,
        “source_text_span”: “I’m low energy and hungry”,
        “facts”: {
          “energy_level”: “low”,
          “hunger_level”: “high”
        },
        “estimates”: {},
        “interpretations”: {},
        “needs_review”: false,
        “raw_text”: “I’m low energy and hungry. I had an apple, but still both conditions.”
      }
    ],
    “limit”: 50,
    “offset”: 0,
    “count”: 1,
    “has_more”: false
  }
}

GPT Behavior Rules

Use search_events when the user says or implies:

find
show every time
when did I mention
have I been
how often
search

Prefer search_events over get_logs when the date is unknown or secondary.

⸻

Action: get_day_summary

Purpose

Retrieve or generate a daily summary for a specific date.

A day summary is derived data.

It is not the source of truth.

Caller

Custom GPT or Admin UI.

When Called

Use when the user wants a compiled daily view.

Examples:

How did I do yesterday?
Summarize today.
What was my training and nutrition like on Sunday?

Request

{
  “date”: “2026-06-01”,
  “generate_if_missing”: true
}

Required Fields

date

Optional Fields

generate_if_missing

Default:

{
  “generate_if_missing”: true
}

Validation Rules

The Edge Function must validate:

* date is valid ISO date
* generate_if_missing is boolean if provided

Behavior

If a summary exists:

* return it

If no summary exists and generate_if_missing is true:

* generate a mechanical summary from existing log_entries and fitness_events
* insert or upsert into daily_summaries
* return it

If no summary exists and generate_if_missing is false:

* return summary: null

Important Design Constraint

The Edge Function may generate a mechanical summary.

The GPT should provide conversational coaching interpretation.

The summary table is derived data and may be regenerated.

Response

{
  “ok”: true,
  “data”: {
    “summary”: {
      “summary_date”: “2026-06-01”,
      “bodyweight_value”: 198.0,
      “bodyweight_unit”: “lb”,
      “calories_low”: 1800,
      “calories_high”: 2200,
      “protein_g_low”: 140,
      “protein_g_high”: 170,
      “workout_count”: 1,
      “workout_summary”: “Hard HYROX session.”,
      “training_load”: “hard”,
      “recovery_summary”: “Low energy and high hunger reported.”,
      “sleep_summary”: null,
      “coach_summary”: null,
      “flags”: [
        “hard_training_day”,
        “low_energy”,
        “high_hunger”
      ],
      “needs_review”: false
    }
  }
}

GPT Behavior Rules

Use get_day_summary for day-level review.

Do not treat the daily summary as source of truth when detailed accuracy matters.

Use get_logs for exact raw entries.

⸻

Action: get_trends

Purpose

Retrieve trend-ready data for GPT analysis.

This action returns structured data points.

It does not produce final coaching analysis by itself.

Caller

Custom GPT or Admin UI.

When Called

Use when the user asks about patterns across multiple days.

Examples:

How is my weight loss going?
Am I eating enough protein?
How has my training load looked lately?
Show my calories for the last month.
Am I recovering poorly after hard workouts?

Request

{
  “metric”: “bodyweight”,
  “start_date”: “2026-05-01”,
  “end_date”: “2026-06-01”,
  “bucket”: “day”,
  “event_type”: null,
  “query”: null,
  “include_raw”: false,
  “limit”: 100,
  “offset”: 0
}

Required Fields

metric
start_date
end_date

Optional Fields

bucket
event_type
query
include_raw
limit
offset

Default:

{
  “bucket”: “day”,
  “include_raw”: false,
  “limit”: 100,
  “offset”: 0
}

Allowed Metrics

bodyweight
calories
protein
workouts
training_load
recovery
sleep
hunger
energy

Allowed Buckets

v0.1:

day
week

Validation Rules

The Edge Function must validate:

* metric is allowed
* start_date and end_date are valid ISO dates
* end_date >= start_date
* bucket is allowed
* event_type is allowed if provided
* limit is reasonable
* offset is zero or greater

Response: Bodyweight

{
  “ok”: true,
  “data”: {
    “metric”: “bodyweight”,
    “unit”: “lb”,
    “points”: [
      {
        “date”: “2026-05-01”,
        “value”: 204.8,
        “source_event_id”: “uuid”
      },
      {
        “date”: “2026-05-02”,
        “value”: 204.2,
        “source_event_id”: “uuid”
      }
    ],
    “limit”: 100,
    “offset”: 0,
    “count”: 2,
    “has_more”: false
  }
}

Response: Nutrition

{
  “ok”: true,
  “data”: {
    “metric”: “protein”,
    “unit”: “g”,
    “points”: [
      {
        “date”: “2026-05-01”,
        “low”: 130,
        “high”: 160,
        “source”: “daily_summary”
      }
    ],
    “limit”: 100,
    “offset”: 0,
    “count”: 1,
    “has_more”: false
  }
}

Response: Workouts

{
  “ok”: true,
  “data”: {
    “metric”: “workouts”,
    “points”: [
      {
        “date”: “2026-05-01”,
        “count”: 1,
        “summary”: “CrossFit metcon and strength.”,
        “training_load”: “hard”
      }
    ],
    “limit”: 100,
    “offset”: 0,
    “count”: 1,
    “has_more”: false
  }
}

Data Sources by Metric

Initial implementation may use:

bodyweight     -> fitness_events where event_type = weigh_in
calories       -> daily_summaries
protein        -> daily_summaries
workouts       -> daily_summaries or workout events
training_load  -> daily_summaries or workout event estimates
recovery       -> recovery events
sleep          -> sleep events
hunger         -> recovery event facts.hunger_level
energy         -> recovery event facts.energy_level

GPT Behavior Rules

Use get_trends when the user asks about:

trends
patterns
progress
average
consistency
over time
last X weeks
weight loss pace
protein consistency
training load
recovery patterns

The GPT should not pretend trend data is stronger than it is.

If trend data is sparse, say so.

⸻

Error Handling

Common Error Codes

Suggested v0.1 error codes:

UNAUTHORIZED
INVALID_JSON
VALIDATION_ERROR
INVALID_DATE
INVALID_TIME
INVALID_SOURCE
INVALID_EVENT_TYPE
INVALID_METRIC
INVALID_BUCKET
MISSING_REQUIRED_FIELD
EVENT_NOT_FOUND
LOG_ENTRY_NOT_FOUND
DATABASE_ERROR
NO_SEARCH_CONSTRAINT
LIMIT_TOO_HIGH

Error Response Shape

{
  “ok”: false,
  “error”: “Human readable error message”,
  “code”: “VALIDATION_ERROR”,
  “details”: {}
}

GPT Error Behavior

If an action fails, GPT should:

* explain the failure briefly
* not pretend the data was saved
* retry only if the error is clearly fixable
* ask for clarification only when necessary

⸻

Pagination Rules

All read actions must support:

{
  “limit”: 100,
  “offset”: 0
}

Default limit:

100

Recommended max limit:

500

Responses should include:

{
  “limit”: 100,
  “offset”: 0,
  “count”: 100,
  “has_more”: true
}

has_more should indicate whether additional records may be available.

⸻

Versioning

This document defines Interface Version:

v0.1

Breaking changes require a version bump.

Examples of breaking changes:

* removing a field
* renaming a field
* changing allowed event types
* changing response shape
* changing required request fields

Non-breaking changes:

* adding optional fields
* adding new allowed values with backwards compatibility
* adding new response metadata
* adding new read-only fields

Future versions may support:

* event revision history
* normalized meal/workout tables
* richer trend analytics
* direct import batch actions
* coach observation creation actions

⸻

Implementation Notes

Edge Function Names

Suggested Supabase Edge Function endpoints:

add-log-entry
update-event
get-logs
search-events
get-day-summary
get-trends

Use lowercase hyphenated names for Supabase function endpoints.

Transactionality

add_log_entry should be transactional.

If event insertion fails, the system should avoid creating partial records unless explicitly designed otherwise.

Recommended v0.1:

All-or-nothing insert for one add_log_entry request.

Durable IDs

fitness_event.id is durable.

Corrections should update the existing event rather than deleting/recreating it.

v0.1 does not include event revision history.

Coach Observations

add_log_entry does not create coach_observations.

Coach observations may be created later by dedicated analysis workflows.

Admin UI

The Admin UI should use the same interfaces where practical.

This keeps behavior consistent between GPT and web-based review/editing.