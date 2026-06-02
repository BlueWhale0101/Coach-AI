DecisionLog.md

Fitness Logging & Analysis System

How to Use This Documentation Package

This project is designing and building a custom fitness logging and coaching system using:

* ChatGPT / Custom GPT
* GPT Actions
* Supabase
* PostgreSQL
* Supabase Edge Functions
* GitHub Pages admin UI

The system’s core purpose is to preserve conversational fitness coaching logs while extracting structured data for analysis.

When continuing this project in a new chat, use the documentation package in this order:

1. README.md
    Read first for project purpose, status, and high-level orientation.
2. Architecture.md
    Read second for system design, data model, table relationships, and design principles.
3. Interfaces.md
    Read third for action contracts, request/response shapes, validation rules, and system boundaries.
4. DataSemantics.md
    Read fourth before changing extraction logic. This document defines how natural-language logs become fitness_events.
5. DecisionLog.md
    Read when deciding whether to change architecture, schemas, actions, or data semantics.

Do not redesign the system from scratch unless the user explicitly asks for a redesign.

Prefer extending the current architecture over replacing it.

If a proposed change conflicts with an existing decision, call that out clearly and either:

* preserve the existing decision, or
* propose a new decision entry explaining why the change is worth it.

⸻

Project North Star

The core principle is:

Logging must remain conversational.

Storage must be structured.

Raw text must always be preserved.

This principle should override local design preferences.

If a feature makes logging more burdensome, question it.

If a feature loses raw text, reject it.

If a feature treats GPT estimates as facts, redesign it.

⸻

Decision Format

Each decision should use this structure:

## YYYY-MM-DD — Decision Title
Status: accepted | superseded | deferred
Decision:
...
Reason:
...
Consequences:
...
Related docs:
...

⸻

Decisions

2026-06-01 — Use Supabase + GitHub Pages Stack

Status: accepted

Decision:

Use the same general stack that has worked well for previous user projects:

* Supabase/PostgreSQL backend
* Supabase Edge Functions
* GitHub Pages frontend
* Custom GPT with GPT Actions

Reason:

The user has already successfully built systems using this stack. It supports quick iteration, simple deployment, and direct integration with Custom GPT actions.

Consequences:

* Backend logic should live in Supabase Edge Functions where practical.
* The admin UI should be lightweight.
* The database remains the system of record.
* Frontend should not require a complex framework for v0.1.

Related docs:

* README.md
* Architecture.md

⸻

2026-06-01 — One-User System for v0.1

Status: accepted

Decision:

Design the system for one user in v0.1.

Reason:

This is a personal fitness logging and coaching system. Multi-user support would add unnecessary complexity early.

Consequences:

* No full user/account model is required in v0.1.
* Authentication can be project-specific and simple.
* Future multi-user support would require schema and security review.

Related docs:

* Architecture.md
* Interfaces.md

⸻

2026-06-01 — Raw Text Is the Authoritative Record

Status: accepted

Decision:

Every natural-language log must preserve the original raw user text.

Structured extraction must never replace the raw text.

Reason:

The system depends on conversational logging. GPT extraction may be incomplete or wrong, but raw text preserves the original meaning and allows future reprocessing.

Consequences:

* log_entries.raw_text is required.
* Structured events reference log_entries.
* Corrections update structured events, not raw text.
* Backfills must preserve original user messages whenever possible.

Related docs:

* Architecture.md
* DataSemantics.md
* Interfaces.md

⸻

2026-06-01 — Flexible fitness_events Table for v0.1

Status: accepted

Decision:

Use one flexible child table, fitness_events, instead of separate v0.1 tables for meals, workouts, weigh-ins, recovery notes, sleep notes, alcohol logs, and symptoms.

Reason:

Early normalization risks slowing development and hardening the schema before real usage proves the final data shape. A flexible event model preserves structure while allowing iteration.

Consequences:

* fitness_events includes event_type.
* Event-specific fields live in JSONB objects:
    * facts
    * estimates
    * interpretations
* DataSemantics.md is required to keep JSONB usage consistent.
* Future normalized tables may be added later if the flexible model becomes limiting.

Related docs:

* Architecture.md
* DataSemantics.md

⸻

2026-06-01 — Parent/Child Model: One Log Entry, Many Events

Status: accepted

Decision:

One raw user message creates one log_entry.

That log_entry may produce zero, one, or many fitness_events.

Reason:

User messages often contain mixed information.

Example:

Weighed 198.0. Hard HYROX. Brekky eggs and mushrooms.

This should preserve one raw text record while extracting multiple structured events.

Consequences:

* fitness_events.log_entry_id references log_entries.id.
* Multi-event messages are expected and normal.
* Each event should include source_text_span where possible.

Related docs:

* Architecture.md
* Interfaces.md
* DataSemantics.md

⸻

2026-06-01 — GPT Extracts, Edge Function Validates and Stores

Status: accepted

Decision:

The GPT performs natural-language extraction and sends structured payloads to Edge Functions.

The Edge Functions validate, authorize, and store the payloads.

Reason:

GPT is better at understanding messy user logs. Edge Functions are better at validation, security, transactionality, and durable storage.

Consequences:

* Edge Functions should not re-interpret logs in v0.1.
* Edge Functions must validate allowed event types, confidence values, required fields, and JSON object shapes.
* GPT prompt quality and DataSemantics.md consistency are critical.

Related docs:

* Interfaces.md
* DataSemantics.md

⸻

2026-06-01 — One Primary Logging Action

Status: accepted

Decision:

Normal user logging should go through one primary action:

add_log_entry

Do not expose separate v0.1 actions such as:

* add_meal
* add_workout
* add_weigh_in
* add_recovery_note

Reason:

The user should not need to classify their own logs. Logging must remain conversational and low-friction.

Consequences:

* GPT decides whether a message is fitness-relevant.
* GPT extracts zero or more events from the message.
* Most writes use add_log_entry.
* Specialized add actions may be reconsidered later, but they are not part of v0.1.

Related docs:

* Architecture.md
* Interfaces.md

⸻

2026-06-01 — Automatic Fitness-Relevant Logging

Status: accepted

Decision:

The GPT should automatically log fitness-relevant information without repeatedly asking the user whether to save it.

Reason:

The system is intended to match the user’s existing workflow: conversational coaching with low logging burden.

Consequences:

* Messages like “198.0 today” should be logged.
* Messages like “Brekky was eggs and mushrooms” should be logged.
* Messages like “Morning” should not be logged unless useful context exists.
* GPT must distinguish fitness-relevant logs from ordinary conversation.

Related docs:

* Interfaces.md
* DataSemantics.md

⸻

2026-06-01 — Separate Facts, Estimates, and Interpretations

Status: accepted

Decision:

Structured event data must separate:

* facts
* estimates
* interpretations

Reason:

Explicit user data, GPT-generated estimates, and coaching conclusions have different reliability levels and should not be mixed.

Consequences:

* Bodyweight belongs in facts.
* Calories/protein estimates belong in estimates.
* Possible under-fueling belongs in coaching response or future coach_observations, not factual event fields.
* GPT should not store interpretations as facts.

Related docs:

* Architecture.md
* DataSemantics.md

⸻

2026-06-01 — Store Estimate Ranges

Status: accepted

Decision:

Nutrition and similar estimates should be stored as ranges whenever practical.

Examples:

{
  “calories_low”: 450,
  “calories_high”: 650,
  “protein_g_low”: 30,
  “protein_g_high”: 45
}

Reason:

Single-point estimates imply false precision. Ranges better represent uncertainty.

Consequences:

* Meal estimates should use calorie and protein ranges when enough detail exists.
* Carbs and fat are optional in v0.1.
* Estimate confidence should be included when estimates are provided.

Related docs:

* DataSemantics.md
* Interfaces.md

⸻

2026-06-01 — Daily Summaries Are Derived Data

Status: accepted

Decision:

Use daily_summaries as a derived/regeneratable table.

Reason:

Daily summaries are useful for coaching continuity and dashboards, but they are not the source of truth.

Consequences:

* Raw logs and fitness events remain authoritative.
* Daily summaries may be regenerated.
* GPT should not rely on summaries when exact raw details matter.
* get_day_summary may generate a mechanical summary if missing.

Related docs:

* Architecture.md
* Interfaces.md

⸻

2026-06-01 — Do Not Automatically Create Coach Observations During Logging

Status: accepted

Decision:

add_log_entry should not automatically create coach_observations.

Reason:

Logging and coaching analysis should remain separate. Automatically creating coach observations on every log risks cluttering the database with AI-generated interpretation.

Consequences:

* Normal logging creates log_entries and fitness_events.
* Coaching interpretation happens in GPT response.
* Persistent coach_observations may be created later by dedicated analysis workflows.

Related docs:

* Architecture.md
* Interfaces.md

⸻

2026-06-01 — Durable Fitness Event IDs

Status: accepted

Decision:

fitness_events.id is durable.

Corrections should update existing events rather than deleting and recreating them.

Reason:

Stable event IDs make updates, references, search results, summaries, and future review workflows easier.

Consequences:

* Use update_event for corrections.
* Do not change event IDs during normal correction.
* v0.1 does not include event revision history.

Related docs:

* Interfaces.md
* Architecture.md

⸻

2026-06-01 — No Event Revision History in v0.1

Status: accepted

Decision:

Do not create an event_revisions or audit trail table in v0.1.

Reason:

Revision history is useful but not necessary for the first build. It would add implementation complexity before the core logging system is proven.

Consequences:

* update_event overwrites structured event data.
* Raw text remains preserved.
* Future versions may add event revision history.

Related docs:

* Interfaces.md
* Architecture.md

⸻

2026-06-01 — Read Actions Must Support Pagination

Status: accepted

Decision:

All read actions must support:

{
  “limit”: 100,
  “offset”: 0
}

Reason:

The dataset will grow over time. Pagination avoids future interface changes and prevents large accidental payloads.

Consequences:

* get_logs, search_events, and get_trends include pagination.
* Default limit is 100.
* Recommended maximum limit is 500.

Related docs:

* Interfaces.md

⸻

2026-06-01 — Consumed Food Should Be Logged When Identifiable

Status: accepted

Decision:

Store all consumed food when enough detail exists.

This includes:

* meals
* snacks
* candy
* protein bars
* pre-workout carbs
* partial servings
* small bites/samples

Reason:

Small food items can matter for calorie tracking, training fueling, hunger management, and behavior patterns.

Consequences:

* A Twizzler before a workout creates a meal event.
* A few chicken nuggets create a meal event.
* Food planning does not create a meal event unless consumption is confirmed.
* Questions about possible food do not create meal events unless consumption is confirmed.

Related docs:

* DataSemantics.md

⸻

2026-06-01 — Planned Behavior Is Not Completed Behavior

Status: accepted

Decision:

Do not create completed meal or workout events from planning language alone.

Reason:

Planning to eat or train is not the same as eating or training.

Consequences:

* “I’m planning on pizza” is not a meal event.
* “I might run tomorrow” is not a workout event.
* Such messages may become note events if useful.
* Later confirmation creates the completed event.

Related docs:

* DataSemantics.md

⸻

2026-06-01 — Weight Discussion Is Not a Weigh-In

Status: accepted

Decision:

Only create a weigh_in event when a numeric bodyweight value is available.

Reason:

Weight trend discussion and bodyweight data are different. False weigh-in points can distort trend analysis.

Consequences:

* “The scale has not moved” is not a weigh-in.
* “Another week, another weigh-in log” is not a weigh-in unless attachment data contains weights.
* Numeric weights may be extracted from text or image.
* Default weight unit is pounds for this user unless kg is specified.

Related docs:

* DataSemantics.md

⸻

2026-06-01 — Alcohol and Social Context Get Separate Event Types

Status: accepted

Decision:

Track alcohol and social context separately from ordinary meal events.

Reason:

Alcohol and social events can explain changes in sleep, recovery, weight trend, appetite, and intake patterns.

Consequences:

* “2 hot toddy” creates an alcohol event.
* “Festival food” may create a social_event.
* Meal events still record food consumed.
* Social events are lightweight context records.

Related docs:

* DataSemantics.md

⸻

2026-06-01 — Use source_text_span for Traceability

Status: accepted

Decision:

Each structured event should include the shortest useful source text span that supports it whenever possible.

Reason:

source_text_span helps review extraction quality and trace structured records back to the user’s wording.

Consequences:

* Multi-event messages should have separate source spans per event.
* Attachment-derived events should identify the attachment source.
* GPT should not use assistant-generated wording as the source span.

Related docs:

* DataSemantics.md
* Interfaces.md

⸻

2026-06-01 — Documentation Package as Project Source

Status: accepted

Decision:

Maintain the documentation package as a source artifact for future chats.

Core docs:

* README.md
* Architecture.md
* Interfaces.md
* DataSemantics.md
* DecisionLog.md

Reason:

This project will likely span multiple chats and implementation sessions. The docs prevent context loss and redesign loops.

Consequences:

* Future chats should load these docs before making changes.
* New design decisions should be added to DecisionLog.md.
* Interface or semantics changes should update the relevant document.
* 
Use X-Action-Secret for Edge Function authentication instead of Authorization, because Supabase Dashboard and some clients may inject or override Authorization with a Supabase JWT.

## 2026-06-01 — Use X-Action-Secret for Edge Function Auth

Status: accepted

Decision:

Use `X-Action-Secret` for GPT/Admin-to-Edge-Function authentication instead of relying on the `Authorization` header.

Reason:

Supabase Dashboard and some clients may inject or override the `Authorization` header with a Supabase JWT. During testing, the function received a JWT instead of the custom action secret, causing 401 responses. A dedicated `X-Action-Secret` header avoids this ambiguity.

Consequences:

- Edge Functions should check `X-Action-Secret`.
- `Authorization: Bearer ...` may be supported as fallback, but should not be the primary documented path.
- Interfaces.md examples should use `X-Action-Secret`.
- Custom GPT actions should send `X-Action-Secret`.
- 
  DecisionLog.md Patch — Milestone 1 Decisions

2026-06-01 — Use X-Action-Secret for Edge Function Authentication

Status: accepted

Decision:

Use X-Action-Secret for GPT/Admin-to-Edge-Function authentication instead of relying on the Authorization header.

Reason:

During Dashboard testing, Supabase injected or forwarded an Authorization header containing a Supabase JWT. The function received a value beginning with eyJ... instead of the custom action secret, causing 401 responses.

Using a dedicated X-Action-Secret header avoids ambiguity and keeps the action secret independent from Supabase JWT behavior.

Consequences:

* Edge Functions should check X-Action-Secret.
* GPT Actions should send X-Action-Secret.
* Documentation examples should use X-Action-Secret.
* Authorization: Bearer <secret> may be supported as fallback, but it is not the primary documented path.

Related docs:

* Interfaces.md
* Edge Function source files

⸻

2026-06-01 — Patch OpenAPI Schema to v0.1.1 for GPT Actions Compatibility

Status: accepted

Decision:

Patch the Custom GPT OpenAPI schema from v0.1.0 to v0.1.1 by adding explicit empty properties: {} blocks to flexible object schemas.

Reason:

The GPT Actions editor rejected the original schema with:

In context=(‘components’, ‘schemas’, ‘JsonObject’), object schema missing properties

The original schema was valid OpenAPI-style flexible object modeling, but GPT Actions validation was stricter.

Consequences:

* facts, estimates, and interpretations remain flexible JSON objects.
* The schema satisfies the GPT Actions validator.
* Backend behavior is unchanged.
* Interface schema version is now v0.1.1.

Related docs:

* Interfaces.md
* Custom GPT OpenAPI schema

⸻

2026-06-01 — Milestone 1 GPT Action MVP Complete

Status: accepted

Decision:

Declare Milestone 1 complete.

Completed components:

* Supabase schema deployed
* add-log-entry deployed and tested
* get-logs deployed and tested
* search-events deployed and tested
* update-event deployed and tested
* Custom GPT OpenAPI schema configured
* GPT Actions tests passed

Reason:

The system now supports the essential end-to-end loop:

Custom GPT
  -> Edge Functions
  -> PostgreSQL
  -> retrieve/search/update records

The core design principles have been validated in the deployed system:

* Raw text is preserved.
* Structured child events are created.
* Events can be retrieved.
* Events can be searched.
* Structured extraction can be corrected without modifying raw text.

Consequences:

* Project can move from GPT Action MVP to next implementation phase.
* Next recommended backend functions are get-day-summary and get-trends.
* Minimal admin/debug UI can begin after core backend read/write workflows are stable.
* Documentation package should be refreshed and re-uploaded as project source.

Related docs:

* README.md
* Interfaces.md
* Architecture.md
* DataSemantics.md
* 
 ## 2026-06-02 — get-trends Generates Missing Daily Summaries On Demand

Status: accepted

Decision:

For v0.1, `get-trends` may generate or refresh missing `daily_summaries` for dates in the requested range when the requested metric depends on daily summaries.

This applies especially to:

- calories
- protein
- training_load
- daily workout counts

Reason:

Nutrition and training trends should not appear empty simply because the user or admin has not manually run `get-day-summary` for every date.

The GPT should be able to ask for a protein or calorie trend over a date range and receive usable data without requiring manual summary generation first.

Consequences:

- `daily_summaries` remain derived/regeneratable data.
- `get-trends` can perform light summary maintenance as part of trend retrieval.
- Trend results may update `daily_summaries.updated_at`.
- The function should still return raw trend points, not coaching interpretation.
- GPT remains responsible for interpreting the trend.

Related docs:

- `Interfaces.md`
- `Architecture.md`

DecisionLog.md Patch — Milestone 3 and Historical Import Prep

2026-06-02 — get-trends Generates Missing Daily Summaries On Demand

Status: accepted

Decision:

For v0.2, get-trends may generate or refresh missing daily_summaries for dates in the requested range when the requested metric depends on daily summaries.

This applies especially to:

* calories
* protein
* training_load
* daily workout counts

Reason:

Nutrition and training trends should not appear empty simply because the user or admin has not manually run get-day-summary for every date.

The GPT should be able to ask for a protein or calorie trend over a date range and receive usable data without requiring manual summary generation first.

Consequences:

* daily_summaries remain derived/regeneratable data.
* get-trends can perform light summary maintenance as part of trend retrieval.
* Trend results may update daily_summaries.updated_at.
* The function still returns raw trend points, not coaching interpretation.
* GPT remains responsible for interpreting the trend.

Related docs:

* Interfaces.md
* Architecture.md

⸻

2026-06-02 — Milestone 3 Day Summaries and Trends Complete

Status: accepted

Decision:

Declare Milestone 3 complete.

Completed components:

* get-day-summary Edge Function deployed and tested
* get-trends Edge Function deployed and tested
* GPT OpenAPI action schema updated to v0.2
* Custom GPT tests passed for summary and trend prompts

Reason:

The system now supports not only logging and recall, but also useful derived summaries and trend-ready data for coaching analysis.

Consequences:

The working action set is now:

addLogEntry
getLogs
searchEvents
updateEvent
getDaySummary
getTrends

The system can now support questions such as:

How did I do today?
How is my weight trend?
Am I getting enough protein?
How many workouts did I log this week?
How has training load looked lately?

Related docs:

* README.md
* Interfaces.md
* GPTInstructions.md

⸻

2026-06-02 — Historical Import Becomes Next Major Phase

Status: accepted

Decision:

Begin the historical import workflow after Milestone 3.

Reason:

The system now has enough stable structure to know what historical data should be converted into:

* log_entries
* fitness_events
* daily_summaries
* import_batches

The system also has working admin visibility and correction tools, which are necessary for reviewing backfilled data.

Consequences:

Historical import should now focus on producing machine-readable log-entry payloads compatible with addLogEntry, grouped by import_batches.

The import process should preserve raw user messages wherever possible.

Imported records should use:

source = chat_backfill

and should set conservative confidence/review flags when dates, source spans, images, or extracted details are uncertain.

Related docs:

* Architecture.md
* Interfaces.md
* DataSemantics.md
* README.md