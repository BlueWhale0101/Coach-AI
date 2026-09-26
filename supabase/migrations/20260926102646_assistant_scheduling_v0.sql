-- Assistant.AI Scheduling V0. This migration adds only Scheduling-owned objects.
create table public.assistant_schedule_events (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  title text not null,
  description text null,
  time_kind text not null,
  starts_at timestamptz null,
  ends_at timestamptz null,
  timezone text null,
  start_date date null,
  end_date date null,
  status text not null default 'scheduled',
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_schedule_events_title_not_blank check (btrim(title) <> ''),
  constraint assistant_schedule_events_status_valid check (status in ('scheduled', 'cancelled')),
  constraint assistant_schedule_events_cancellation_consistent
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint assistant_schedule_events_temporal_shape check (
    (time_kind = 'timed'
      and starts_at is not null and ends_at is not null
      and timezone is not null and btrim(timezone) <> ''
      and start_date is null and end_date is null
      and starts_at < ends_at)
    or
    (time_kind = 'all_day'
      and start_date is not null and end_date is not null
      and starts_at is null and ends_at is null and timezone is null
      and start_date < end_date)
  )
);

create index assistant_schedule_events_timed_idx
  on public.assistant_schedule_events (status, starts_at, ends_at, object_id)
  where time_kind = 'timed';
create index assistant_schedule_events_all_day_idx
  on public.assistant_schedule_events (status, start_date, end_date, object_id)
  where time_kind = 'all_day';

create function public.assistant_validate_schedule_event()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Serialize event insertion with a concurrent registry type change.
  if not exists (select 1 from public.assistant_objects
                 where id = new.object_id and object_type = 'schedule_event' for update) then
    raise exception using errcode = '23514',
      message = 'schedule event must reference an object of type schedule_event';
  end if;
  if new.time_kind = 'timed' and new.timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names
                     where name = new.timezone) then
    raise exception using errcode = '22023', message = 'invalid schedule timezone';
  end if;
  return new;
end;
$$;
create trigger assistant_schedule_events_validate
before insert or update of object_id, time_kind, timezone
on public.assistant_schedule_events
for each row execute function public.assistant_validate_schedule_event();

create function public.assistant_protect_schedule_event_object_type()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.object_type = 'schedule_event' and new.object_type <> 'schedule_event'
     and exists (select 1 from public.assistant_schedule_events where object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change registered schedule event type';
  end if;
  return new;
end;
$$;
create trigger assistant_objects_protect_schedule_event_type
before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_schedule_event_object_type();

create function public.assistant_guard_schedule_event()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' or new.cancelled_at is not null then
      raise exception using errcode = '55000', message = 'new schedule event must be scheduled';
    end if;
    return new;
  end if;
  if new.object_id is distinct from old.object_id then
    raise exception using errcode = '23514', message = 'schedule event identity is immutable';
  end if;
  if old.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'schedule event is cancelled';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_schedule_events_guard
before insert or update on public.assistant_schedule_events
for each row execute function public.assistant_guard_schedule_event();

-- Both inserts execute inside one RPC transaction; a failed event insert
-- cannot leave a registry object behind.
create function public.assistant_create_schedule_event(
  p_title text, p_description text, p_time_kind text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text,
  p_start_date date, p_end_date date
)
returns setof public.assistant_schedule_events
language plpgsql security invoker set search_path = public as $$
declare v_object_id uuid;
begin
  insert into public.assistant_objects(object_type)
  values ('schedule_event') returning id into v_object_id;
  return query
  insert into public.assistant_schedule_events (
    object_id, title, description, time_kind, starts_at, ends_at,
    timezone, start_date, end_date
  ) values (
    v_object_id, p_title, p_description, p_time_kind, p_starts_at, p_ends_at,
    p_timezone, p_start_date, p_end_date
  ) returning *;
end;
$$;

create function public.assistant_update_schedule_event(p_object_id uuid, p_patch jsonb)
returns setof public.assistant_schedule_events
language plpgsql security invoker set search_path = public as $$
declare
  v_temporal boolean;
  v_kind text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'invalid schedule event patch';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) as fields(key)
             where key not in ('title', 'description', 'time_kind',
                               'starts_at', 'ends_at', 'timezone', 'start_date', 'end_date')) then
    raise exception using errcode = '22023', message = 'patch contains unsupported schedule event fields';
  end if;
  v_temporal := p_patch ?| array['time_kind','starts_at','ends_at','timezone','start_date','end_date'];
  if v_temporal then
    v_kind := coalesce(p_patch->>'time_kind', '');
    if not (
      (v_kind = 'timed' and p_patch ?& array['time_kind','starts_at','ends_at','timezone']
       and not (p_patch ?| array['start_date','end_date']))
      or
      (v_kind = 'all_day' and p_patch ?& array['time_kind','start_date','end_date']
       and not (p_patch ?| array['starts_at','ends_at','timezone']))
    ) then
      raise exception using errcode = '22023',
        message = 'temporal update requires a complete timed or all-day representation';
    end if;
  end if;

  return query
  update public.assistant_schedule_events
  set title = case when p_patch ? 'title' then p_patch->>'title' else title end,
      description = case when p_patch ? 'description' then p_patch->>'description' else description end,
      time_kind = case when v_temporal then v_kind else time_kind end,
      starts_at = case when v_temporal and v_kind = 'timed'
                       then (p_patch->>'starts_at')::timestamptz
                       when v_temporal then null else starts_at end,
      ends_at = case when v_temporal and v_kind = 'timed'
                     then (p_patch->>'ends_at')::timestamptz
                     when v_temporal then null else ends_at end,
      timezone = case when v_temporal and v_kind = 'timed'
                      then p_patch->>'timezone'
                      when v_temporal then null else timezone end,
      start_date = case when v_temporal and v_kind = 'all_day'
                        then (p_patch->>'start_date')::date
                        when v_temporal then null else start_date end,
      end_date = case when v_temporal and v_kind = 'all_day'
                      then (p_patch->>'end_date')::date
                      when v_temporal then null else end_date end
  where object_id = p_object_id and status = 'scheduled'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_schedule_events where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'schedule event is cancelled';
    end if;
    raise exception using errcode = 'P0002', message = 'schedule event not found';
  end if;
end;
$$;

create function public.assistant_cancel_schedule_event(p_object_id uuid)
returns setof public.assistant_schedule_events
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.assistant_schedule_events
  set status = 'cancelled', cancelled_at = now()
  where object_id = p_object_id and status = 'scheduled'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_schedule_events where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'schedule event is already cancelled';
    end if;
    raise exception using errcode = 'P0002', message = 'schedule event not found';
  end if;
end;
$$;

-- Windows are half-open. Each supplied window applies only to its matching
-- representation; supplying both retrieves both kinds in the same calendar page.
create function public.assistant_list_schedule_events(
  p_status text default null,
  p_timed_overlap_start timestamptz default null,
  p_timed_overlap_end timestamptz default null,
  p_all_day_overlap_start date default null,
  p_all_day_overlap_end date default null,
  p_limit integer default 50, p_offset integer default 0
)
returns setof public.assistant_schedule_events
language sql stable security invoker set search_path = public as $$
  select event.* from public.assistant_schedule_events event
  where (p_status is null or event.status = p_status)
    and (
      (p_timed_overlap_start is null and p_timed_overlap_end is null
       and p_all_day_overlap_start is null and p_all_day_overlap_end is null)
      or (event.time_kind = 'timed'
          and p_timed_overlap_start is not null and p_timed_overlap_end is not null
          and event.starts_at < p_timed_overlap_end
          and event.ends_at > p_timed_overlap_start)
      or (event.time_kind = 'all_day'
          and p_all_day_overlap_start is not null and p_all_day_overlap_end is not null
          and event.start_date < p_all_day_overlap_end
          and event.end_date > p_all_day_overlap_start)
    )
  order by coalesce(event.start_date, (event.starts_at at time zone event.timezone)::date) asc,
           case when event.time_kind = 'all_day' then 0 else 1 end,
           event.starts_at asc nulls first, event.created_at asc, event.object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

create function public.assistant_search_schedule_events(
  p_query text, p_status text default null, p_limit integer default 50, p_offset integer default 0
)
returns setof public.assistant_schedule_events
language sql stable security invoker set search_path = public as $$
  select event.* from public.assistant_schedule_events event
  where (position(lower(p_query) in lower(event.title)) > 0
         or position(lower(p_query) in lower(coalesce(event.description, ''))) > 0)
    and (p_status is null or event.status = p_status)
  order by coalesce(event.start_date, (event.starts_at at time zone event.timezone)::date) asc,
           case when event.time_kind = 'all_day' then 0 else 1 end,
           event.starts_at asc nulls first, event.created_at asc, event.object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

alter table public.assistant_schedule_events enable row level security;
revoke all on public.assistant_schedule_events from public, anon, authenticated;
grant select, insert, update on public.assistant_schedule_events to service_role;

revoke all on function public.assistant_validate_schedule_event() from public, anon, authenticated;
revoke all on function public.assistant_protect_schedule_event_object_type() from public, anon, authenticated;
revoke all on function public.assistant_guard_schedule_event() from public, anon, authenticated;
revoke all on function public.assistant_create_schedule_event(text,text,text,timestamptz,timestamptz,text,date,date) from public, anon, authenticated;
revoke all on function public.assistant_update_schedule_event(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.assistant_cancel_schedule_event(uuid) from public, anon, authenticated;
revoke all on function public.assistant_list_schedule_events(text,timestamptz,timestamptz,date,date,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_search_schedule_events(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.assistant_create_schedule_event(text,text,text,timestamptz,timestamptz,text,date,date) to service_role;
grant execute on function public.assistant_update_schedule_event(uuid,jsonb) to service_role;
grant execute on function public.assistant_cancel_schedule_event(uuid) to service_role;
grant execute on function public.assistant_list_schedule_events(text,timestamptz,timestamptz,date,date,integer,integer) to service_role;
grant execute on function public.assistant_search_schedule_events(text,text,integer,integer) to service_role;
