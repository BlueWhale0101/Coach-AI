-- Fitness Logging & Analysis System
-- schema.sql
-- Interface/Data Model Version: v0.1
--
-- Deployment target: Supabase Postgres
-- Design principles:
--   - Logging remains conversational
--   - Storage is structured
--   - Raw text is always preserved
--   - GPT extracts; Edge Functions validate and store

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Common updated_at trigger
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Tracks bulk imports/backfills such as historical ChatGPT exports, weight-log
-- images, manual JSON imports, or admin uploads.
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),

  batch_type text not null check (
    batch_type in (
      'chat_history',
      'weight_log_image',
      'manual_json',
      'admin_upload'
    )
  ),

  source_description text null,
  source_date_range_start date null,
  source_date_range_end date null,

  raw_payload jsonb null,

  status text not null default 'pending' check (
    status in (
      'pending',
      'processing',
      'completed',
      'failed',
      'partially_completed'
    )
  ),

  entries_found integer null check (entries_found is null or entries_found >= 0),
  entries_imported integer null check (entries_imported is null or entries_imported >= 0),
  entries_needing_review integer null check (entries_needing_review is null or entries_needing_review >= 0),

  error_message text null,

  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

comment on table public.import_batches is
  'Tracks bulk imports/backfills such as chat history, weight-log images, manual JSON, or admin uploads.';

-- Immutable source record for raw conversational logs. Raw text is authoritative.
create table if not exists public.log_entries (
  id uuid primary key default gen_random_uuid(),

  occurred_date date not null,
  occurred_time time null,

  raw_text text not null check (length(trim(raw_text)) > 0),

  source text not null check (
    source in (
      'gpt_action',
      'chat_backfill',
      'web_admin',
      'manual'
    )
  ),

  import_batch_id uuid null references public.import_batches(id) on delete set null,

  extraction_status text not null default 'pending' check (
    extraction_status in (
      'pending',
      'extracted',
      'partially_extracted',
      'failed',
      'skipped'
    )
  ),

  extraction_confidence numeric(3,2) null check (
    extraction_confidence is null or
    (extraction_confidence >= 0 and extraction_confidence <= 1)
  ),

  needs_review boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.log_entries is
  'Immutable raw conversational log entries. One user message creates one log entry. Raw text must not be overwritten by extraction.';

comment on column public.log_entries.raw_text is
  'Original user message preserved exactly as the authoritative source record.';

-- Flexible structured child records extracted from log_entries.
create table if not exists public.fitness_events (
  id uuid primary key default gen_random_uuid(),

  log_entry_id uuid not null references public.log_entries(id) on delete cascade,

  occurred_date date not null,
  occurred_time time null,

  event_type text not null check (
    event_type in (
      'meal',
      'workout',
      'weigh_in',
      'recovery',
      'sleep',
      'note',
      'social_event',
      'alcohol',
      'symptom'
    )
  ),

  title text null,
  description text not null check (length(trim(description)) > 0),

  source_text_span text null,

  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  estimates jsonb not null default '{}'::jsonb check (jsonb_typeof(estimates) = 'object'),
  interpretations jsonb not null default '{}'::jsonb check (jsonb_typeof(interpretations) = 'object'),

  extraction_confidence numeric(3,2) null check (
    extraction_confidence is null or
    (extraction_confidence >= 0 and extraction_confidence <= 1)
  ),

  estimate_confidence numeric(3,2) null check (
    estimate_confidence is null or
    (estimate_confidence >= 0 and estimate_confidence <= 1)
  ),

  needs_review boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fitness_events is
  'Flexible structured events extracted from raw log_entries. Event-specific data lives in facts, estimates, and interpretations JSONB objects.';

comment on column public.fitness_events.source_text_span is
  'Shortest useful quote or attachment descriptor that supports this event.';

comment on column public.fitness_events.facts is
  'Explicit user-stated or directly observed facts. Do not store GPT guesses here.';

comment on column public.fitness_events.estimates is
  'GPT-generated estimates such as calorie/protein ranges, training load, or duration ranges.';

comment on column public.fitness_events.interpretations is
  'Interpretive fields. Normal logging should usually leave this empty; persistent coaching interpretation belongs in coach_observations.';

-- Persistent coaching observations. Not automatically created by add_log_entry.
create table if not exists public.coach_observations (
  id uuid primary key default gen_random_uuid(),

  log_entry_id uuid null references public.log_entries(id) on delete set null,

  occurred_date date not null,

  observation_type text not null check (
    observation_type in (
      'fueling',
      'recovery',
      'training_load',
      'weight_trend',
      'behavior',
      'risk',
      'positive_reinforcement',
      'other'
    )
  ),

  observation_text text not null check (length(trim(observation_text)) > 0),

  evidence_log_entry_ids uuid[] null,
  evidence_fitness_event_ids uuid[] null,

  confidence numeric(3,2) null check (
    confidence is null or
    (confidence >= 0 and confidence <= 1)
  ),

  actionable boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.coach_observations is
  'Persistent coaching analysis, interpretation, and recommendations. Not factual user data.';

-- Derived daily rollups. Regeneratable; not the source of truth.
create table if not exists public.daily_summaries (
  id uuid primary key default gen_random_uuid(),

  summary_date date not null unique,

  bodyweight_value numeric(5,1) null,
  bodyweight_unit text null check (
    bodyweight_unit is null or bodyweight_unit in ('lb', 'kg')
  ),

  calories_low integer null check (calories_low is null or calories_low >= 0),
  calories_high integer null check (calories_high is null or calories_high >= 0),
  protein_g_low integer null check (protein_g_low is null or protein_g_low >= 0),
  protein_g_high integer null check (protein_g_high is null or protein_g_high >= 0),

  workout_count integer not null default 0 check (workout_count >= 0),
  workout_summary text null,

  training_load text null check (
    training_load is null or training_load in (
      'rest',
      'light',
      'moderate',
      'hard',
      'very_hard'
    )
  ),

  recovery_summary text null,
  sleep_summary text null,

  coach_summary text null,

  flags jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),

  source_log_entry_ids uuid[] null,
  source_fitness_event_ids uuid[] null,

  generated_by text not null default 'gpt',
  needs_review boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    calories_low is null or calories_high is null or calories_low <= calories_high
  ),
  check (
    protein_g_low is null or protein_g_high is null or protein_g_low <= protein_g_high
  )
);

comment on table public.daily_summaries is
  'Derived daily overview for trend review and coaching continuity. Regeneratable; not source of truth.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists set_updated_at_log_entries on public.log_entries;
create trigger set_updated_at_log_entries
before update on public.log_entries
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_fitness_events on public.fitness_events;
create trigger set_updated_at_fitness_events
before update on public.fitness_events
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_coach_observations on public.coach_observations;
create trigger set_updated_at_coach_observations
before update on public.coach_observations
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_daily_summaries on public.daily_summaries;
create trigger set_updated_at_daily_summaries
before update on public.daily_summaries
for each row
execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

create index if not exists idx_import_batches_status
  on public.import_batches(status);

create index if not exists idx_log_entries_occurred_date
  on public.log_entries(occurred_date desc);

create index if not exists idx_log_entries_source
  on public.log_entries(source);

create index if not exists idx_log_entries_import_batch_id
  on public.log_entries(import_batch_id);

create index if not exists idx_log_entries_needs_review
  on public.log_entries(needs_review)
  where needs_review = true;

create index if not exists idx_log_entries_raw_text_trgm
  on public.log_entries using gin (raw_text gin_trgm_ops);

create index if not exists idx_fitness_events_log_entry_id
  on public.fitness_events(log_entry_id);

create index if not exists idx_fitness_events_occurred_date
  on public.fitness_events(occurred_date desc);

create index if not exists idx_fitness_events_type_date
  on public.fitness_events(event_type, occurred_date desc);

create index if not exists idx_fitness_events_needs_review
  on public.fitness_events(needs_review)
  where needs_review = true;

create index if not exists idx_fitness_events_description_trgm
  on public.fitness_events using gin (description gin_trgm_ops);

create index if not exists idx_fitness_events_source_span_trgm
  on public.fitness_events using gin (source_text_span gin_trgm_ops);

create index if not exists idx_fitness_events_facts_gin
  on public.fitness_events using gin (facts);

create index if not exists idx_fitness_events_estimates_gin
  on public.fitness_events using gin (estimates);

create index if not exists idx_daily_summaries_summary_date
  on public.daily_summaries(summary_date desc);

create index if not exists idx_coach_observations_occurred_date
  on public.coach_observations(occurred_date desc);

create index if not exists idx_coach_observations_type_date
  on public.coach_observations(observation_type, occurred_date desc);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- v0.1 preferred access pattern:
--   Custom GPT / Admin UI -> Edge Function -> Database
--
-- Enable RLS now. No permissive policies are created here, so browser clients using
-- anon keys cannot directly read/write these tables. Edge Functions using the
-- service role / secret key can still perform server-side operations.

alter table public.import_batches enable row level security;
alter table public.log_entries enable row level security;
alter table public.fitness_events enable row level security;
alter table public.coach_observations enable row level security;
alter table public.daily_summaries enable row level security;

-- -----------------------------------------------------------------------------
-- Smoke test helper comments
-- -----------------------------------------------------------------------------
-- After running this schema, verify tables in Supabase Dashboard -> Table Editor.
-- Do not insert data manually yet unless testing. The first real insert path should
-- be the add-log-entry Edge Function.
