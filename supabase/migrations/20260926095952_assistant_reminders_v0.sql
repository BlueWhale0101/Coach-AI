-- Assistant.AI Reminders V0. Forward-only; existing module schemas stay intact.
create table public.assistant_reminders (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  target_object_id uuid not null references public.assistant_objects(id) on delete restrict,
  remind_at timestamptz not null,
  status text not null default 'pending',
  delivered_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_reminders_no_self_target check (object_id <> target_object_id),
  constraint assistant_reminders_status_valid check (status in ('pending', 'delivered', 'cancelled')),
  constraint assistant_reminders_delivery_consistent
    check ((status = 'delivered') = (delivered_at is not null)),
  constraint assistant_reminders_cancellation_consistent
    check ((status = 'cancelled') = (cancelled_at is not null))
);

create index assistant_reminders_status_time_idx
  on public.assistant_reminders (status, remind_at, created_at, object_id);
create index assistant_reminders_target_time_idx
  on public.assistant_reminders (target_object_id, remind_at, created_at, object_id);

create function public.assistant_validate_reminder_objects()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_target_type text;
begin
  -- Lock both registry rows. Concurrent retyping/deletion must serialize with
  -- creation or a target change, including when they run in separate sessions.
  if not exists (select 1 from public.assistant_objects
                 where id = new.object_id and object_type = 'reminder' for update) then
    raise exception using errcode = '23514', message = 'reminder identity must have type reminder';
  end if;
  if new.object_id = new.target_object_id then
    raise exception using errcode = '22023', message = 'reminder cannot target itself';
  end if;
  select object_type into v_target_type
  from public.assistant_objects where id = new.target_object_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'reminder target not found';
  end if;
  if v_target_type = 'reminder' then
    raise exception using errcode = '22023', message = 'reminder cannot target a reminder';
  end if;
  return new;
end;
$$;
create trigger assistant_reminders_validate_objects
before insert or update of object_id, target_object_id on public.assistant_reminders
for each row execute function public.assistant_validate_reminder_objects();

create function public.assistant_protect_reminder_object_types()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.object_type = 'reminder' and new.object_type <> 'reminder'
     and exists (select 1 from public.assistant_reminders where object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change registered reminder type';
  end if;
  if old.object_type <> 'reminder' and new.object_type = 'reminder'
     and exists (select 1 from public.assistant_reminders where target_object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot turn a reminder target into a reminder';
  end if;
  return new;
end;
$$;
create trigger assistant_objects_protect_reminder_types
before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_reminder_object_types();

create function public.assistant_guard_reminder_lifecycle()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.delivered_at is not null or new.cancelled_at is not null then
      raise exception using errcode = '55000', message = 'new reminder must be pending';
    end if;
    return new;
  end if;
  if new.object_id is distinct from old.object_id
     or new.target_object_id is distinct from old.target_object_id then
    raise exception using errcode = '23514', message = 'reminder identity and target are immutable';
  end if;
  if old.status <> 'pending' then
    raise exception using errcode = '55000', message = 'reminder is terminal';
  end if;
  if new.remind_at is distinct from old.remind_at and new.status <> 'pending' then
    raise exception using errcode = '55000', message = 'remind_at may change only while pending';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_reminders_guard_lifecycle
before insert or update on public.assistant_reminders
for each row execute function public.assistant_guard_reminder_lifecycle();

-- A single RPC call is one PostgreSQL transaction. A failed reminder insert
-- rolls back its preceding registry insert.
create function public.assistant_create_reminder(p_target_object_id uuid, p_remind_at timestamptz)
returns setof public.assistant_reminders
language plpgsql security invoker set search_path = public as $$
declare v_object_id uuid;
begin
  insert into public.assistant_objects (object_type)
  values ('reminder') returning id into v_object_id;
  return query
  insert into public.assistant_reminders (object_id, target_object_id, remind_at)
  values (v_object_id, p_target_object_id, p_remind_at) returning *;
end;
$$;

create function public.assistant_update_reminder_time(p_object_id uuid, p_remind_at timestamptz)
returns setof public.assistant_reminders
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.assistant_reminders set remind_at = p_remind_at
  where object_id = p_object_id and status = 'pending'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_reminders where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'reminder is terminal';
    end if;
    raise exception using errcode = 'P0002', message = 'reminder not found';
  end if;
end;
$$;

create function public.assistant_cancel_reminder(p_object_id uuid)
returns setof public.assistant_reminders
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.assistant_reminders
  set status = 'cancelled', cancelled_at = now()
  where object_id = p_object_id and status = 'pending'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_reminders where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'reminder is terminal';
    end if;
    raise exception using errcode = 'P0002', message = 'reminder not found';
  end if;
end;
$$;

create function public.assistant_mark_reminder_delivered(p_object_id uuid)
returns setof public.assistant_reminders
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.assistant_reminders
  set status = 'delivered', delivered_at = now()
  where object_id = p_object_id and status = 'pending'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_reminders where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'reminder is terminal';
    end if;
    raise exception using errcode = 'P0002', message = 'reminder not found';
  end if;
end;
$$;

alter table public.assistant_reminders enable row level security;
revoke all on public.assistant_reminders from public, anon, authenticated;
grant select, insert, update on public.assistant_reminders to service_role;

revoke all on function public.assistant_validate_reminder_objects() from public, anon, authenticated;
revoke all on function public.assistant_protect_reminder_object_types() from public, anon, authenticated;
revoke all on function public.assistant_guard_reminder_lifecycle() from public, anon, authenticated;
revoke all on function public.assistant_create_reminder(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.assistant_update_reminder_time(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.assistant_cancel_reminder(uuid) from public, anon, authenticated;
revoke all on function public.assistant_mark_reminder_delivered(uuid) from public, anon, authenticated;
grant execute on function public.assistant_create_reminder(uuid, timestamptz) to service_role;
grant execute on function public.assistant_update_reminder_time(uuid, timestamptz) to service_role;
grant execute on function public.assistant_cancel_reminder(uuid) to service_role;
grant execute on function public.assistant_mark_reminder_delivered(uuid) to service_role;
