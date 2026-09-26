-- Assistant.AI Knowledge V0. Forward migration; Tasks and Coach objects are unchanged.
create table public.assistant_knowledge (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  title text not null,
  content text not null,
  status text not null default 'active',
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_knowledge_title_not_blank check (btrim(title) <> ''),
  constraint assistant_knowledge_content_not_blank check (btrim(content) <> ''),
  constraint assistant_knowledge_status_valid check (status in ('active', 'archived')),
  constraint assistant_knowledge_archive_consistent
    check ((status = 'archived') = (archived_at is not null))
);

create index assistant_knowledge_status_created_idx
  on public.assistant_knowledge (status, created_at desc, object_id);

create function public.assistant_validate_knowledge_object()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Lock the registry row so a concurrent type change cannot pass its own
  -- protection trigger before this knowledge insert becomes visible.
  if not exists (select 1 from public.assistant_objects
                 where id = new.object_id and object_type = 'knowledge' for update) then
    raise exception using errcode = '23514',
      message = 'assistant knowledge must reference an object of type knowledge';
  end if;
  return new;
end;
$$;
create trigger assistant_knowledge_validate_object
before insert or update of object_id on public.assistant_knowledge
for each row execute function public.assistant_validate_knowledge_object();

create function public.assistant_protect_knowledge_object_type()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.object_type = 'knowledge' and new.object_type <> 'knowledge'
     and exists (select 1 from public.assistant_knowledge where object_id = old.id) then
    raise exception using errcode = '23514',
      message = 'cannot change the type of a registered knowledge item';
  end if;
  return new;
end;
$$;
create trigger assistant_objects_protect_knowledge_type
before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_knowledge_object_type();

create function public.assistant_touch_knowledge()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.object_id is distinct from old.object_id then
    raise exception using errcode = '23514', message = 'knowledge identity is immutable';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_knowledge_touch
before update on public.assistant_knowledge
for each row execute function public.assistant_touch_knowledge();

-- A single RPC statement runs in one PostgreSQL transaction. A failed second
-- insert rolls back the registry insert even when the error is caught by the API.
create function public.assistant_create_knowledge(p_title text, p_content text)
returns setof public.assistant_knowledge
language plpgsql security invoker set search_path = public as $$
declare v_object_id uuid;
begin
  insert into public.assistant_objects (object_type)
  values ('knowledge') returning id into v_object_id;

  return query
  insert into public.assistant_knowledge (object_id, title, content)
  values (v_object_id, p_title, p_content) returning *;
end;
$$;

create function public.assistant_update_knowledge(p_object_id uuid, p_patch jsonb)
returns setof public.assistant_knowledge
language plpgsql security invoker set search_path = public as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) as fields(key)
                where key not in ('title', 'content')) then
    raise exception using errcode = '22023',
      message = 'patch contains unsupported knowledge fields';
  end if;
  return query
  update public.assistant_knowledge
  set title = case when p_patch ? 'title' then p_patch->>'title' else title end,
      content = case when p_patch ? 'content' then p_patch->>'content' else content end
  where object_id = p_object_id and status = 'active'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_knowledge where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'knowledge item is archived';
    end if;
    raise exception using errcode = 'P0002', message = 'knowledge item not found';
  end if;
end;
$$;

create function public.assistant_archive_knowledge(p_object_id uuid)
returns setof public.assistant_knowledge
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update public.assistant_knowledge
  set status = 'archived', archived_at = now()
  where object_id = p_object_id and status = 'active'
  returning *;
  if not found then
    if exists (select 1 from public.assistant_knowledge where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'knowledge item is already archived';
    end if;
    raise exception using errcode = 'P0002', message = 'knowledge item not found';
  end if;
end;
$$;

create function public.assistant_search_knowledge(
  p_query text, p_status text default null, p_limit integer default 50, p_offset integer default 0
)
returns setof public.assistant_knowledge
language sql stable security invoker set search_path = public as $$
  select item.* from public.assistant_knowledge item
  where (position(lower(p_query) in lower(item.title)) > 0
         or position(lower(p_query) in lower(item.content)) > 0)
    and (p_status is null or item.status = p_status)
  order by item.created_at desc, item.object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

alter table public.assistant_knowledge enable row level security;
revoke all on public.assistant_knowledge from public, anon, authenticated;
grant select, insert, update on public.assistant_knowledge to service_role;

revoke all on function public.assistant_validate_knowledge_object() from public, anon, authenticated;
revoke all on function public.assistant_protect_knowledge_object_type() from public, anon, authenticated;
revoke all on function public.assistant_touch_knowledge() from public, anon, authenticated;
revoke all on function public.assistant_create_knowledge(text, text) from public, anon, authenticated;
revoke all on function public.assistant_update_knowledge(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_archive_knowledge(uuid) from public, anon, authenticated;
revoke all on function public.assistant_search_knowledge(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.assistant_create_knowledge(text, text) to service_role;
grant execute on function public.assistant_update_knowledge(uuid, jsonb) to service_role;
grant execute on function public.assistant_archive_knowledge(uuid) to service_role;
grant execute on function public.assistant_search_knowledge(text, text, integer, integer) to service_role;
