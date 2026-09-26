-- Assistant.AI Object Registry + Tasks V0.
-- Object types are validated as non-empty, lowercase identifiers rather than by
-- an enum so adding a future module does not require changing this migration.

create table public.assistant_objects (
  id uuid primary key default gen_random_uuid(),
  object_type text not null,
  created_at timestamptz not null default now(),
  constraint assistant_objects_object_type_format
    check (object_type ~ '^[a-z][a-z0-9_]*$')
);

create table public.assistant_tasks (
  object_id uuid primary key
    references public.assistant_objects(id) on delete cascade,
  title text not null,
  description text null,
  status text not null default 'open',
  priority text null,
  not_before timestamptz null,
  due_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_tasks_title_not_blank check (btrim(title) <> ''),
  constraint assistant_tasks_status_valid
    check (status in ('open', 'completed', 'cancelled')),
  constraint assistant_tasks_priority_valid
    check (priority is null or priority in ('low', 'normal', 'high')),
  constraint assistant_tasks_time_window_valid
    check (not_before is null or due_at is null or not_before <= due_at),
  constraint assistant_tasks_completed_state_valid check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint assistant_tasks_cancelled_state_valid check (
    (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status <> 'cancelled' and cancelled_at is null)
  )
);

create index assistant_tasks_status_due_created_idx
  on public.assistant_tasks (status, due_at, created_at, object_id);
create index assistant_tasks_priority_created_idx
  on public.assistant_tasks (priority, created_at, object_id)
  where priority is not null;

create function public.assistant_validate_task_object()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.assistant_objects
    where id = new.object_id and object_type = 'task'
  ) then
    raise exception using
      errcode = '23514',
      message = 'assistant task must reference an object of type task';
  end if;
  return new;
end;
$$;

create trigger assistant_tasks_validate_object
before insert or update of object_id on public.assistant_tasks
for each row execute function public.assistant_validate_task_object();

create function public.assistant_protect_task_object_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.object_type = 'task' and new.object_type <> 'task'
     and exists (select 1 from public.assistant_tasks where object_id = old.id) then
    raise exception using
      errcode = '23514',
      message = 'cannot change the type of a registered task';
  end if;
  return new;
end;
$$;

create trigger assistant_objects_protect_task_type
before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_task_object_type();

create function public.assistant_create_task(
  p_title text,
  p_description text default null,
  p_priority text default null,
  p_not_before timestamptz default null,
  p_due_at timestamptz default null
)
returns setof public.assistant_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object_id uuid;
begin
  insert into public.assistant_objects (object_type)
  values ('task')
  returning id into v_object_id;

  return query
  insert into public.assistant_tasks (
    object_id, title, description, priority, not_before, due_at
  ) values (
    v_object_id, p_title, p_description, p_priority, p_not_before, p_due_at
  )
  returning *;
end;
$$;

create function public.assistant_update_task(
  p_object_id uuid,
  p_patch jsonb
)
returns setof public.assistant_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.assistant_tasks where object_id = p_object_id) then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_patch ?| array['object_id', 'status', 'completed_at', 'cancelled_at', 'created_at', 'updated_at']
     or exists (
       select 1 from jsonb_object_keys(p_patch) as fields(key)
       where key not in ('title', 'description', 'priority', 'not_before', 'due_at')
     ) then
    raise exception using errcode = '22023', message = 'patch contains unsupported task fields';
  end if;

  return query
  update public.assistant_tasks
  set title = case when p_patch ? 'title' then p_patch->>'title' else title end,
      description = case when p_patch ? 'description' then p_patch->>'description' else description end,
      priority = case when p_patch ? 'priority' then p_patch->>'priority' else priority end,
      not_before = case when p_patch ? 'not_before'
        then nullif(p_patch->>'not_before', '')::timestamptz else not_before end,
      due_at = case when p_patch ? 'due_at'
        then nullif(p_patch->>'due_at', '')::timestamptz else due_at end,
      updated_at = now()
  where object_id = p_object_id
  returning *;
end;
$$;

create function public.assistant_complete_task(p_object_id uuid)
returns setof public.assistant_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.assistant_tasks
  set status = 'completed', completed_at = now(), updated_at = now()
  where object_id = p_object_id and status = 'open'
  returning *;

  if not found then
    if exists (select 1 from public.assistant_tasks where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'task is already terminal';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
end;
$$;

create function public.assistant_cancel_task(p_object_id uuid)
returns setof public.assistant_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.assistant_tasks
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where object_id = p_object_id and status = 'open'
  returning *;

  if not found then
    if exists (select 1 from public.assistant_tasks where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'task is already terminal';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
end;
$$;

create function public.assistant_search_tasks(
  p_query text,
  p_status text default null,
  p_priority text default null,
  p_priority_is_null boolean default false,
  p_due_from timestamptz default null,
  p_due_to timestamptz default null,
  p_actionable_at timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.assistant_tasks
language sql
stable
security definer
set search_path = public
as $$
  select task.*
  from public.assistant_tasks task
  where (task.title ilike '%' || p_query || '%'
         or coalesce(task.description, '') ilike '%' || p_query || '%')
    and (p_status is null or task.status = p_status)
    and (not p_priority_is_null or task.priority is null)
    and (p_priority_is_null or p_priority is null or task.priority = p_priority)
    and (p_due_from is null or task.due_at >= p_due_from)
    and (p_due_to is null or task.due_at <= p_due_to)
    and (p_actionable_at is null or task.not_before is null or task.not_before <= p_actionable_at)
  order by task.due_at asc nulls last, task.created_at asc, task.object_id asc
  limit p_limit offset p_offset;
$$;

alter table public.assistant_objects enable row level security;
alter table public.assistant_tasks enable row level security;

revoke all on public.assistant_objects, public.assistant_tasks from anon, authenticated;
revoke all on function public.assistant_create_task(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.assistant_update_task(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_complete_task(uuid) from public, anon, authenticated;
revoke all on function public.assistant_cancel_task(uuid) from public, anon, authenticated;
revoke all on function public.assistant_search_tasks(text, text, text, boolean, timestamptz, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on public.assistant_objects, public.assistant_tasks to service_role;
grant execute on function public.assistant_create_task(text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.assistant_update_task(uuid, jsonb) to service_role;
grant execute on function public.assistant_complete_task(uuid) to service_role;
grant execute on function public.assistant_cancel_task(uuid) to service_role;
grant execute on function public.assistant_search_tasks(text, text, text, boolean, timestamptz, timestamptz, timestamptz, integer, integer) to service_role;
