# DataSemantics.md

Fitness Logging & Analysis System

Purpose

This document defines how conversational user messages should be converted into structured fitness_events.

The goal is consistency.

The system uses a flexible fitness_events table with JSONB fields:

* facts
* estimates
* interpretations

Because these fields are flexible, this document defines the canonical keys, rules, and examples that GPT should follow during extraction.

⸻

Core Extraction Rules

1. Raw Text Remains Authoritative

The original user message is preserved in log_entries.raw_text.

Structured events are derived from raw text.

If structured extraction is wrong, the raw text remains the source of truth.

⸻

2. Facts Are Explicit

Facts are details stated by the user or directly visible in an attached image.

Examples:

* “Weighed 198.0”
* “Dinner was lentil soup”
* “Finished in 53 minutes”
* “I’m low energy and hungry”

Facts should not include GPT assumptions.

⸻

3. Estimates Are Marked as Estimates

Calories, protein, carbs, fat, volume, and training load estimates belong in estimates.

Estimates should normally be stored as ranges.

Example:

{
  “calories_low”: 450,
  “calories_high”: 650,
  “protein_g_low”: 30,
  “protein_g_high”: 45
}

⸻

4. Interpretations Are Not Facts

Coaching interpretations do not belong in facts.

Example interpretation:

possible under-fueling

This should not become:

{
  “underfueled”: true
}

unless a future dedicated analysis process creates a coach observation.

⸻

5. Null or Absent Is Better Than Wrong

If a field is unknown, omit it.

Do not invent values.

⸻

Message Handling Categories

Not every fitness-related message creates a structured event.

1. Structured Event

Use when the user reports something that happened.

Examples:

A watery bowl of lentil soup with sausage chunks for dinner.

Creates:

meal event
Today’s workout. Finished in 53 minutes.

Creates:

workout event

⸻

2. Note Event

Use when the message contains useful context but not a concrete meal, workout, weigh-in, sleep entry, or recovery signal.

Example:

Man, the scale has not moved much in the last 7 days. Is that expected?

This is not a weigh-in because no actual weight value is provided.

It may become a note event about weight trend frustration.

⸻

3. Raw Log Only

Use when the message is administrative, incomplete, or not useful as a structured event.

Example:

Logs for data tracking. A few more days.

Store raw text if needed, but do not create a structured fitness event.

⸻

4. Attachment-Dependent

Use when the message refers to an image, menu, board, scale log, or nutrition label.

Example:

Great xfit today. 3 back to back AMRAPs. Can you read the board?

Do not invent workout details from the text alone.

Create a workout event only if the attachment is read and the workout can be extracted.

⸻

5. Correction / Update

Use update_event rather than creating a new event when the user corrects a previous structured record.

Example:

Actually that was 196.8, not 198.

This should update the previous weigh-in event.

⸻

Global Rules

Planned Is Not Completed

A plan is not the same as a completed event.

User says:

I’m planning on a couple slices of pizza and some extra protein.

Do not create a meal event as if the pizza was eaten.

Valid options:

* raw log only
* note event
* planning note

If the user later says:

I had two slices worth.

Then create a meal event.

⸻

Questions Are Not Logs Unless They Include Actual Intake or Activity

User says:

What if I have popcorn and this protein bar?

This is a planning question.

Do not create a meal event unless the user confirms they ate it.

⸻

Weight Discussion Is Not a Weigh-In

User says:

The scale has not moved much in the last 7 days.

This is not a weigh-in.

Only create a weigh-in event when there is an actual numeric bodyweight or an extracted weight from an attached weight log.

⸻

Event Type: meal

Definition

A meal event records food or non-alcohol drink the user actually consumed.

Meals include:

* breakfast
* lunch
* dinner
* snacks
* pre-workout food
* post-workout food
* protein shakes
* meal replacements

Alcohol should generally be represented as a separate alcohol event, even if logged in the same message as food.

⸻

When to Create a Meal Event

Create a meal event when the user states or strongly implies food was eaten.

Examples:

A pretty watery bowl of lentil soup with sausage chunks for dinner.
Dinner was yogurt and a protein shake.
I had two slices worth.
Today’s workout. Finished in 53 minutes. I had a twizzler before to prep.

⸻

When Not to Create a Meal Event

Do not create a meal event when the user is only planning, asking, or considering.

Examples:

What if I have popcorn and this protein bar?
I’m planning on a couple slices and some extra protein.
Set is three course dinner from this menu.

The last example is a planning/social context message unless the user later confirms what they ordered or ate.

⸻

Required Fields

For a meal event:

{
  “event_type”: “meal”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.meal_label when clear
* calorie/protein estimates when enough detail is available

⸻

Canonical facts Keys for Meal Events

Use these keys inside facts.

{
  “meal_label”: “breakfast”,
  “foods”: [“eggs”, “mushrooms”, “english muffin”],
  “quantity_text”: “3 eggs, 1/2 English muffin, heap of mushrooms”,
  “context”: “pre_workout”
}

Allowed meal_label values:

breakfast
lunch
dinner
snack
pre_workout
post_workout
unknown

Use unknown only if a meal event clearly occurred but the label is unclear.

Prefer omitting meal_label over guessing.

⸻

Canonical estimates Keys for Meal Events

Use ranges.

{
  “calories_low”: 350,
  “calories_high”: 500,
  “protein_g_low”: 22,
  “protein_g_high”: 32,
  “carbs_g_low”: 20,
  “carbs_g_high”: 35,
  “fat_g_low”: 12,
  “fat_g_high”: 22
}

Calories and protein are the most important.

Carbs and fat are optional.

If food details are too vague, either:

* use a wide range and needs_review: true
* or omit estimates

⸻

Meal Event Examples

Example 1: Simple Dinner

Raw user message:

A pretty watery bowl of lentil soup with sausage chunks for dinner

Expected event:

{
  “event_type”: “meal”,
  “title”: “Dinner”,
  “description”: “A pretty watery bowl of lentil soup with sausage chunks”,
  “source_text_span”: “A pretty watery bowl of lentil soup with sausage chunks for dinner”,
  “facts”: {
    “meal_label”: “dinner”,
    “foods”: [“lentil soup”, “sausage”],
    “quantity_text”: “a pretty watery bowl”
  },
  “estimates”: {
    “calories_low”: 300,
    “calories_high”: 550,
    “protein_g_low”: 15,
    “protein_g_high”: 30
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.55,
  “needs_review”: false
}

⸻

Example 2: Meal With Alcohol and Social Context

Raw user message:

Festival food. 2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg

Expected event count:

3 events:
- social_event
- alcohol
- meal

Meal event:

{
  “event_type”: “meal”,
  “title”: “Festival food and dinner”,
  “description”: “1 Dagwood dog, about 3 chicken nuggets, and Japanese chicken katsu with curry on about 100g rice and a little veg”,
  “source_text_span”: “1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg”,
  “facts”: {
    “meal_label”: “dinner”,
    “foods”: [
      “Dagwood dog”,
      “chicken nuggets”,
      “chicken katsu”,
      “curry”,
      “rice”,
      “vegetables”
    ],
    “quantity_text”: “1 Dagwood dog, like 3 chicken nuggets, about 100g rice, little veg”,
    “context”: “festival”
  },
  “estimates”: {
    “calories_low”: 1000,
    “calories_high”: 1500,
    “protein_g_low”: 35,
    “protein_g_high”: 65
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.45,
  “needs_review”: true
}

⸻

Example 3: Planned Food, Not Eaten

Raw user message:

I’ve decided to have some pizza for dinner. I’m planning on a couple slices and some extra protein

Expected handling:

Do not create a meal event as consumed food.
Create note event or raw log only.

Possible note event:

{
  “event_type”: “note”,
  “title”: “Dinner plan”,
  “description”: “Planning to have a couple slices of pizza and some extra protein for dinner”,
  “source_text_span”: “I’m planning on a couple slices and some extra protein”,
  “facts”: {
    “topic”: “meal_planning”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 4: Confirmed Pizza Intake

Raw user message:

Ok, I had two slices worth. It’s cut funny. I have chili and lengua. No more smoked salmon what’s the plan here?

Expected meal event:

{
  “event_type”: “meal”,
  “title”: “Pizza”,
  “description”: “Two slices worth of pizza”,
  “source_text_span”: “I had two slices worth. It’s cut funny.”,
  “facts”: {
    “meal_label”: “dinner”,
    “foods”: [“pizza”],
    “quantity_text”: “two slices worth”
  },
  “estimates”: {
    “calories_low”: 450,
    “calories_high”: 750,
    “protein_g_low”: 18,
    “protein_g_high”: 35
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.55,
  “needs_review”: false
}

Note:

The mention of chili, lengua, and no smoked salmon is inventory/planning context, not consumed food unless the user later confirms eating it.

⸻

Example 5: Pre-Workout Snack

Raw user message:

Today’s workout. Finished in 53 minutes. I had a twizzler before to prep

Expected meal event:

{
  “event_type”: “meal”,
  “title”: “Pre-workout snack”,
  “description”: “Twizzler before workout”,
  “source_text_span”: “I had a twizzler before to prep”,
  “facts”: {
    “meal_label”: “pre_workout”,
    “foods”: [“Twizzler”],
    “quantity_text”: “a twizzler”,
    “context”: “pre_workout”
  },
  “estimates”: {
    “calories_low”: 30,
    “calories_high”: 80,
    “protein_g_low”: 0,
    “protein_g_high”: 1,
    “carbs_g_low”: 8,
    “carbs_g_high”: 20
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.65,
  “needs_review”: false
}

⸻

Meal Edge Cases

Vague Quantity

Example:

How much food would you say this is?

No meal event should be created unless the attached image is available and consumption is implied.

Photo-Based Estimate

Example:

It was a cup of rice and pork combined. Here is a picture.

Create a meal event only if this describes food consumed.

Use the text and image together.

Set estimate_confidence based on visible clarity.

Menu Planning

Example:

Set is three course dinner from this menu.

Do not create a consumed meal event unless the user confirms the meal was eaten.

Possible event type:

social_event

or raw log only.

⸻

DataSemantics.md Patch — Meal Rules Finalized

Meal Planning Notes

Food planning notes should only become note events when they affect coaching strategy, nutrition planning, or later interpretation.

Otherwise, preserve the raw text only.

Example:

What if I have popcorn and this protein bar?

Handling:

raw log only, or note event if useful for coaching context

Do not create a meal event unless the user confirms the food was eaten.

⸻

Meal Estimates

When a consumed meal has enough detail to estimate nutrition, GPT should generate at least:

{
  “calories_low”: 0,
  “calories_high”: 0,
  “protein_g_low”: 0,
  “protein_g_high”: 0
}

Carbs and fat are optional in v0.1.

If food quantity is vague, use a wider range and lower estimate_confidence.

If food quantity is too vague to estimate responsibly, omit estimates and set needs_review: true when appropriate.

⸻

Small Snacks

Store all consumed food when enough detail exists.

This includes small snacks, candy, bites, samples, pre-workout carbs, and partial servings.

Example:

I had a twizzler before to prep.

Creates:

meal event

Example:

like 3 chicken nuggets

Creates:

meal event

Rationale:

Small items can matter for calorie tracking, training fueling, hunger management, and behavior patterns.

⸻

Food Names

For v0.1, facts.foods should use loose human-readable strings.

Example:

{
  “foods”: [“lentil soup”, “sausage chunks”]
}

Do not attempt food normalization in v0.1.

Future versions may add normalized food entities if useful.

# Workout Events

Event Type: workout

Definition

A workout event records completed training or physical activity.

Workouts include:

* CrossFit
* HYROX
* running
* Zone 2
* strength work
* mobility
* sport
* active recovery
* rucking / hiking / loaded walking
* other intentional training

⸻

Core Rule

Create a workout event only when the user states or strongly implies that training occurred.

Do not create a completed workout event for a planned workout unless the user confirms it happened.

⸻

When to Create a Workout Event

Create a workout event when the user says:

Great xfit today.
Today’s workout. Finished in 53 minutes.
Hard HYROX session.
Zone 2 run today.
Workout was RDL and weighted Russian box step ups strength piece.

⸻

When Not to Create a Workout Event

Do not create a workout event from planning language alone.

Examples:

I’m thinking of doing HYROX tomorrow.
Should I run today?
This calendar goes through June, not July.

These may be:

* raw log only
* note event
* planning note

but not a completed workout.

⸻

Attachment-Dependent Workout Logs

If the user references an image, whiteboard, app screenshot, or attached workout plan, do not invent workout details that are not visible in the text.

Example:

Great xfit today. 3 back to back AMRAPs. Can you read the board?

If the attachment is available and readable, create a workout event using both:

* user text
* visible workout-board data

If the attachment is not available, create a workout event only with facts present in the text.

Valid partial event:

{
  “event_type”: “workout”,
  “title”: “CrossFit workout”,
  “description”: “Great CrossFit workout. 3 back-to-back AMRAPs.”,
  “source_text_span”: “Great xfit today. 3 back to back AMRAPs.”,
  “facts”: {
    “workout_type”: “crossfit”,
    “structure”: “3 back-to-back AMRAPs”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.75,
  “estimate_confidence”: null,
  “needs_review”: true
}

Set needs_review: true when the user clearly intended the attachment to provide key missing workout details.

⸻

Required Fields

For a workout event:

{
  “event_type”: “workout”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.workout_type
* facts.duration_min when explicitly stated
* facts.movements when clearly extractable
* facts.performance_result when explicitly stated

⸻

Canonical facts Keys for Workout Events

Use these keys inside facts.

{
  “workout_type”: “hyrox”,
  “duration_min”: 53,
  “structure”: “5 rounds”,
  “movements”: [],
  “loads”: [],
  “performance_result”: “finished in 53 minutes”,
  “rx_or_scaled”: null,
  “intensity_reported”: “hard”,
  “context”: “crossfit_class”
}

Allowed workout_type Values

crossfit
hyrox
run
zone2
strength
mobility
sport
hike
ruck
active_recovery
other
unknown

Prefer unknown or omit the field rather than guessing.

Examples:

xfit

maps to:

{
  “workout_type”: “crossfit”
}
HYROX

maps to:

{
  “workout_type”: “hyrox”
}

⸻

Duration

If the user gives an exact duration, store it in facts.duration_min.

Example:

Finished in 53 minutes.

Stores:

{
  “duration_min”: 53
}

If duration is estimated by GPT, store it in estimates, not facts.

Example:

{
  “duration_min_low”: 45,
  “duration_min_high”: 60
}

⸻

Intensity

Only store intensity in facts.intensity_reported when the user explicitly states or strongly implies it.

Examples:

Hard HYROX session.
{
  “intensity_reported”: “hard”
}
Easy Zone 2 run.
{
  “intensity_reported”: “easy”
}

Allowed values:

easy
moderate
hard
very_hard
max_effort

Do not infer intensity from workout type alone.

A CrossFit workout is not automatically hard.

⸻

Movements

When movements are clearly provided, store them as loose structured objects.

Example:

{
  “movements”: [
    {
      “name”: “row”,
      “amount”: “20 cal”
    },
    {
      “name”: “hang clean”,
      “amount”: “10 reps”,
      “load”: “60 kg”
    },
    {
      “name”: “box jump over”,
      “amount”: “12 reps”
    }
  ]
}

Use human-readable loose structure for v0.1.

Do not over-normalize movements yet.

⸻

Canonical estimates Keys for Workout Events

Use estimates for GPT-estimated quantities.

{
  “duration_min_low”: 45,
  “duration_min_high”: 60,
  “training_load”: “hard”
}

Allowed training_load values:

rest
light
moderate
hard
very_hard

Important:

training_load is an estimate unless explicitly reported by the user.

If the user says:

Hard HYROX session.

then facts.intensity_reported = “hard”.

The system may also estimate:

{
  “training_load”: “hard”
}

but that belongs in estimates.

⸻

Workout Event Examples

Example 1: Workout With Duration and Pre-Workout Snack

Raw user message:

Today’s workout. Finished in 53 minutes. I had a twizzler before to prep

Expected event count:

2 events:
- workout
- meal

Workout event:

{
  “event_type”: “workout”,
  “title”: “Workout”,
  “description”: “Today’s workout. Finished in 53 minutes.”,
  “source_text_span”: “Today’s workout. Finished in 53 minutes.”,
  “facts”: {
    “duration_min”: 53
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Meal event:

See meal section for pre-workout snack handling.

⸻

Example 2: CrossFit Board Attachment

Raw user message:

Great xfit today. 3 back to back AMRAPs. Can you read the board?

If board attachment is available and readable:

{
  “event_type”: “workout”,
  “title”: “CrossFit workout”,
  “description”: “Great CrossFit workout with 3 back-to-back AMRAPs.”,
  “source_text_span”: “Great xfit today. 3 back to back AMRAPs. Can you read the board?”,
  “facts”: {
    “workout_type”: “crossfit”,
    “structure”: “3 back-to-back AMRAPs”,
    “movements”: []
  },
  “estimates”: {
    “training_load”: “hard”
  },
  “interpretations”: {},
  “extraction_confidence”: 0.8,
  “estimate_confidence”: 0.5,
  “needs_review”: true
}

Notes:

* Fill movements only from readable board content.
* Keep needs_review: true if the board is hard to read.
* Do not hallucinate missing board details.

⸻

Example 3: Hard HYROX Session

Raw user message:

Hard HYROX session.

Expected event:

{
  “event_type”: “workout”,
  “title”: “HYROX workout”,
  “description”: “Hard HYROX session.”,
  “source_text_span”: “Hard HYROX session.”,
  “facts”: {
    “workout_type”: “hyrox”,
    “intensity_reported”: “hard”
  },
  “estimates”: {
    “training_load”: “hard”
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.7,
  “needs_review”: false
}

⸻

Example 4: Strength Details

Raw user message:

Workout was RDL and weighted Russian box step ups strength piece.

Expected event:

{
  “event_type”: “workout”,
  “title”: “Strength workout”,
  “description”: “RDL and weighted Russian box step ups strength piece.”,
  “source_text_span”: “Workout was RDL and weighted Russian box step ups strength piece.”,
  “facts”: {
    “workout_type”: “strength”,
    “movements”: [
      {
        “name”: “RDL”
      },
      {
        “name”: “weighted Russian box step up”
      }
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Workout Edge Cases

Planned Workout

Example:

I might run tomorrow.

Handling:

No workout event.
Possible note event if relevant.

Workout Question

Example:

Should I do Zone 2 today or rest?

Handling:

No workout event.
Possible note event if useful.

Vague Completed Workout

Example:

Good session today.

Handling:

{
  “event_type”: “workout”,
  “description”: “Good session today.”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.6,
  “estimate_confidence”: null,
  “needs_review”: true
}

Create a workout event only if context clearly indicates this refers to training.

Workout Plus Recovery Signal

Example:

Hard HYROX today. Low energy after.

Expected event count:

2 events:
- workout
- recovery

Workout event stores the completed training.

Recovery event stores the low-energy signal.

Do not merge recovery state into the workout unless it is clearly performance-related.

⸻

Final Workout Rules

* Completed training creates a workout event.
* Planned training does not create a workout event.
* Exact duration goes in facts.
* Estimated duration goes in estimates.
* User-reported intensity goes in facts.
* GPT-estimated training load goes in estimates.
* Board/photo-based details require actual visible attachment data.
* Use loose movement strings for v0.1.
* Do not over-normalize movements in v0.1.
* 
#  Weigh-In Events

Event Type: weigh_in

Definition

A weigh_in event records an actual bodyweight measurement.

This event type is intentionally strict.

A bodyweight trend discussion is not a weigh-in.

A weight-loss comment is not a weigh-in.

A weigh-in requires an actual numeric bodyweight value, either:

* explicitly stated by the user
* extracted from an attached weight-log image
* extracted from an imported historical record

⸻

Core Rule

Only create a weigh_in event when a specific bodyweight value is available.

Do not infer a weigh-in from discussion of the scale, weight loss, body composition, or progress.

⸻

When to Create a Weigh-In Event

Create a weigh-in event when the user says:

Weighed 198.0.
198.4 today.
Morning weight was 196.8.
New week, new weight log.

Only create individual weigh-in events for the last example if the attached image or visible data contains actual weight values.

⸻

When Not to Create a Weigh-In Event

Do not create a weigh-in event from messages like:

Man, the scale has not moved much in the last 7 days. Is that expected?

This is a weight-trend note, not a weigh-in.

New week, new weight log.

By itself, this is attachment-dependent and does not contain a numeric weight.

Can you estimate my body fat from this picture of me?

This is a body-composition assessment request, not a weigh-in.

⸻

Required Fields

For a weigh_in event:

{
  “event_type”: “weigh_in”,
  “description”: “...”,
  “facts”: {
    “weight_value”: 198.0,
    “weight_unit”: “lb”
  },
  “estimates”: {},
  “interpretations”: {}
}

Required facts:

* weight_value
* weight_unit

Allowed weight_unit values:

lb
kg

⸻

Canonical facts Keys for Weigh-In Events

Use these keys inside facts.

{
  “weight_value”: 198.0,
  “weight_unit”: “lb”,
  “weigh_in_context”: “morning”,
  “measurement_source”: “user_text”
}

Required

weight_value
weight_unit

Optional

weigh_in_context
measurement_source

Allowed weigh_in_context values:

morning
evening
post_workout
post_meal
travel
unknown

Allowed measurement_source values:

user_text
image
chat_backfill
manual

Prefer omitting weigh_in_context over guessing.

⸻

Unit Defaults

The system may default to lb for this user unless the user explicitly provides kilograms.

Examples:

198.0 today

stores:

{
  “weight_value”: 198.0,
  “weight_unit”: “lb”
}
89.8 kg today

stores:

{
  “weight_value”: 89.8,
  “weight_unit”: “kg”
}

⸻

Estimates

Weigh-ins should not use estimates.

Do not estimate bodyweight.

The estimates object should normally be empty:

{}

Exception:

A future body-composition estimate may be represented as a different event type, likely note or body_composition, if that type is later added.

For v0.1, do not store body fat estimates as weigh-ins.

⸻

Weigh-In Event Examples

Example 1: Explicit Weigh-In

Raw user message:

Weighed 198.0.

Expected event:

{
  “event_type”: “weigh_in”,
  “title”: “Weigh-in”,
  “description”: “Weighed 198.0.”,
  “source_text_span”: “Weighed 198.0.”,
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
}

⸻

Example 2: Numeric Weight Without Unit

Raw user message:

198.4 today.

Expected event:

{
  “event_type”: “weigh_in”,
  “title”: “Weigh-in”,
  “description”: “198.4 today.”,
  “source_text_span”: “198.4 today.”,
  “facts”: {
    “weight_value”: 198.4,
    “weight_unit”: “lb”,
    “measurement_source”: “user_text”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

Note:

lb is acceptable as default for this user.

⸻

Example 3: Trend Discussion, Not Weigh-In

Raw user message:

Man, the scale has not moved much in the last 7 days. Is that expected?

Expected handling:

Do not create a weigh_in event.
Possible note event about weight trend frustration.

Possible note event:

{
  “event_type”: “note”,
  “title”: “Weight trend question”,
  “description”: “The scale has not moved much in the last 7 days.”,
  “source_text_span”: “Man, the scale has not moved much in the last 7 days. Is that expected?”,
  “facts”: {
    “topic”: “weight_trend”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 4: Weight Log Image Placeholder

Raw user message:

Another week, another weigh in log!

Expected handling without attachment data:

No weigh_in event.
Raw log only or note event.

Expected handling with readable attached image:

Create one weigh_in event per visible dated weight entry.

Example extracted event from image:

{
  “event_type”: “weigh_in”,
  “title”: “Weigh-in”,
  “description”: “Weight log entry: 198.2 lb”,
  “source_text_span”: “Attached weight log image”,
  “facts”: {
    “weight_value”: 198.2,
    “weight_unit”: “lb”,
    “measurement_source”: “image”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.85,
  “estimate_confidence”: null,
  “needs_review”: true
}

Set needs_review: true when handwriting, image quality, or date association is uncertain.

⸻

Example 5: Body Fat Estimate Request

Raw user message:

New week, new weight log. Also, can you estimate my body fat from this picture of me?

Expected handling:

Create weigh_in events only if the weight log image contains actual weights.
Do not create a weigh_in event from the body-fat estimate request.

Possible note event:

{
  “event_type”: “note”,
  “title”: “Body composition estimate request”,
  “description”: “User asked for body fat estimate from a picture.”,
  “source_text_span”: “can you estimate my body fat from this picture of me?”,
  “facts”: {
    “topic”: “body_composition”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Weigh-In Edge Cases

Ambiguous Number

Example:

I hit 198 today.

If context strongly indicates bodyweight, create a weigh-in event.

If context is unclear, do not create a weigh-in event or set needs_review: true.

Expected event if context supports bodyweight:

{
  “event_type”: “weigh_in”,
  “description”: “I hit 198 today.”,
  “source_text_span”: “I hit 198 today.”,
  “facts”: {
    “weight_value”: 198.0,
    “weight_unit”: “lb”,
    “measurement_source”: “user_text”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.75,
  “estimate_confidence”: null,
  “needs_review”: true
}

⸻

Weight Change Without Current Weight

Example:

Down 1.2 pounds this week.

Handling:

Do not create a weigh_in event unless current weight is provided.

Possible note event:

{
  “event_type”: “note”,
  “title”: “Weight change”,
  “description”: “Down 1.2 pounds this week.”,
  “source_text_span”: “Down 1.2 pounds this week.”,
  “facts”: {
    “topic”: “weight_change”,
    “weight_change_value”: -1.2,
    “weight_change_unit”: “lb”,
    “time_window”: “this week”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.85,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Multiple Weights in One Message

Example:

Mon 198.4, Tue 198.0, Wed 197.8.

Handling:

Create one weigh_in event per dated weight.

Each event should have:

{
  “event_type”: “weigh_in”,
  “facts”: {
    “weight_value”: 198.4,
    “weight_unit”: “lb”,
    “measurement_source”: “user_text”
  }
}

The parent log_entry.raw_text remains the full message.

⸻

Final Weigh-In Rules

* Only numeric bodyweight values create weigh-in events.
* Weight trend discussion is not a weigh-in.
* Body fat estimate requests are not weigh-ins.
* Weight log image messages are attachment-dependent.
* One message may create multiple weigh-in events.
* Do not estimate bodyweight.
* Default unit is lb for this user unless kilograms are explicitly stated.
* Set needs_review: true for ambiguous numbers, unclear images, or uncertain date association.
* 
# Recovery Events

Event Type: recovery

Definition

A recovery event records subjective physical or readiness signals that may affect training, nutrition, weight trend interpretation, or coaching.

Recovery includes:

* energy
* hunger
* fatigue
* soreness
* stress
* general readiness
* feeling run down
* feeling unusually good
* post-workout recovery state

Recovery events are intentionally sparse.

Only populate fields the user explicitly states or strongly implies.

⸻

Core Rule

Create a recovery event when the user reports a body state, readiness signal, or recovery-relevant subjective condition.

Do not infer missing recovery fields.

Example:

I’m low energy and hungry.

Creates a recovery event with:

{
  “energy_level”: “low”,
  “hunger_level”: “high”
}

But does not populate:

{
  “sleep_quality”: “poor”,
  “stress_level”: “high”,
  “soreness_level”: “moderate”
}

unless those were explicitly stated.

⸻

When to Create a Recovery Event

Create a recovery event when the user says things like:

I’m low energy and hungry.
I’m exhausted today.
I’m still sore from yesterday.
Hunger is really high tonight.
I felt good today.
Low energy after the workout.

⸻

When Not to Create a Recovery Event

Do not create a recovery event just because the user completed a hard workout.

Example:

Hard HYROX session.

This creates a workout event.

It does not automatically create a recovery event.

Do not create a recovery event from pure nutrition planning.

Example:

What if I have popcorn and this protein bar?

This is a planning question, not a recovery signal.

Do not create a recovery event from sleep information alone unless the message also includes recovery state.

Example:

Slept 8 hours.

This creates a sleep event, not necessarily a recovery event.

⸻

Required Fields

For a recovery event:

{
  “event_type”: “recovery”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* relevant explicitly stated facts
* explicitly_mentioned_fields

⸻

Canonical facts Keys for Recovery Events

Use these keys inside facts.

{
  “energy_level”: “low”,
  “hunger_level”: “high”,
  “fatigue_level”: “high”,
  “soreness_level”: “moderate”,
  “stress_level”: “high”,
  “readiness”: “low”,
  “mood”: “good”,
  “explicitly_mentioned_fields”: [
    “energy_level”,
    “hunger_level”
  ]
}

All keys are optional except explicitly_mentioned_fields when any subjective field is populated.

⸻

energy_level

Allowed values:

very_low
low
normal
high
very_high

Examples:

low energy

stores:

{
  “energy_level”: “low”
}
absolutely wrecked

may store:

{
  “energy_level”: “very_low”,
  “fatigue_level”: “high”
}

if the phrase clearly communicates fatigue.

⸻

hunger_level

Allowed values:

low
normal
high
very_high

Examples:

hungry

stores:

{
  “hunger_level”: “high”
}
starving

stores:

{
  “hunger_level”: “very_high”
}

Do not infer hunger from low calories unless the user says they are hungry.

⸻

fatigue_level

Allowed values:

low
normal
high
very_high

Examples:

tired

stores:

{
  “fatigue_level”: “high”
}
exhausted

stores:

{
  “fatigue_level”: “very_high”
}

⸻

soreness_level

Allowed values:

none
mild
moderate
high
very_high

Only populate when soreness, DOMS, aches, stiffness, or similar is explicitly mentioned.

⸻

stress_level

Allowed values:

low
normal
high
very_high

Only populate when stress is explicitly mentioned.

Do not infer stress from travel, family events, work, poor sleep, or missed workouts unless the user says they are stressed.

⸻

readiness

Allowed values:

low
normal
high

Use sparingly.

Prefer specific fields such as energy, hunger, fatigue, soreness, or sleep when available.

⸻

Canonical estimates Keys for Recovery Events

Recovery estimates should be rare in v0.1.

The system should usually avoid estimating subjective recovery fields.

Allowed estimate key:

{
  “recovery_load”: “high”
}

Allowed recovery_load values:

low
moderate
high
very_high

Use this only when helpful and clearly marked as an estimate.

Example:

Hard workout, low energy, very hungry.

Could estimate:

{
  “recovery_load”: “high”
}

But the factual fields remain limited to what the user stated.

⸻

Interpretations

Avoid storing recovery interpretations inside fitness_events.interpretations during normal logging.

For v0.1, most coaching interpretation should happen in the GPT response, not be written to the database.

Do not write:

{
  “underfueling_risk”: true
}

as a fact.

If persistent coaching interpretation is needed later, use coach_observations.

⸻

Recovery Event Examples

Example 1: Low Energy and Hunger

Raw user message:

I’m low energy and hungry. I had an apple, but still both conditions.

Expected event:

{
  “event_type”: “recovery”,
  “title”: “Low energy and hunger”,
  “description”: “Low energy and hungry even after having an apple.”,
  “source_text_span”: “I’m low energy and hungry. I had an apple, but still both conditions.”,
  “facts”: {
    “energy_level”: “low”,
    “hunger_level”: “high”,
    “explicitly_mentioned_fields”: [
      “energy_level”,
      “hunger_level”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

Note:

The apple should also create a meal event if the system is logging all consumed foods and enough detail exists.

⸻

Example 2: Low Energy After Workout

Raw user message:

Hard HYROX today. Low energy after.

Expected event count:

2 events:
- workout
- recovery

Recovery event:

{
  “event_type”: “recovery”,
  “title”: “Low energy after workout”,
  “description”: “Low energy after hard HYROX workout.”,
  “source_text_span”: “Low energy after.”,
  “facts”: {
    “energy_level”: “low”,
    “explicitly_mentioned_fields”: [
      “energy_level”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Note:

The phrase Hard HYROX today belongs in the workout event.

The recovery event should not duplicate the full workout unless needed for clarity.

⸻

Example 3: Soreness

Raw user message:

Legs are still pretty sore from yesterday.

Expected event:

{
  “event_type”: “recovery”,
  “title”: “Leg soreness”,
  “description”: “Legs are still pretty sore from yesterday.”,
  “source_text_span”: “Legs are still pretty sore from yesterday.”,
  “facts”: {
    “soreness_level”: “moderate”,
    “soreness_location”: “legs”,
    “explicitly_mentioned_fields”: [
      “soreness_level”,
      “soreness_location”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 4: General Fatigue

Raw user message:

I’m exhausted today.

Expected event:

{
  “event_type”: “recovery”,
  “title”: “Exhausted”,
  “description”: “Exhausted today.”,
  “source_text_span”: “I’m exhausted today.”,
  “facts”: {
    “fatigue_level”: “very_high”,
    “energy_level”: “very_low”,
    “explicitly_mentioned_fields”: [
      “fatigue_level”,
      “energy_level”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Note:

This does not create a sleep event unless sleep is mentioned.

⸻

Example 5: Positive Recovery Signal

Raw user message:

I felt good today. Energy was high.

Expected event:

{
  “event_type”: “recovery”,
  “title”: “Good energy”,
  “description”: “Felt good today. Energy was high.”,
  “source_text_span”: “I felt good today. Energy was high.”,
  “facts”: {
    “energy_level”: “high”,
    “readiness”: “high”,
    “explicitly_mentioned_fields”: [
      “energy_level”,
      “readiness”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Recovery Edge Cases

Tired vs Sleep

Example:

I’m tired.

Creates:

recovery event

Does not create:

sleep event

unless the user mentions sleep.

⸻

Hunger vs Meal

Example:

I’m hungry.

Creates:

recovery event

Does not create:

meal event

unless food was eaten.

⸻

Low Energy After Eating

Example:

I had lunch but still feel low energy.

Expected event count:

2 events:
- meal
- recovery

The meal event records lunch if enough detail exists.

The recovery event records low energy.

⸻

Coach Interpretation

Example GPT thought:

This may be accumulated fatigue and under-fueling.

Handling:

Do not store as recovery fact.
Do not store automatically during add_log_entry.
May become coach_observation in a later analysis workflow.

⸻

Final Recovery Rules

* Create recovery events for explicit body-state/readiness signals.
* Do not infer missing recovery fields.
* Use explicitly_mentioned_fields when populating subjective facts.
* Tired/fatigued creates recovery, not sleep.
* Hungry creates recovery, not meal.
* A hard workout alone does not create recovery.
* Store positive recovery signals too.
* Keep coaching interpretation out of factual fields.
* 
# Sleep Events

Event Type: sleep

Definition

A sleep event records sleep-specific information.

Sleep includes:

* sleep duration
* sleep quality
* bedtime
* wake time
* wake-ups
* interrupted sleep
* toddler/family sleep disruptions
* unusually good or bad sleep
* naps

Sleep is related to recovery, but it is not the same event type.

⸻

Core Rule

Create a sleep event only when sleep is explicitly mentioned.

Do not infer sleep quality from fatigue, low energy, mood, hunger, or workout performance.

Example:

I’m exhausted today.

Creates:

recovery event

Does not create:

sleep event

unless sleep is mentioned.

⸻

When to Create a Sleep Event

Create a sleep event when the user says things like:

Slept badly.
Got about 6 hours.
Toddler woke us up twice.
Terrible sleep last night.
Good sleep, about 8 hours.
Had a nap this afternoon.

⸻

When Not to Create a Sleep Event

Do not create a sleep event from fatigue alone.

Examples:

I’m tired today.
Low energy this morning.
I’m exhausted after the workout.

These are recovery events unless sleep is explicitly mentioned.

⸻

Required Fields

For a sleep event:

{
  “event_type”: “sleep”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended when available:

* facts.sleep_quality
* facts.sleep_duration_hours
* facts.wake_count
* facts.disruption_notes
* facts.nap
* source_text_span

⸻

Canonical facts Keys for Sleep Events

Use these keys inside facts.

{
  “sleep_quality”: “poor”,
  “sleep_duration_hours”: 6.5,
  “bedtime”: “22:30”,
  “wake_time”: “06:00”,
  “wake_count”: 2,
  “disruption_notes”: “Toddler woke us up twice”,
  “nap”: false,
  “nap_duration_min”: null
}

All keys are optional.

Only populate keys supported by the user text or visible attachment.

⸻

sleep_quality

Allowed values:

poor
okay
good
excellent

Examples:

Slept badly.

stores:

{
  “sleep_quality”: “poor”
}
Good sleep last night.

stores:

{
  “sleep_quality”: “good”
}

Do not infer sleep quality from sleep duration alone unless the user states how it felt.

Example:

Slept 6 hours.

Stores duration only.

Do not automatically store:

{
  “sleep_quality”: “poor”
}

⸻

sleep_duration_hours

Use exact value when the user gives one.

Example:

Got about 6 hours.

stores:

{
  “sleep_duration_hours”: 6
}

If the user gives a range or approximation, use estimates instead.

Example:

Slept 6 or 7 hours.

stores:

{
  “sleep_duration_hours_low”: 6,
  “sleep_duration_hours_high”: 7
}

inside estimates.

⸻

wake_count

Use when explicitly stated.

Example:

Toddler woke us up twice.

stores:

{
  “wake_count”: 2,
  “disruption_notes”: “Toddler woke us up twice”
}

⸻

bedtime and wake_time

Use 24-hour local time strings when explicitly stated or directly inferable.

Example:

Bed at 10:30, up at 6.

stores:

{
  “bedtime”: “22:30”,
  “wake_time”: “06:00”
}

If AM/PM is ambiguous, either omit or set needs_review: true.

⸻

nap

Use for intentional naps.

Example:

Had a 30 minute nap.

stores:

{
  “nap”: true,
  “nap_duration_min”: 30
}

⸻

Canonical estimates Keys for Sleep Events

Use estimates for approximate sleep values.

{
  “sleep_duration_hours_low”: 6,
  “sleep_duration_hours_high”: 7
}

Avoid estimating sleep quality.

⸻

Sleep Event Examples

Example 1: Poor Sleep

Raw user message:

Slept badly last night.

Expected event:

{
  “event_type”: “sleep”,
  “title”: “Poor sleep”,
  “description”: “Slept badly last night.”,
  “source_text_span”: “Slept badly last night.”,
  “facts”: {
    “sleep_quality”: “poor”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 2: Sleep Duration

Raw user message:

Got about 6 hours.

Expected event:

{
  “event_type”: “sleep”,
  “title”: “Sleep duration”,
  “description”: “Got about 6 hours of sleep.”,
  “source_text_span”: “Got about 6 hours.”,
  “facts”: {
    “sleep_duration_hours”: 6
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 3: Interrupted Sleep

Raw user message:

Toddler woke us up twice.

Expected event:

{
  “event_type”: “sleep”,
  “title”: “Interrupted sleep”,
  “description”: “Toddler woke us up twice.”,
  “source_text_span”: “Toddler woke us up twice.”,
  “facts”: {
    “wake_count”: 2,
    “disruption_notes”: “Toddler woke us up twice”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 4: Sleep Plus Recovery

Raw user message:

Terrible sleep last night and low energy today.

Expected event count:

2 events:
- sleep
- recovery

Sleep event:

{
  “event_type”: “sleep”,
  “title”: “Terrible sleep”,
  “description”: “Terrible sleep last night.”,
  “source_text_span”: “Terrible sleep last night”,
  “facts”: {
    “sleep_quality”: “poor”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

Recovery event:

{
  “event_type”: “recovery”,
  “title”: “Low energy”,
  “description”: “Low energy today.”,
  “source_text_span”: “low energy today”,
  “facts”: {
    “energy_level”: “low”,
    “explicitly_mentioned_fields”: [
      “energy_level”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 5: Nap

Raw user message:

Had a 30 minute nap this afternoon.

Expected event:

{
  “event_type”: “sleep”,
  “title”: “Nap”,
  “description”: “Had a 30 minute nap this afternoon.”,
  “source_text_span”: “Had a 30 minute nap this afternoon.”,
  “facts”: {
    “nap”: true,
    “nap_duration_min”: 30
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Sleep Edge Cases

Fatigue Without Sleep

Example:

I’m exhausted today.

Handling:

Create recovery event.
Do not create sleep event.

⸻

Sleep Duration Without Quality

Example:

Slept 8 hours.

Handling:

{
  “sleep_duration_hours”: 8
}

Do not assume:

{
  “sleep_quality”: “good”
}

⸻

Quality Without Duration

Example:

Slept great.

Handling:

{
  “sleep_quality”: “excellent”
}

Do not estimate duration.

⸻

Family Disruption

Example:

Kiddo woke me up a bunch.

Handling:

{
  “disruption_notes”: “Kiddo woke me up a bunch”
}

Do not set wake_count unless count is stated.

⸻

Final Sleep Rules

* Create sleep events only when sleep is explicitly mentioned.
* Fatigue alone creates recovery, not sleep.
* Sleep duration is fact only when directly stated.
* Sleep quality is fact only when directly stated.
* Approximate duration ranges belong in estimates.
* Sleep plus low energy may create both sleep and recovery events.
* Do not infer recovery fields from sleep unless explicitly stated.
* 
# Alcohol and Social Event Events

Event Type: alcohol

Definition

An alcohol event records alcoholic drinks consumed by the user.

Alcohol is tracked separately from meals because it can affect:

* sleep
* recovery
* hydration
* hunger
* training performance
* weight trend interpretation
* social eating patterns
* calorie intake

Alcohol may be logged in the same user message as a meal or social event, but it should be represented as its own event when enough detail exists.

⸻

Core Rule

Create an alcohol event when the user states or strongly implies alcoholic drinks were consumed.

Do not bury alcohol only inside a meal event.

⸻

When to Create an Alcohol Event

Create an alcohol event when the user says:

2 hot toddy
Had two beers
Glass of wine with dinner
A couple cocktails

⸻

When Not to Create an Alcohol Event

Do not create an alcohol event for non-alcoholic beverages.

Do not create an alcohol event when the user is only planning or considering drinking.

Example:

Might have a beer tonight.

Handling:

No alcohol event unless consumption is confirmed.
Possible note event if useful.

⸻

Required Fields

For an alcohol event:

{
  “event_type”: “alcohol”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.drink_type
* facts.quantity_text
* facts.drink_count when clear
* facts.context when clear

⸻

Canonical facts Keys for Alcohol Events

Use these keys inside facts.

{
  “drink_type”: “hot toddy”,
  “quantity_text”: “2”,
  “drink_count”: 2,
  “context”: “festival”
}

drink_type

Human-readable drink name.

Examples:

beer
wine
hot toddy
cocktail
whiskey
cider

Use loose strings in v0.1.

Do not normalize alcohol types yet.

drink_count

Use numeric count only when clear.

Examples:

2 hot toddy

stores:

{
  “drink_count”: 2
}
a couple beers

may store:

{
  “drink_count”: 2
}

with slightly lower extraction confidence.

If count is vague, use quantity_text only.

⸻

Canonical estimates Keys for Alcohol Events

Use estimates when reasonable.

{
  “calories_low”: 250,
  “calories_high”: 450,
  “standard_drinks_low”: 2,
  “standard_drinks_high”: 4
}

Calories are useful because alcohol can materially affect daily energy intake.

Standard drink estimates are optional in v0.1.

If drink size or strength is unclear, use a wide range or omit standard drink estimates.

⸻

Alcohol Event Example

Raw user message:

Festival food. 2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg

Expected alcohol event:

{
  “event_type”: “alcohol”,
  “title”: “Alcohol at festival”,
  “description”: “2 hot toddies”,
  “source_text_span”: “2 hot toddy”,
  “facts”: {
    “drink_type”: “hot toddy”,
    “quantity_text”: “2 hot toddy”,
    “drink_count”: 2,
    “context”: “festival”
  },
  “estimates”: {
    “calories_low”: 250,
    “calories_high”: 500,
    “standard_drinks_low”: 2,
    “standard_drinks_high”: 4
  },
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.45,
  “needs_review”: false
}

⸻

Final Alcohol Rules

* Create alcohol events for consumed alcoholic drinks.
* Planned alcohol is not consumed alcohol.
* Track alcohol separately from meals.
* Use loose drink names in v0.1.
* Estimate calories when reasonable.
* Use wide ranges when drink size/strength is unclear.

⸻

Event Type: social_event

Definition

A social_event records context that may explain unusual nutrition, training, sleep, or recovery patterns.

Social events are not primarily about calories.

They explain why a day was different.

Examples:

* festival
* party
* three-course dinner
* camping trip
* race weekend
* travel day
* work event
* family event
* restaurant meal
* holiday

⸻

Core Rule

Create a social_event when the user describes a meaningful context that may affect food, alcohol, training, sleep, recovery, or weight trend interpretation.

Do not create a social event for every ordinary meal.

⸻

When to Create a Social Event

Create a social event when the user says:

Festival food.
Three course dinner from this menu.
Camping weekend.
Race weekend.
Travel day.
Dinner party.

⸻

When Not to Create a Social Event

Do not create a social event for ordinary daily meals.

Example:

Dinner was lentil soup.

Creates:

meal event

Does not create:

social_event

unless the user provides unusual context.

⸻

Required Fields

For a social_event event:

{
  “event_type”: “social_event”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.event_context
* facts.context_type

⸻

Canonical facts Keys for Social Event Events

Use these keys inside facts.

{
  “event_context”: “festival”,
  “context_type”: “festival”,
  “meal_context”: true,
  “alcohol_context”: true,
  “travel_related”: false,
  “training_related”: false
}

context_type

Allowed values:

festival
party
restaurant
travel
camping
race
work
family
holiday
other
unknown

Prefer other or omit rather than forcing a category.

event_context

Human-readable phrase.

Examples:

festival
three-course dinner
camping weekend
race weekend
travel day

⸻

Estimates

Social events should usually not include calorie or macro estimates.

Those belong in meal or alcohol events.

estimates should normally be empty:

{}

⸻

Social Event Examples

Example 1: Festival Food

Raw user message:

Festival food. 2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg

Expected event count:

3 events:
- social_event
- alcohol
- meal

Social event:

{
  “event_type”: “social_event”,
  “title”: “Festival”,
  “description”: “Festival food context.”,
  “source_text_span”: “Festival food.”,
  “facts”: {
    “event_context”: “festival”,
    “context_type”: “festival”,
    “meal_context”: true,
    “alcohol_context”: true,
    “travel_related”: false,
    “training_related”: false
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 2: Three-Course Dinner Menu

Raw user message:

Set is three course dinner from this menu

Expected handling:

Create social_event or raw log only depending on context.
Do not create consumed meal event unless the user confirms what was eaten.

Possible social event:

{
  “event_type”: “social_event”,
  “title”: “Three-course dinner”,
  “description”: “Three-course dinner menu context.”,
  “source_text_span”: “Set is three course dinner from this menu”,
  “facts”: {
    “event_context”: “three-course dinner”,
    “context_type”: “restaurant”,
    “meal_context”: true
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.75,
  “estimate_confidence”: null,
  “needs_review”: true
}

Set needs_review: true if it is unclear whether this is planning, menu review, or a completed meal.

⸻

Example 3: Ordinary Dinner

Raw user message:

A pretty watery bowl of lentil soup with sausage chunks for dinner

Expected handling:

Create meal event.
Do not create social_event.

⸻

Final Social Event Rules

* Social events explain unusual context.
* They are lightweight context records.
* They do not replace meal, alcohol, workout, sleep, or recovery events.
* Do not create social events for ordinary meals.
* Menu/planning messages may create social_event but not consumed meal events.
* Social events usually have empty estimates.
* 
# Note Events

Event Type: note

Definition

A note event records useful fitness, nutrition, weight, recovery, or lifestyle context that does not fit a more specific event type.

Notes are lightweight.

They are useful for preserving context without over-structuring uncertain information.

Examples:

* weight trend frustration
* meal planning strategy
* equipment/hydration planning
* body composition questions
* general training planning
* correction context when not directly updating an event
* administrative context that may matter later

⸻

Core Rule

Use note when the message is relevant to coaching or later interpretation but should not become a more specific event.

A note should not be used when a specific event type clearly applies.

⸻

When to Create a Note Event

Create a note event when the user says something like:

Man, the scale has not moved much in the last 7 days. Is that expected?
I’m planning on a couple slices and some extra protein.
Can you estimate the volume of this flask? I chose my smaller one.
Can you estimate my body fat from this picture of me?
This goes through June, not July. Looks like we might need to approach this a different way.

Only create the note if the content is useful for coaching continuity, planning, or later interpretation.

⸻

When Not to Create a Note Event

Do not create a note event just because the message exists.

Examples:

Great.
Perfect.
Continue.
Thanks.

These should normally be raw log only or not logged at all, depending on whether the GPT determines the message is fitness-relevant.

⸻

Required Fields

For a note event:

{
  “event_type”: “note”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.topic
* facts.note_category

⸻

Canonical facts Keys for Note Events

Use these keys inside facts.

{
  “topic”: “weight_trend”,
  “note_category”: “question”,
  “related_context”: “scale plateau over last 7 days”
}

topic

Allowed values:

weight_trend
meal_planning
training_planning
body_composition
hydration
equipment
import_context
admin
correction_context
general

Prefer general or omit rather than forcing a topic.

note_category

Allowed values:

question
planning
frustration
observation
admin
context
correction
other

⸻

Estimates

Notes should usually not contain estimates.

If the message asks for an estimate but does not provide a completed event, do not store the estimate as a note unless it is useful and clearly marked.

Example:

Can you estimate my body fat from this picture?

For v0.1, do not store a body-fat estimate as a weigh-in.

Possible handling:

* raw log only
* note event with topic body_composition

Do not store speculative body fat as a core bodyweight fact.

⸻

Note Event Examples

Example 1: Weight Trend Question

Raw user message:

Man, the scale has not moved much in the last 7 days. Is that expected?

Expected event:

{
  “event_type”: “note”,
  “title”: “Weight trend question”,
  “description”: “The scale has not moved much in the last 7 days.”,
  “source_text_span”: “Man, the scale has not moved much in the last 7 days. Is that expected?”,
  “facts”: {
    “topic”: “weight_trend”,
    “note_category”: “question”,
    “related_context”: “scale has not moved much in the last 7 days”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Important:

This is not a weigh_in event because no numeric bodyweight is provided.

⸻

Example 2: Meal Planning Strategy

Raw user message:

I’ve decided to have some pizza for dinner. I’m planning on a couple slices and some extra protein

Expected event:

{
  “event_type”: “note”,
  “title”: “Dinner plan”,
  “description”: “Planning to have a couple slices of pizza and some extra protein for dinner.”,
  “source_text_span”: “I’m planning on a couple slices and some extra protein”,
  “facts”: {
    “topic”: “meal_planning”,
    “note_category”: “planning”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Important:

This is not a consumed meal event until the user confirms eating it.

⸻

Example 3: Hydration / Equipment Planning

Raw user message:

Can you estimate the volume of this flask? I chose my smaller one.

Possible event:

{
  “event_type”: “note”,
  “title”: “Flask volume estimate”,
  “description”: “Asked to estimate the volume of a smaller flask.”,
  “source_text_span”: “Can you estimate the volume of this flask? I chose my smaller one.”,
  “facts”: {
    “topic”: “hydration”,
    “note_category”: “question”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.75,
  “estimate_confidence”: null,
  “needs_review”: false
}

Note:

This should only be stored if hydration planning is relevant to training, racing, or daily coaching.

⸻

Example 4: Body Composition Estimate Request

Raw user message:

New week, new weight log. Also, can you estimate my body fat from this picture of me?

Possible note event:

{
  “event_type”: “note”,
  “title”: “Body composition estimate request”,
  “description”: “Asked for a body fat estimate from a picture.”,
  “source_text_span”: “can you estimate my body fat from this picture of me?”,
  “facts”: {
    “topic”: “body_composition”,
    “note_category”: “question”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

Important:

The weight log portion is attachment-dependent. Create weigh_in events only if numeric weights are extracted.

⸻

Example 5: Administrative Planning Note

Raw user message:

This goes through June, not July. Looks like we might need to approach this a different way.

Possible handling:

Usually raw log only.
Create a note only if preserving planning context is useful.

Possible note event:

{
  “event_type”: “note”,
  “title”: “Training calendar planning issue”,
  “description”: “Training calendar went through June instead of July; planning approach may need adjustment.”,
  “source_text_span”: “This goes through June, not July. Looks like we might need to approach this a different way.”,
  “facts”: {
    “topic”: “training_planning”,
    “note_category”: “admin”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.75,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Note Edge Cases

Pure Chat Control

Example:

Continue.

Handling:

No fitness_event.

⸻

Question About Possible Food

Example:

What if I have popcorn and this protein bar?

Handling:

No meal event.
Possible note event only if useful for coaching strategy.

Possible note:

{
  “event_type”: “note”,
  “title”: “Snack planning question”,
  “description”: “Asked about having popcorn and a protein bar.”,
  “source_text_span”: “What if I have popcorn and this protein bar?”,
  “facts”: {
    “topic”: “meal_planning”,
    “note_category”: “question”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.85,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Correction That Identifies Prior Event

Example:

Actually that was 196.8, not 198.

Handling:

Prefer update_event on the existing structured record.
Do not create note event unless the prior event cannot be identified.

⸻

Final Note Rules

* Use notes for useful context that does not fit a specific event type.
* Do not use notes as a dumping ground for every message.
* Planning is not completion.
* Questions are not logs unless they include actual completed behavior.
* Notes usually have empty estimates.
* Notes should be lightweight and human-readable.
* Prefer raw log only for administrative or low-value messages.
* 
# Symptom Events

Event Type: symptom

Definition

A symptom event records physical symptoms, illness signals, injury concerns, pain, or abnormal body sensations that may affect training, recovery, nutrition, or coaching.

Symptoms are distinct from normal recovery signals.

Examples:

* headache
* migraine
* nausea
* stomach upset
* dizziness
* cold/flu symptoms
* fever
* cough
* injury pain
* joint pain
* unusual soreness
* cramps
* digestive issues
* illness

⸻

Core Rule

Create a symptom event when the user reports a physical symptom, illness, injury concern, pain, or abnormal body state.

Do not infer symptoms from low energy, hunger, fatigue, or hard training unless the user explicitly describes a symptom.

⸻

Symptom vs Recovery

Use recovery for general readiness/body-state signals:

low energy
hungry
tired
sore
run down
felt good

Use symptom for illness, pain, injury, or abnormal physical symptoms:

migraine
nausea
knee pain
sore throat
fever
stomach upset
dizzy

Some messages may create both.

Example:

Migraine today and energy is very low.

Expected event count:

2 events:
- symptom
- recovery

⸻

When to Create a Symptom Event

Create a symptom event when the user says:

I have a migraine.
My knee hurts after the run.
Stomach feels off.
I feel nauseous.
I think I’m getting sick.
Sore throat this morning.
Dizzy during the workout.

⸻

When Not to Create a Symptom Event

Do not create a symptom event for ordinary hunger:

I’m hungry.

This creates a recovery event.

Do not create a symptom event for ordinary fatigue:

I’m tired today.

This creates a recovery event.

Do not create a symptom event for normal workout soreness unless it is unusual, concerning, or pain-like.

Legs are sore from yesterday.

Usually creates a recovery event.

Sharp pain in my knee after squats.

Creates a symptom event.

⸻

Required Fields

For a symptom event:

{
  “event_type”: “symptom”,
  “description”: “...”,
  “facts”: {},
  “estimates”: {},
  “interpretations”: {}
}

Required:

* event_type
* description

Recommended:

* source_text_span
* facts.symptom
* facts.body_location
* facts.severity_reported
* facts.onset
* facts.training_related when explicitly stated or directly linked

⸻

Canonical facts Keys for Symptom Events

Use these keys inside facts.

{
  “symptom”: “migraine”,
  “body_location”: “head”,
  “severity_reported”: “high”,
  “onset”: “today”,
  “training_related”: false,
  “illness_flag”: false,
  “injury_flag”: false
}

All keys are optional except when clearly available.

⸻

symptom

Human-readable symptom name.

Examples:

migraine
headache
nausea
knee pain
sore throat
cough
stomach upset
dizziness

Use loose strings in v0.1.

Do not normalize to medical codes.

⸻

body_location

Use when stated or obvious.

Examples:

head
knee
ankle
stomach
throat
back
shoulder
hip
calf
hamstring

Do not guess body location unless inherent in the symptom.

Example:

migraine

may use:

{
  “body_location”: “head”
}

Example:

pain

should not use a location unless specified.

⸻

severity_reported

Allowed values:

mild
moderate
high
very_high

Only populate when the user states or clearly implies severity.

Examples:

slight headache

stores:

{
  “severity_reported”: “mild”
}
bad migraine

stores:

{
  “severity_reported”: “high”
}

⸻

illness_flag

Use when the symptom suggests illness or the user explicitly mentions being sick.

Examples:

I think I’m getting sick.

stores:

{
  “illness_flag”: true
}
sore throat and cough

may store:

{
  “illness_flag”: true
}

⸻

injury_flag

Use when the symptom suggests injury or pain related to movement/training.

Examples:

Sharp knee pain after the run.

stores:

{
  “injury_flag”: true,
  “training_related”: true
}

Do not mark normal DOMS as injury.

⸻

Canonical estimates Keys for Symptom Events

Symptom estimates should be rare.

Do not estimate severity unless the user clearly indicates it.

For v0.1, estimates should usually be empty:

{}

⸻

Interpretations

Do not store medical interpretations as facts.

Do not write:

{
  “likely_cause”: “dehydration”
}

as a fact.

If GPT gives coaching guidance, keep it in the response or later coach_observations, not as factual symptom data.

⸻

Symptom Event Examples

Example 1: Migraine

Raw user message:

I have a migraine today.

Expected event:

{
  “event_type”: “symptom”,
  “title”: “Migraine”,
  “description”: “Migraine today.”,
  “source_text_span”: “I have a migraine today.”,
  “facts”: {
    “symptom”: “migraine”,
    “body_location”: “head”,
    “onset”: “today”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 2: Knee Pain After Run

Raw user message:

My knee hurts after the run.

Expected event:

{
  “event_type”: “symptom”,
  “title”: “Knee pain”,
  “description”: “Knee hurts after the run.”,
  “source_text_span”: “My knee hurts after the run.”,
  “facts”: {
    “symptom”: “knee pain”,
    “body_location”: “knee”,
    “training_related”: true,
    “injury_flag”: true
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 3: Getting Sick

Raw user message:

I think I’m getting sick. Sore throat this morning.

Expected event:

{
  “event_type”: “symptom”,
  “title”: “Possible illness”,
  “description”: “Possible illness with sore throat this morning.”,
  “source_text_span”: “I think I’m getting sick. Sore throat this morning.”,
  “facts”: {
    “symptom”: “sore throat”,
    “body_location”: “throat”,
    “onset”: “this morning”,
    “illness_flag”: true
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.9,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Example 4: Symptom Plus Recovery

Raw user message:

Migraine today and energy is very low.

Expected event count:

2 events:
- symptom
- recovery

Symptom event:

{
  “event_type”: “symptom”,
  “title”: “Migraine”,
  “description”: “Migraine today.”,
  “source_text_span”: “Migraine today”,
  “facts”: {
    “symptom”: “migraine”,
    “body_location”: “head”,
    “onset”: “today”
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

Recovery event:

{
  “event_type”: “recovery”,
  “title”: “Very low energy”,
  “description”: “Energy is very low.”,
  “source_text_span”: “energy is very low”,
  “facts”: {
    “energy_level”: “very_low”,
    “explicitly_mentioned_fields”: [
      “energy_level”
    ]
  },
  “estimates”: {},
  “interpretations”: {},
  “extraction_confidence”: 0.95,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Symptom Edge Cases

Normal Soreness

Example:

Legs are sore from yesterday.

Handling:

Usually recovery event, not symptom.

Pain or Injury Concern

Example:

Sharp pain in my calf during the run.

Handling:

symptom event

Digestive Issue After Meal

Example:

Dinner made my stomach feel off.

Expected event count:

2 events if meal details are present:
- meal
- symptom

Symptom facts may include:

{
  “symptom”: “stomach upset”,
  “body_location”: “stomach”
}

Medical Diagnosis

If the user reports a diagnosis, store only what they stated.

Example:

Doctor said it is a sinus infection.

Possible event:

{
  “event_type”: “symptom”,
  “description”: “Doctor said it is a sinus infection.”,
  “facts”: {
    “symptom”: “sinus infection”,
    “illness_flag”: true,
    “source”: “doctor”
  },
  “estimates”: {},
  “interpretations”: {}
}

Do not add additional medical interpretation.

⸻

Final Symptom Rules

* Create symptom events for illness, pain, injury concern, or abnormal physical symptoms.
* Do not use symptom for ordinary hunger or tiredness.
* Normal workout soreness usually belongs in recovery.
* Pain, sharp pain, joint issues, illness signs, migraines, nausea, dizziness, and digestive issues belong in symptom.
* Do not store medical speculation as facts.
* Use loose human-readable symptom strings in v0.1.
* Symptoms may coexist with meal, workout, sleep, or recovery events. 
* 
# Confidence, Review, and Source Text Rules

Confidence and Review Rules

Purpose

Every extracted fitness_event may include:

{
  “extraction_confidence”: 0.95,
  “estimate_confidence”: 0.65,
  “needs_review”: false
}

These fields help distinguish:

* clear facts
* uncertain extraction
* rough estimates
* records that should be checked later

⸻

extraction_confidence

Definition

extraction_confidence describes how confident GPT is that:

1. the event should exist, and
2. the event was classified correctly, and
3. the core factual extraction is accurate.

It is about the event extraction, not calorie or macro accuracy.

Scale

Use a number from 0.0 to 1.0.

Recommended bands:

0.95–1.00 = very clear
0.80–0.94 = clear
0.60–0.79 = plausible but incomplete or context-dependent
0.40–0.59 = uncertain
below 0.40 = usually do not create event

Examples

Clear meal:

A pretty watery bowl of lentil soup with sausage chunks for dinner.
{
  “event_type”: “meal”,
  “extraction_confidence”: 0.95
}

Clear weigh-in:

Weighed 198.0.
{
  “event_type”: “weigh_in”,
  “extraction_confidence”: 1.0
}

Attachment-dependent workout:

Great xfit today. 3 back to back AMRAPs. Can you read the board?

Without readable board content:

{
  “event_type”: “workout”,
  “extraction_confidence”: 0.70,
  “needs_review”: true
}

Planning question:

What if I have popcorn and this protein bar?

Usually no meal event should be created.

If stored as a note:

{
  “event_type”: “note”,
  “extraction_confidence”: 0.85
}

⸻

estimate_confidence

Definition

estimate_confidence describes how reliable GPT’s numerical estimates are.

It applies to estimates such as:

* calories
* protein
* carbs
* fat
* duration ranges
* training load
* standard drinks
* portion size

It does not apply to explicit facts.

Scale

Use a number from 0.0 to 1.0, or null when there are no estimates.

Recommended bands:

0.80–1.00 = strong estimate; quantities are clear
0.60–0.79 = reasonable estimate; some uncertainty
0.40–0.59 = rough estimate; vague portion or mixed foods
0.20–0.39 = very rough; should usually need review
null = no estimates provided

Examples

Specific meal:

3 eggs, 1/2 English muffin, mushrooms.
{
  “estimate_confidence”: 0.75
}

Vague meal:

A bowl of lentil soup with sausage chunks.
{
  “estimate_confidence”: 0.55
}

Festival food:

2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets.
{
  “estimate_confidence”: 0.45,
  “needs_review”: true
}

Explicit weigh-in:

Weighed 198.0.
{
  “estimate_confidence”: null
}

⸻

needs_review

Definition

needs_review indicates that the record should be inspected later in the admin UI.

It does not mean the record is useless.

It means the extraction, estimate, or context is uncertain enough that human review may improve data quality.

Set needs_review: true when:

* the event depends on an unclear image or attachment
* the event type is uncertain
* the date association is uncertain
* a weight value was extracted from handwriting or unclear image data
* portion size is highly uncertain
* calories/protein estimates are very rough
* the user appears to be correcting a prior record but the target event is unclear
* the message is ambiguous between planned and completed behavior
* the extraction confidence is below about 0.75
* estimate confidence is below about 0.45 and estimates are included

Keep needs_review: false when:

* the event clearly occurred
* the category is clear
* factual fields are directly stated
* estimates are reasonable or omitted
* uncertainty is low-impact

⸻

Review Examples

No Review Needed

Raw text:

Weighed 198.0.

Event:

{
  “event_type”: “weigh_in”,
  “facts”: {
    “weight_value”: 198.0,
    “weight_unit”: “lb”
  },
  “extraction_confidence”: 1.0,
  “estimate_confidence”: null,
  “needs_review”: false
}

⸻

Review Needed: Attachment-Dependent

Raw text:

Great xfit today. 3 back to back AMRAPs. Can you read the board?

Event if board is unavailable or unclear:

{
  “event_type”: “workout”,
  “description”: “Great CrossFit workout. 3 back-to-back AMRAPs.”,
  “facts”: {
    “workout_type”: “crossfit”,
    “structure”: “3 back-to-back AMRAPs”
  },
  “estimates”: {},
  “extraction_confidence”: 0.70,
  “estimate_confidence”: null,
  “needs_review”: true
}

⸻

Review Needed: Vague Meal Estimate

Raw text:

Festival food. 2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets.

Meal event:

{
  “event_type”: “meal”,
  “description”: “1 Dagwood dog and about 3 chicken nuggets.”,
  “facts”: {
    “foods”: [“Dagwood dog”, “chicken nuggets”],
    “quantity_text”: “1 Dagwood dog and like 3 chicken nuggets”
  },
  “estimates”: {
    “calories_low”: 500,
    “calories_high”: 900,
    “protein_g_low”: 15,
    “protein_g_high”: 35
  },
  “extraction_confidence”: 0.90,
  “estimate_confidence”: 0.45,
  “needs_review”: true
}

⸻

Source Text Span Rules

Purpose

source_text_span records the shortest useful portion of the original user message that supports a specific fitness_event.

This makes structured extraction traceable.

It allows a reviewer to answer:

Why did this event exist?

without reading the entire raw log.

⸻

Core Rule

Use the smallest clear quote from the user’s raw message that supports the event.

Do not paraphrase unless the source is an attachment or image.

Do not use assistant-generated wording as the source span.

⸻

Examples

Parent raw text:

Festival food. 2 hot toddy, 1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg.

Social event:

{
  “event_type”: “social_event”,
  “source_text_span”: “Festival food.”
}

Alcohol event:

{
  “event_type”: “alcohol”,
  “source_text_span”: “2 hot toddy”
}

Meal event:

{
  “event_type”: “meal”,
  “source_text_span”: “1 Dagwood dog and like 3 chicken nuggets. Dinner was a Japanese chicken katsu with curry on about 100g of rice and a little veg.”
}

⸻

Source Span for Multi-Event Messages

A single log_entry.raw_text may produce several events.

Each event should have its own source_text_span.

Example raw text:

Today’s workout. Finished in 53 minutes. I had a twizzler before to prep.

Workout event:

{
  “event_type”: “workout”,
  “source_text_span”: “Today’s workout. Finished in 53 minutes.”
}

Meal event:

{
  “event_type”: “meal”,
  “source_text_span”: “I had a twizzler before to prep.”
}

⸻

Source Span for Attachments

If an event is extracted from an image, menu, workout board, nutrition label, or weight-log photo, use a descriptive source span.

Examples:

{
  “source_text_span”: “Attached weight log image”
}
{
  “source_text_span”: “Attached workout board image”
}
{
  “source_text_span”: “Attached nutrition label”
}

If both user text and attachment are used, include both when practical.

Example:

{
  “source_text_span”: “User text: ‘4 spoonfuls like that.’ Attachment: nutrition label and spoonful image.”
}

⸻

Source Span for Corrections

If the user corrects a previous event, prefer update_event.

The correction message itself may have:

{
  “source_text_span”: “Actually that was 196.8, not 198.”
}

But the corrected event should preserve the original raw log via its original log_entry_id.

Future versions may add revision history.

v0.1 does not maintain a separate event revision table.

⸻

Source Span for Planning vs Completion

Planning messages should not become completed events.

Example:

I’m planning on a couple slices and some extra protein.

If stored as a note:

{
  “event_type”: “note”,
  “source_text_span”: “I’m planning on a couple slices and some extra protein.”
}

Do not later treat this source span as proof that the food was eaten.

⸻

Missing or Unclear Source Span

source_text_span is recommended but not strictly required.

It may be null when:

* the source text is extremely short and fully duplicated by description
* the event is created by an import process with limited traceability
* the source is a structured admin entry
* source text is unavailable

However, GPT should provide it whenever possible.

⸻

Final Confidence and Source Rules

* extraction_confidence measures confidence that the event exists and was classified correctly.
* estimate_confidence measures confidence in numerical estimates.
* needs_review flags records worth checking later.
* source_text_span should be the shortest useful source quote.
* Multi-event messages should have separate source spans per event.
* Attachment-derived events should identify the attachment source.
* Planning spans must not be treated as completed behavior.
* Use review flags aggressively for unclear images, ambiguous dates, and rough estimates.