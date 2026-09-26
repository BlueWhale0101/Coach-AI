-- Assistant.AI Recurrence V0. Only recurrence-owned storage and registry guards.
create table public.assistant_recurrences (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  seed_object_id uuid not null references public.assistant_objects(id) on delete restrict,
  basis text not null,
  frequency text not null,
  interval_count integer not null,
  anchor_kind text null,
  anchor_at timestamptz null,
  anchor_date date null,
  timezone text null,
  weekdays smallint[] null,
  status text not null default 'active',
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_recurrence_frequency check (frequency in ('daily','weekly','monthly','yearly')),
  constraint assistant_recurrence_interval check (interval_count > 0),
  constraint assistant_recurrence_status check (status in ('active','ended') and (status = 'ended') = (ended_at is not null)),
  constraint assistant_recurrence_shape check (
    (basis = 'calendar' and
      ((anchor_kind = 'instant' and anchor_at is not null and anchor_date is null and timezone is not null and btrim(timezone) <> '')
        or (anchor_kind = 'date' and anchor_date is not null and anchor_at is null and timezone is null)))
    or (basis = 'after_completion' and anchor_kind is null and anchor_at is null and anchor_date is null
        and timezone is not null and btrim(timezone) <> '' and weekdays is null)
  ),
  constraint assistant_recurrence_weekdays_shape check (weekdays is null or (basis = 'calendar' and frequency = 'weekly')),
  constraint assistant_recurrence_not_self check (object_id <> seed_object_id)
);

create table public.assistant_recurrence_occurrences (
  recurrence_object_id uuid not null references public.assistant_recurrences(object_id) on delete cascade,
  sequence bigint not null check (sequence >= 0),
  occurrence_at timestamptz null,
  occurrence_date date null,
  generated_object_id uuid not null references public.assistant_objects(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (recurrence_object_id, sequence),
  constraint assistant_recurrence_position_shape check ((occurrence_at is not null) <> (occurrence_date is not null)),
  constraint assistant_recurrence_member_once unique (generated_object_id)
);
create unique index assistant_recurrence_instant_once on public.assistant_recurrence_occurrences(recurrence_object_id, occurrence_at) where occurrence_at is not null;
create unique index assistant_recurrence_date_once on public.assistant_recurrence_occurrences(recurrence_object_id, occurrence_date) where occurrence_date is not null;
create index assistant_recurrence_filter_idx on public.assistant_recurrences(status, basis, seed_object_id, object_id);

create function public.assistant_validate_recurrence()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_seed_type text; v_day integer;
begin
  if not exists (select 1 from public.assistant_objects where id = new.object_id and object_type = 'recurrence' for update) then
    raise exception using errcode = '23514', message = 'recurrence identity must have type recurrence';
  end if;
  select object_type into v_seed_type from public.assistant_objects where id = new.seed_object_id for update;
  if v_seed_type is null or v_seed_type not in ('task','schedule_event') then
    raise exception using errcode = '22023', message = 'recurrence seed must be a task or schedule event';
  end if;
  if new.basis = 'after_completion' and v_seed_type <> 'task' then
    raise exception using errcode = '22023', message = 'completion-relative recurrence requires a task';
  end if;
  if new.timezone is not null and not exists
      (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = '22023', message = 'invalid recurrence timezone';
  end if;
  if new.weekdays is not null then
    if cardinality(new.weekdays) = 0 or exists
      (select 1 from unnest(new.weekdays) as d(day) where d.day is null or d.day < 1 or d.day > 7)
      or (select count(distinct d.day) from unnest(new.weekdays) as d(day)) <> cardinality(new.weekdays) then
      raise exception using errcode = '22023', message = 'weekdays must be unique ISO weekdays 1 through 7';
    end if;
    v_day := extract(isodow from coalesce((new.anchor_at at time zone new.timezone)::date, new.anchor_date));
    if not v_day = any(new.weekdays) then
      raise exception using errcode = '22023', message = 'weekly seed anchor must be a selected weekday';
    end if;
    select array_agg(d.day order by d.day) into new.weekdays from unnest(new.weekdays) as d(day);
  end if;
  return new;
end;
$$;
create trigger assistant_recurrences_validate before insert or update of object_id, seed_object_id, basis, frequency, interval_count, anchor_kind, anchor_at, anchor_date, timezone, weekdays
on public.assistant_recurrences for each row execute function public.assistant_validate_recurrence();

create function public.assistant_guard_recurrence()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.ended_at is not null then
      raise exception using errcode = '55000', message = 'new recurrence must be active';
    end if;
    return new;
  end if;
  if new.object_id is distinct from old.object_id or new.seed_object_id is distinct from old.seed_object_id then
    raise exception using errcode = '23514', message = 'recurrence identity and seed are immutable';
  end if;
  if old.status <> 'active' then
    raise exception using errcode = '55000', message = 'recurrence is ended';
  end if;
  if new.status = 'ended' and (to_jsonb(new) - 'status' - 'ended_at' - 'updated_at' - 'created_at')
                              is distinct from (to_jsonb(old) - 'status' - 'ended_at' - 'updated_at' - 'created_at') then
    raise exception using errcode = '55000', message = 'ending cannot change recurrence rule';
  end if;
  if new.status = 'active' and new.ended_at is not null then
    raise exception using errcode = '55000', message = 'active recurrence cannot have ended_at';
  end if;
  if exists (select 1 from public.assistant_recurrence_occurrences
             where recurrence_object_id = old.object_id and sequence > 0)
     and (new.basis,new.frequency,new.interval_count,new.anchor_kind,new.anchor_at,new.anchor_date,new.timezone,new.weekdays)
       is distinct from
         (old.basis,old.frequency,old.interval_count,old.anchor_kind,old.anchor_at,old.anchor_date,old.timezone,old.weekdays) then
    raise exception using errcode = '55000', message = 'recorded history prevents a rule change';
  end if;
  if (new.basis,new.anchor_kind,new.anchor_at,new.anchor_date)
       is distinct from (old.basis,old.anchor_kind,old.anchor_at,old.anchor_date) then
    raise exception using errcode = '55000', message = 'seed anchor and recurrence basis are immutable';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_recurrences_guard before insert or update on public.assistant_recurrences
for each row execute function public.assistant_guard_recurrence();

create function public.assistant_protect_recurrence_registry()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.object_type = 'recurrence' and new.object_type <> 'recurrence' and exists
    (select 1 from public.assistant_recurrences where object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change registered recurrence type';
  end if;
  if old.object_type is distinct from new.object_type and exists
    (select 1 from public.assistant_recurrences where seed_object_id = old.id)
    or old.object_type is distinct from new.object_type and exists
    (select 1 from public.assistant_recurrence_occurrences where generated_object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change recurrence member type';
  end if;
  return new;
end;
$$;
create trigger assistant_objects_protect_recurrence_type before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_recurrence_registry();

-- Calendar positions are calculated from the original anchor, never by repeatedly
-- advancing a previously clamped month or a DST-adjusted instant.
create function public.assistant_recurrence_position(p_object_id uuid, p_sequence bigint)
returns table(occurrence_at timestamptz, occurrence_date date)
language plpgsql stable security invoker set search_path = public as $$
declare r public.assistant_recurrences%rowtype; v_anchor timestamp; v_local timestamp;
        v_after integer; v_days smallint[]; v_slot bigint; v_week bigint;
begin
  select * into r from public.assistant_recurrences where object_id = p_object_id;
  if not found or r.basis <> 'calendar' or p_sequence is null or p_sequence < 0 or p_sequence > 100000000 then
    raise exception using errcode = '22023', message = 'invalid calendar occurrence sequence';
  end if;
  if r.status <> 'active' then
    raise exception using errcode = '55000', message = 'recurrence is ended';
  end if;
  v_anchor := case when r.anchor_kind = 'instant' then r.anchor_at at time zone r.timezone
                   else r.anchor_date::timestamp end;
  if r.frequency = 'weekly' and r.weekdays is not null and p_sequence > 0 then
    select array_agg(d.day order by d.day) into v_days from unnest(r.weekdays) as d(day);
    select count(*) into v_after from unnest(v_days) as d(day)
      where d.day > extract(isodow from v_anchor)::integer;
    if p_sequence <= v_after then
      v_local := date_trunc('week', v_anchor) + (v_days[cardinality(v_days)-v_after+p_sequence::integer] - 1) * interval '1 day'
                 + (v_anchor - date_trunc('day', v_anchor));
    else
      v_slot := p_sequence - v_after - 1;
      v_week := (v_slot / cardinality(v_days) + 1) * r.interval_count;
      v_local := date_trunc('week', v_anchor) + v_week * interval '1 week'
                 + (v_days[(v_slot % cardinality(v_days))::integer + 1] - 1) * interval '1 day'
                 + (v_anchor - date_trunc('day', v_anchor));
    end if;
  elsif r.frequency = 'daily' then
    v_local := v_anchor + (p_sequence * r.interval_count) * interval '1 day';
  elsif r.frequency = 'weekly' then
    v_local := v_anchor + (p_sequence * r.interval_count) * interval '1 week';
  elsif r.frequency = 'monthly' then
    v_local := v_anchor + make_interval(months => (p_sequence * r.interval_count)::integer);
  else
    v_local := v_anchor + make_interval(years => (p_sequence * r.interval_count)::integer);
  end if;
  occurrence_at := case when r.anchor_kind = 'instant' then v_local at time zone r.timezone else null end;
  occurrence_date := case when r.anchor_kind = 'date' then v_local::date else null end;
  return next;
end;
$$;

create function public.assistant_guard_recurrence_occurrence()
returns trigger language plpgsql security invoker set search_path = public as $$
declare r public.assistant_recurrences%rowtype; v_type text; v_seed_type text; v_position record;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'recurrence occurrence history is immutable';
  end if;
  select * into r from public.assistant_recurrences where object_id = new.recurrence_object_id for update;
  if not found or r.status <> 'active' then
    raise exception using errcode = '55000', message = 'recurrence is ended or missing';
  end if;
  select object_type into v_type from public.assistant_objects where id = new.generated_object_id for update;
  select object_type into v_seed_type from public.assistant_objects where id = r.seed_object_id for update;
  if v_type is null or v_type <> v_seed_type then
    raise exception using errcode = '22023', message = 'generated object type must match seed';
  end if;
  if (new.sequence = 0) <> (new.generated_object_id = r.seed_object_id) then
    raise exception using errcode = '22023', message = 'seed must be sequence zero';
  end if;
  if r.basis = 'calendar' then
    select * into v_position from public.assistant_recurrence_position(r.object_id, new.sequence);
    if new.occurrence_at is distinct from v_position.occurrence_at or new.occurrence_date is distinct from v_position.occurrence_date then
      raise exception using errcode = '22023', message = 'calendar occurrence does not match rule';
    end if;
  elsif new.occurrence_at is null then
    raise exception using errcode = '22023', message = 'completion-relative occurrence must be an instant';
  end if;
  if new.sequence > 0 and not exists
      (select 1 from public.assistant_recurrence_occurrences where recurrence_object_id = r.object_id and sequence = new.sequence-1) then
    raise exception using errcode = '22023', message = 'previous occurrence must be recorded';
  end if;
  return new;
end;
$$;
create trigger assistant_recurrence_occurrences_guard before insert or update or delete
on public.assistant_recurrence_occurrences for each row execute function public.assistant_guard_recurrence_occurrence();

create function public.assistant_create_recurrence(
  p_seed_object_id uuid, p_basis text, p_frequency text, p_interval_count integer,
  p_anchor_kind text, p_anchor_at timestamptz, p_anchor_date date, p_timezone text,
  p_weekdays smallint[], p_seed_occurrence_at timestamptz, p_seed_occurrence_date date
)
returns setof public.assistant_recurrences
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if p_basis = 'calendar' and
     (p_seed_occurrence_at is distinct from p_anchor_at or p_seed_occurrence_date is distinct from p_anchor_date)
     or p_basis = 'after_completion' and (p_seed_occurrence_at is null or p_seed_occurrence_date is not null) then
    raise exception using errcode = '22023', message = 'seed occurrence must match recurrence anchor';
  end if;
  insert into public.assistant_objects(object_type) values ('recurrence') returning id into v_id;
  insert into public.assistant_recurrences(object_id,seed_object_id,basis,frequency,interval_count,anchor_kind,anchor_at,anchor_date,timezone,weekdays)
  values(v_id,p_seed_object_id,p_basis,p_frequency,p_interval_count,p_anchor_kind,p_anchor_at,p_anchor_date,p_timezone,p_weekdays);
  insert into public.assistant_recurrence_occurrences(recurrence_object_id,sequence,occurrence_at,occurrence_date,generated_object_id)
  values(v_id,0,p_seed_occurrence_at,p_seed_occurrence_date,p_seed_object_id);
  return query select * from public.assistant_recurrences where object_id = v_id;
end;
$$;

create function public.assistant_update_recurrence(p_object_id uuid, p_patch jsonb)
returns setof public.assistant_recurrences
language plpgsql security invoker set search_path = public as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb or exists
    (select 1 from jsonb_object_keys(p_patch) as fields(key)
     where key not in ('frequency','interval_count','timezone','weekdays')) then
    raise exception using errcode = '22023', message = 'unsupported recurrence patch fields';
  end if;
  return query update public.assistant_recurrences
    set frequency = case when p_patch ? 'frequency' then p_patch->>'frequency' else frequency end,
        interval_count = case when p_patch ? 'interval_count' then (p_patch->>'interval_count')::integer else interval_count end,
        timezone = case when p_patch ? 'timezone' then p_patch->>'timezone' else timezone end,
        weekdays = case when p_patch ? 'weekdays' then array(select jsonb_array_elements_text(p_patch->'weekdays')::smallint) else weekdays end
    where object_id = p_object_id and status = 'active' returning *;
  if not found then
    if exists (select 1 from public.assistant_recurrences where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'recurrence is ended';
    end if;
    raise exception using errcode = 'P0002', message = 'recurrence not found';
  end if;
end;
$$;

create function public.assistant_end_recurrence(p_object_id uuid)
returns setof public.assistant_recurrences
language plpgsql security invoker set search_path = public as $$
begin
  return query update public.assistant_recurrences set status='ended', ended_at=now()
    where object_id=p_object_id and status='active' returning *;
  if not found then
    if exists (select 1 from public.assistant_recurrences where object_id=p_object_id) then
      raise exception using errcode='55000', message='recurrence is ended';
    end if;
    raise exception using errcode='P0002', message='recurrence not found';
  end if;
end;
$$;

create function public.assistant_list_recurrences(p_status text default null, p_seed_object_id uuid default null,
  p_basis text default null, p_limit integer default 50, p_offset integer default 0)
returns setof public.assistant_recurrences
language sql stable security invoker set search_path = public as $$
  select r.* from public.assistant_recurrences r where
    (p_status is null or r.status=p_status) and (p_seed_object_id is null or r.seed_object_id=p_seed_object_id)
    and (p_basis is null or r.basis=p_basis)
  order by r.created_at desc, r.object_id asc
  limit least(greatest(p_limit,0),101) offset greatest(p_offset,0);
$$;

-- Explicit inclusive lower and upper bounds, with no implicit conversion of
-- all-day dates to instants. Ordering is registry ID, then series sequence.
create function public.assistant_list_due_recurrence_occurrences(
  p_from_at timestamptz, p_through_at timestamptz, p_from_date date, p_through_date date,
  p_limit integer default 50, p_offset integer default 0
)
returns table(recurrence_object_id uuid, seed_object_id uuid, sequence bigint, occurrence_at timestamptz, occurrence_date date)
language plpgsql stable security invoker set search_path = public as $$
declare r public.assistant_recurrences%rowtype; pos record; n bigint; v_seen integer := 0;
        v_lower date; v_upper date; v_anchor date; v_units integer; v_step integer;
begin
  if (p_from_at is null) <> (p_through_at is null) or (p_from_date is null) <> (p_through_date is null)
     or (p_from_at is null and p_from_date is null)
     or (p_from_at is not null and p_from_at > p_through_at)
     or (p_from_date is not null and p_from_date > p_through_date)
     or p_limit not between 1 and 101 or p_offset not between 0 and 10000 then
    raise exception using errcode='22023', message='invalid recurrence horizon or pagination';
  end if;
  for r in select * from public.assistant_recurrences
           where status='active' and basis='calendar'
             and ((anchor_kind='instant' and p_from_at is not null) or (anchor_kind='date' and p_from_date is not null))
           order by object_id loop
    v_lower := case when r.anchor_kind='instant' then (p_from_at at time zone r.timezone)::date else p_from_date end;
    v_upper := case when r.anchor_kind='instant' then (p_through_at at time zone r.timezone)::date else p_through_date end;
    v_anchor := case when r.anchor_kind='instant' then (r.anchor_at at time zone r.timezone)::date else r.anchor_date end;
    if v_upper < v_anchor then continue; end if;
    v_units := case r.frequency when 'daily' then v_lower-v_anchor
              when 'weekly' then (v_lower-v_anchor)/7
              when 'monthly' then (extract(year from v_lower)-extract(year from v_anchor))::integer*12
                                + extract(month from v_lower)::integer-extract(month from v_anchor)::integer
              else extract(year from v_lower)::integer-extract(year from v_anchor)::integer end;
    v_step := case when r.frequency='weekly' and r.weekdays is not null then cardinality(r.weekdays) else 1 end;
    n := greatest(1, ((greatest(v_units,0)::bigint / r.interval_count)-2)*v_step);
    for i in 1..10000 loop
      select * into pos from public.assistant_recurrence_position(r.object_id,n);
      if (r.anchor_kind='instant' and pos.occurrence_at > p_through_at)
        or (r.anchor_kind='date' and pos.occurrence_date > p_through_date) then exit; end if;
      if ((r.anchor_kind='instant' and pos.occurrence_at >= p_from_at)
          or (r.anchor_kind='date' and pos.occurrence_date >= p_from_date))
        and not exists (select 1 from public.assistant_recurrence_occurrences o
                        where o.recurrence_object_id=r.object_id and o.sequence=n) then
        if v_seen >= p_offset then
          recurrence_object_id := r.object_id; seed_object_id := r.seed_object_id; sequence := n;
          occurrence_at := pos.occurrence_at; occurrence_date := pos.occurrence_date;
          return next;
        end if;
        v_seen := v_seen + 1;
        if v_seen >= p_offset + p_limit then return; end if;
      end if;
      n := n+1;
      if i=10000 then raise exception using errcode='22023', message='recurrence horizon is too broad'; end if;
    end loop;
  end loop;
end;
$$;

create function public.assistant_next_after_completion(p_object_id uuid, p_completed_object_id uuid, p_completed_at timestamptz)
returns table(recurrence_object_id uuid, seed_object_id uuid, sequence bigint, occurrence_at timestamptz, occurrence_date date)
language plpgsql stable security invoker set search_path = public as $$
declare r public.assistant_recurrences%rowtype; previous public.assistant_recurrence_occurrences%rowtype;
        v_local timestamp;
begin
  select * into r from public.assistant_recurrences where object_id=p_object_id;
  if not found then raise exception using errcode='P0002', message='recurrence not found'; end if;
  if r.status <> 'active' then raise exception using errcode='55000', message='recurrence is ended'; end if;
  if r.basis <> 'after_completion' or p_completed_at is null then
    raise exception using errcode='22023', message='completion requires a Task series and completion instant';
  end if;
  select * into previous from public.assistant_recurrence_occurrences o
    where o.recurrence_object_id=p_object_id and o.generated_object_id=p_completed_object_id;
  if not found then raise exception using errcode='22023', message='completed object is not in recurrence series'; end if;
  if previous.sequence <> (select max(o.sequence) from public.assistant_recurrence_occurrences o where o.recurrence_object_id=p_object_id) then
    return; -- A repeated call for a predecessor already followed by a recorded occurrence.
  end if;
  v_local := p_completed_at at time zone r.timezone;
  v_local := case r.frequency when 'daily' then v_local + r.interval_count*interval '1 day'
    when 'weekly' then v_local + r.interval_count*interval '1 week'
    when 'monthly' then v_local + make_interval(months => r.interval_count)
    else v_local + make_interval(years => r.interval_count) end;
  recurrence_object_id:=r.object_id; seed_object_id:=r.seed_object_id;
  sequence:=previous.sequence+1; occurrence_at:=v_local at time zone r.timezone; occurrence_date:=null;
  return next;
end;
$$;

create function public.assistant_record_recurrence_occurrence(
  p_object_id uuid, p_sequence bigint, p_occurrence_at timestamptz, p_occurrence_date date,
  p_generated_object_id uuid, p_completed_object_id uuid default null, p_completed_at timestamptz default null
)
returns setof public.assistant_recurrence_occurrences
language plpgsql security invoker set search_path = public as $$
declare r public.assistant_recurrences%rowtype; existing public.assistant_recurrence_occurrences%rowtype; expected record;
begin
  select * into r from public.assistant_recurrences where object_id=p_object_id for update;
  if not found then raise exception using errcode='P0002', message='recurrence not found'; end if;
  if r.status <> 'active' then raise exception using errcode='55000', message='recurrence is ended'; end if;
  if p_sequence is null or p_sequence < 1 or p_generated_object_id is null then
    raise exception using errcode='22023', message='invalid recurrence occurrence';
  end if;
  select * into existing from public.assistant_recurrence_occurrences where recurrence_object_id=p_object_id and sequence=p_sequence;
  if found then
    if existing.generated_object_id=p_generated_object_id and existing.occurrence_at is not distinct from p_occurrence_at
       and existing.occurrence_date is not distinct from p_occurrence_date then
      return query select * from public.assistant_recurrence_occurrences where recurrence_object_id=p_object_id and sequence=p_sequence;
      return;
    end if;
    raise exception using errcode='23505', message='recurrence occurrence already belongs to another object';
  end if;
  if r.basis='calendar' then
    if p_completed_object_id is not null or p_completed_at is not null then
      raise exception using errcode='22023', message='calendar recording cannot use completion fields';
    end if;
    select * into expected from public.assistant_recurrence_position(p_object_id,p_sequence);
  else
    if p_completed_object_id is null or p_completed_at is null then
      raise exception using errcode='22023', message='completion predecessor and instant required';
    end if;
    select * into expected from public.assistant_next_after_completion(p_object_id,p_completed_object_id,p_completed_at);
    if not found or expected.sequence <> p_sequence then
      raise exception using errcode='22023', message='completion predecessor is not the latest recorded occurrence';
    end if;
  end if;
  if p_occurrence_at is distinct from expected.occurrence_at or p_occurrence_date is distinct from expected.occurrence_date then
    raise exception using errcode='22023', message='occurrence position does not match calculated rule';
  end if;
  return query insert into public.assistant_recurrence_occurrences
    (recurrence_object_id,sequence,occurrence_at,occurrence_date,generated_object_id)
    values(p_object_id,p_sequence,p_occurrence_at,p_occurrence_date,p_generated_object_id) returning *;
end;
$$;

alter table public.assistant_recurrences enable row level security;
alter table public.assistant_recurrence_occurrences enable row level security;
revoke all on public.assistant_recurrences, public.assistant_recurrence_occurrences from public, anon, authenticated;
grant select, insert, update on public.assistant_recurrences to service_role;
grant select, insert on public.assistant_recurrence_occurrences to service_role;

revoke all on function public.assistant_validate_recurrence() from public, anon, authenticated;
revoke all on function public.assistant_guard_recurrence() from public, anon, authenticated;
revoke all on function public.assistant_protect_recurrence_registry() from public, anon, authenticated;
revoke all on function public.assistant_guard_recurrence_occurrence() from public, anon, authenticated;
revoke all on function public.assistant_recurrence_position(uuid,bigint) from public, anon, authenticated;
revoke all on function public.assistant_create_recurrence(uuid,text,text,integer,text,timestamptz,date,text,smallint[],timestamptz,date) from public, anon, authenticated;
revoke all on function public.assistant_update_recurrence(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.assistant_end_recurrence(uuid) from public, anon, authenticated;
revoke all on function public.assistant_list_recurrences(text,uuid,text,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_list_due_recurrence_occurrences(timestamptz,timestamptz,date,date,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_next_after_completion(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.assistant_record_recurrence_occurrence(uuid,bigint,timestamptz,date,uuid,uuid,timestamptz) from public, anon, authenticated;

grant execute on function public.assistant_recurrence_position(uuid,bigint) to service_role;
grant execute on function public.assistant_create_recurrence(uuid,text,text,integer,text,timestamptz,date,text,smallint[],timestamptz,date) to service_role;
grant execute on function public.assistant_update_recurrence(uuid,jsonb) to service_role;
grant execute on function public.assistant_end_recurrence(uuid) to service_role;
grant execute on function public.assistant_list_recurrences(text,uuid,text,integer,integer) to service_role;
grant execute on function public.assistant_list_due_recurrence_occurrences(timestamptz,timestamptz,date,date,integer,integer) to service_role;
grant execute on function public.assistant_next_after_completion(uuid,uuid,timestamptz) to service_role;
grant execute on function public.assistant_record_recurrence_occurrence(uuid,bigint,timestamptz,date,uuid,uuid,timestamptz) to service_role;
