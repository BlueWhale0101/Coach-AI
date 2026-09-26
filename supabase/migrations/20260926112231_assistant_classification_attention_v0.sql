-- Assistant.AI Classification + Attention V0.
-- Forward-only migration; existing module schemas stay intact.

create table public.assistant_categories (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  status text not null default 'active',
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_categories_name_not_blank check (btrim(name) <> ''),
  constraint assistant_categories_color_canonical check (color ~ '^#[0-9A-F]{6}$'),
  constraint assistant_categories_status_valid check (status in ('active', 'archived')),
  constraint assistant_categories_archive_consistent check ((status = 'archived') = (archived_at is not null))
);
create unique index assistant_categories_name_ci_unique on public.assistant_categories (lower(name));
create index assistant_categories_list_idx on public.assistant_categories (status, sort_order, lower(name), object_id);

create table public.assistant_tags (
  object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_tags_name_not_blank check (btrim(name) <> ''),
  constraint assistant_tags_status_valid check (status in ('active', 'archived')),
  constraint assistant_tags_archive_consistent check ((status = 'archived') = (archived_at is not null))
);
create unique index assistant_tags_name_ci_unique on public.assistant_tags (lower(name));
create index assistant_tags_list_idx on public.assistant_tags (status, lower(name), object_id);

create table public.assistant_object_categories (
  target_object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  category_object_id uuid not null references public.assistant_categories(object_id) on delete restrict,
  assigned_at timestamptz not null default now()
);
create index assistant_object_categories_category_idx on public.assistant_object_categories (category_object_id, target_object_id);

create table public.assistant_object_tags (
  target_object_id uuid not null references public.assistant_objects(id) on delete cascade,
  tag_object_id uuid not null references public.assistant_tags(object_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (target_object_id, tag_object_id)
);
create index assistant_object_tags_tag_idx on public.assistant_object_tags (tag_object_id, target_object_id);

create table public.assistant_pins (
  target_object_id uuid primary key references public.assistant_objects(id) on delete cascade,
  pinned_at timestamptz not null default now()
);
create index assistant_pins_list_idx on public.assistant_pins (pinned_at desc, target_object_id asc);

create index assistant_recurrences_seed_object_idx on public.assistant_recurrences (seed_object_id);

create function public.assistant_validate_category()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.color := upper(btrim(new.color));
  if not exists (select 1 from public.assistant_objects where id = new.object_id and object_type = 'category' for update) then
    raise exception using errcode = '23514', message = 'category identity must have type category';
  end if;
  return new;
end;
$$;
create trigger assistant_categories_validate
before insert or update of object_id, name, color on public.assistant_categories
for each row execute function public.assistant_validate_category();

create function public.assistant_validate_tag()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.name := btrim(new.name);
  if not exists (select 1 from public.assistant_objects where id = new.object_id and object_type = 'tag' for update) then
    raise exception using errcode = '23514', message = 'tag identity must have type tag';
  end if;
  return new;
end;
$$;
create trigger assistant_tags_validate
before insert or update of object_id, name on public.assistant_tags
for each row execute function public.assistant_validate_tag();

create function public.assistant_guard_category()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.archived_at is not null then
      raise exception using errcode = '55000', message = 'new category must be active';
    end if;
    return new;
  end if;
  if new.object_id is distinct from old.object_id then
    raise exception using errcode = '23514', message = 'category identity is immutable';
  end if;
  if old.status = 'archived' then
    raise exception using errcode = '55000', message = 'category is archived';
  end if;
  if new.status = 'archived' and old.status = 'active' then
    if new.archived_at is null then
      raise exception using errcode = '23514', message = 'archived category requires archived_at';
    end if;
  elsif new.status <> old.status or new.archived_at is distinct from old.archived_at then
    raise exception using errcode = '55000', message = 'invalid category lifecycle transition';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_categories_guard
before insert or update on public.assistant_categories
for each row execute function public.assistant_guard_category();

create function public.assistant_guard_tag()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.archived_at is not null then
      raise exception using errcode = '55000', message = 'new tag must be active';
    end if;
    return new;
  end if;
  if new.object_id is distinct from old.object_id then
    raise exception using errcode = '23514', message = 'tag identity is immutable';
  end if;
  if old.status = 'archived' then
    raise exception using errcode = '55000', message = 'tag is archived';
  end if;
  if new.status = 'archived' and old.status = 'active' then
    if new.archived_at is null then
      raise exception using errcode = '23514', message = 'archived tag requires archived_at';
    end if;
  elsif new.status <> old.status or new.archived_at is distinct from old.archived_at then
    raise exception using errcode = '55000', message = 'invalid tag lifecycle transition';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_tags_guard
before insert or update on public.assistant_tags
for each row execute function public.assistant_guard_tag();

create function public.assistant_protect_classification_registry()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.object_type = 'category' and new.object_type <> 'category'
     and exists (select 1 from public.assistant_categories where object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change registered category type';
  end if;
  if old.object_type = 'tag' and new.object_type <> 'tag'
     and exists (select 1 from public.assistant_tags where object_id = old.id) then
    raise exception using errcode = '23514', message = 'cannot change registered tag type';
  end if;
  return new;
end;
$$;
create trigger assistant_objects_protect_classification_types
before update of object_type on public.assistant_objects
for each row execute function public.assistant_protect_classification_registry();

create function public.assistant_create_category(p_name text, p_color text, p_sort_order integer default 0)
returns setof public.assistant_categories
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into public.assistant_objects(object_type) values ('category') returning id into v_id;
  return query insert into public.assistant_categories(object_id, name, color, sort_order)
    values(v_id, p_name, p_color, coalesce(p_sort_order, 0)) returning *;
end;
$$;

create function public.assistant_update_category(p_object_id uuid, p_patch jsonb)
returns setof public.assistant_categories
language plpgsql security invoker set search_path = public as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb or exists
    (select 1 from jsonb_object_keys(p_patch) as fields(key)
     where key not in ('name', 'color', 'sort_order')) then
    raise exception using errcode = '22023', message = 'unsupported category patch fields';
  end if;
  return query update public.assistant_categories
    set name = case when p_patch ? 'name' then p_patch->>'name' else name end,
        color = case when p_patch ? 'color' then p_patch->>'color' else color end,
        sort_order = case when p_patch ? 'sort_order' then (p_patch->>'sort_order')::integer else sort_order end
    where object_id = p_object_id and status = 'active' returning *;
  if not found then
    if exists (select 1 from public.assistant_categories where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'category is archived';
    end if;
    raise exception using errcode = 'P0002', message = 'category not found';
  end if;
end;
$$;

create function public.assistant_archive_category(p_object_id uuid)
returns setof public.assistant_categories
language plpgsql security invoker set search_path = public as $$
begin
  return query update public.assistant_categories
    set status = 'archived', archived_at = now()
    where object_id = p_object_id and status = 'active' returning *;
  if not found then
    if exists (select 1 from public.assistant_categories where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'category is archived';
    end if;
    raise exception using errcode = 'P0002', message = 'category not found';
  end if;
end;
$$;

create function public.assistant_create_tag(p_name text)
returns setof public.assistant_tags
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into public.assistant_objects(object_type) values ('tag') returning id into v_id;
  return query insert into public.assistant_tags(object_id, name) values(v_id, p_name) returning *;
end;
$$;

create function public.assistant_update_tag(p_object_id uuid, p_patch jsonb)
returns setof public.assistant_tags
language plpgsql security invoker set search_path = public as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb or exists
    (select 1 from jsonb_object_keys(p_patch) as fields(key) where key not in ('name')) then
    raise exception using errcode = '22023', message = 'unsupported tag patch fields';
  end if;
  return query update public.assistant_tags
    set name = p_patch->>'name'
    where object_id = p_object_id and status = 'active' returning *;
  if not found then
    if exists (select 1 from public.assistant_tags where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'tag is archived';
    end if;
    raise exception using errcode = 'P0002', message = 'tag not found';
  end if;
end;
$$;

create function public.assistant_archive_tag(p_object_id uuid)
returns setof public.assistant_tags
language plpgsql security invoker set search_path = public as $$
begin
  return query update public.assistant_tags
    set status = 'archived', archived_at = now()
    where object_id = p_object_id and status = 'active' returning *;
  if not found then
    if exists (select 1 from public.assistant_tags where object_id = p_object_id) then
      raise exception using errcode = '55000', message = 'tag is archived';
    end if;
    raise exception using errcode = 'P0002', message = 'tag not found';
  end if;
end;
$$;

create function public.assistant_set_object_category(p_target_object_id uuid, p_category_object_id uuid)
returns setof public.assistant_object_categories
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;
  if not exists (select 1 from public.assistant_categories where object_id = p_category_object_id and status = 'active' for update) then
    raise exception using errcode = 'P0002', message = 'active category not found';
  end if;
  return query insert into public.assistant_object_categories(target_object_id, category_object_id)
    values(p_target_object_id, p_category_object_id)
    on conflict (target_object_id) do update
      set category_object_id = excluded.category_object_id,
          assigned_at = case
            when public.assistant_object_categories.category_object_id is distinct from excluded.category_object_id then now()
            else public.assistant_object_categories.assigned_at
          end
    returning *;
end;
$$;

create function public.assistant_clear_object_category(p_target_object_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;
  delete from public.assistant_object_categories where target_object_id = p_target_object_id;
end;
$$;

create function public.assistant_add_object_tag(p_target_object_id uuid, p_tag_object_id uuid)
returns setof public.assistant_object_tags
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;
  if not exists (select 1 from public.assistant_tags where object_id = p_tag_object_id and status = 'active' for update) then
    raise exception using errcode = 'P0002', message = 'active tag not found';
  end if;
  insert into public.assistant_object_tags(target_object_id, tag_object_id)
    values(p_target_object_id, p_tag_object_id)
    on conflict do nothing;
  return query select * from public.assistant_object_tags
    where target_object_id = p_target_object_id and tag_object_id = p_tag_object_id;
end;
$$;

create function public.assistant_remove_object_tag(p_target_object_id uuid, p_tag_object_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;
  delete from public.assistant_object_tags
    where target_object_id = p_target_object_id and tag_object_id = p_tag_object_id;
end;
$$;

create function public.assistant_get_object_classification(p_target_object_id uuid)
returns table(target_object_id uuid, category jsonb, tags jsonb)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;
  target_object_id := p_target_object_id;
  select to_jsonb(c.*) into category
    from public.assistant_object_categories oc
    join public.assistant_categories c on c.object_id = oc.category_object_id
    where oc.target_object_id = p_target_object_id;
  select coalesce(jsonb_agg(to_jsonb(t.*) order by lower(t.name), t.object_id), '[]'::jsonb) into tags
    from public.assistant_object_tags ot
    join public.assistant_tags t on t.object_id = ot.tag_object_id
    where ot.target_object_id = p_target_object_id;
  return next;
end;
$$;

create function public.assistant_list_category_members(p_category_object_id uuid, p_limit integer default 50, p_offset integer default 0)
returns table(target_object_id uuid, assigned_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select oc.target_object_id, oc.assigned_at
  from public.assistant_object_categories oc
  where oc.category_object_id = p_category_object_id
  order by oc.target_object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

create function public.assistant_list_tag_members(p_tag_object_id uuid, p_limit integer default 50, p_offset integer default 0)
returns table(target_object_id uuid, assigned_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select ot.target_object_id, ot.assigned_at
  from public.assistant_object_tags ot
  where ot.tag_object_id = p_tag_object_id
  order by ot.target_object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

create function public.assistant_pin_object(p_target_object_id uuid)
returns setof public.assistant_pins
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'pin target not found';
  end if;
  insert into public.assistant_pins(target_object_id) values(p_target_object_id)
    on conflict do nothing;
  return query select * from public.assistant_pins where target_object_id = p_target_object_id;
end;
$$;

create function public.assistant_unpin_object(p_target_object_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.assistant_pins where target_object_id = p_target_object_id;
end;
$$;

create function public.assistant_is_object_pinned(p_target_object_id uuid)
returns table(target_object_id uuid, pinned boolean, pinned_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select p_target_object_id, (p.target_object_id is not null), p.pinned_at
  from (select p_target_object_id as target_object_id) target
  left join public.assistant_pins p on p.target_object_id = target.target_object_id;
$$;

create function public.assistant_list_pinned_objects(p_limit integer default 50, p_offset integer default 0)
returns setof public.assistant_pins
language sql stable security invoker set search_path = public as $$
  select p.* from public.assistant_pins p
  order by p.pinned_at desc, p.target_object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

alter table public.assistant_categories enable row level security;
alter table public.assistant_tags enable row level security;
alter table public.assistant_object_categories enable row level security;
alter table public.assistant_object_tags enable row level security;
alter table public.assistant_pins enable row level security;

revoke all on public.assistant_categories, public.assistant_tags, public.assistant_object_categories, public.assistant_object_tags, public.assistant_pins from public, anon, authenticated;
grant select, insert, update on public.assistant_categories, public.assistant_tags to service_role;
grant select, insert, update, delete on public.assistant_object_categories, public.assistant_object_tags, public.assistant_pins to service_role;

revoke all on function public.assistant_validate_category() from public, anon, authenticated;
revoke all on function public.assistant_validate_tag() from public, anon, authenticated;
revoke all on function public.assistant_guard_category() from public, anon, authenticated;
revoke all on function public.assistant_guard_tag() from public, anon, authenticated;
revoke all on function public.assistant_protect_classification_registry() from public, anon, authenticated;
revoke all on function public.assistant_create_category(text,text,integer) from public, anon, authenticated;
revoke all on function public.assistant_update_category(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.assistant_archive_category(uuid) from public, anon, authenticated;
revoke all on function public.assistant_create_tag(text) from public, anon, authenticated;
revoke all on function public.assistant_update_tag(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.assistant_archive_tag(uuid) from public, anon, authenticated;
revoke all on function public.assistant_set_object_category(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assistant_clear_object_category(uuid) from public, anon, authenticated;
revoke all on function public.assistant_add_object_tag(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assistant_remove_object_tag(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assistant_get_object_classification(uuid) from public, anon, authenticated;
revoke all on function public.assistant_list_category_members(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_list_tag_members(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_pin_object(uuid) from public, anon, authenticated;
revoke all on function public.assistant_unpin_object(uuid) from public, anon, authenticated;
revoke all on function public.assistant_is_object_pinned(uuid) from public, anon, authenticated;
revoke all on function public.assistant_list_pinned_objects(integer,integer) from public, anon, authenticated;

grant execute on function public.assistant_create_category(text,text,integer) to service_role;
grant execute on function public.assistant_update_category(uuid,jsonb) to service_role;
grant execute on function public.assistant_archive_category(uuid) to service_role;
grant execute on function public.assistant_create_tag(text) to service_role;
grant execute on function public.assistant_update_tag(uuid,jsonb) to service_role;
grant execute on function public.assistant_archive_tag(uuid) to service_role;
grant execute on function public.assistant_set_object_category(uuid,uuid) to service_role;
grant execute on function public.assistant_clear_object_category(uuid) to service_role;
grant execute on function public.assistant_add_object_tag(uuid,uuid) to service_role;
grant execute on function public.assistant_remove_object_tag(uuid,uuid) to service_role;
grant execute on function public.assistant_get_object_classification(uuid) to service_role;
grant execute on function public.assistant_list_category_members(uuid,integer,integer) to service_role;
grant execute on function public.assistant_list_tag_members(uuid,integer,integer) to service_role;
grant execute on function public.assistant_pin_object(uuid) to service_role;
grant execute on function public.assistant_unpin_object(uuid) to service_role;
grant execute on function public.assistant_is_object_pinned(uuid) to service_role;
grant execute on function public.assistant_list_pinned_objects(integer,integer) to service_role;
