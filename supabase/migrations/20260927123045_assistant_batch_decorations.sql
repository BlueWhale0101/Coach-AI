-- Read-only, bounded decoration projection for full task, knowledge, and calendar lists.
create function public.assistant_get_object_decorations(p_object_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(source.object_id, jsonb_build_object(
    'classification', case when cat.object_id is null and tags.items is null then null
      else jsonb_build_object(
        'category', case when cat.object_id is null then null else jsonb_build_object(
          'object_id', cat.object_id, 'name', cat.name, 'color', cat.color, 'status', cat.status
        ) end,
        'tags', coalesce(tags.items, '[]'::jsonb)
      ) end,
    'pinned', pin.target_object_id is not null
  )), '{}'::jsonb)
  from (select distinct unnest(p_object_ids) as object_id) source
  join public.assistant_objects object on object.id = source.object_id
  left join public.assistant_object_categories oc on oc.target_object_id = source.object_id
  left join public.assistant_categories cat on cat.object_id = oc.category_object_id
  left join public.assistant_pins pin on pin.target_object_id = source.object_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('object_id', tag.object_id, 'name', tag.name, 'status', tag.status)
      order by lower(tag.name), tag.object_id) as items
    from public.assistant_object_tags ot
    join public.assistant_tags tag on tag.object_id = ot.tag_object_id
    where ot.target_object_id = source.object_id
  ) tags on true
  where cardinality(p_object_ids) <= 100;
$$;

revoke all on function public.assistant_get_object_decorations(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.assistant_get_object_decorations(uuid[]) to service_role;

-- Category filtered tablet reads apply the Classification join before paging.
create function public.assistant_list_category_view(
  p_object_type text,
  p_category_object_id uuid,
  p_status text,
  p_query text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_object_type = 'task' then
    select coalesce(jsonb_agg(row_data order by due_at asc nulls last, created_at asc, object_id asc), '[]'::jsonb)
      into v_rows
    from (
      select task.due_at, task.created_at, task.object_id,
        jsonb_build_object(
          'object_id', task.object_id, 'title', task.title, 'description', task.description,
          'status', task.status, 'priority', task.priority, 'due_at', task.due_at,
          'not_before', task.not_before, 'created_at', task.created_at,
          'completed_at', task.completed_at, 'cancelled_at', task.cancelled_at,
          'classification', jsonb_build_object(
            'category', jsonb_build_object('object_id', cat.object_id, 'name', cat.name, 'color', cat.color, 'status', cat.status),
            'tags', coalesce(tags.items, '[]'::jsonb)
          ), 'pinned', pin.target_object_id is not null
        ) as row_data
      from public.assistant_tasks task
      join public.assistant_object_categories oc on oc.target_object_id = task.object_id
      join public.assistant_categories cat on cat.object_id = oc.category_object_id
      left join public.assistant_pins pin on pin.target_object_id = task.object_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('object_id', tag.object_id, 'name', tag.name, 'status', tag.status)
          order by lower(tag.name), tag.object_id) as items
        from public.assistant_object_tags ot
        join public.assistant_tags tag on tag.object_id = ot.tag_object_id
        where ot.target_object_id = task.object_id
      ) tags on true
      where cat.object_id = p_category_object_id
        and (p_status is null or task.status = p_status)
        and (p_query is null or task.title ilike '%' || p_query || '%' or coalesce(task.description, '') ilike '%' || p_query || '%')
      order by task.due_at asc nulls last, task.created_at asc, task.object_id asc
      limit p_limit offset p_offset
    ) filtered;
  elsif p_object_type = 'knowledge' then
    select coalesce(jsonb_agg(row_data order by created_at desc, object_id asc), '[]'::jsonb)
      into v_rows
    from (
      select item.created_at, item.object_id,
        jsonb_build_object(
          'object_id', item.object_id, 'title', item.title, 'content', item.content,
          'status', item.status, 'created_at', item.created_at, 'updated_at', item.updated_at,
          'archived_at', item.archived_at,
          'classification', jsonb_build_object(
            'category', jsonb_build_object('object_id', cat.object_id, 'name', cat.name, 'color', cat.color, 'status', cat.status),
            'tags', coalesce(tags.items, '[]'::jsonb)
          ), 'pinned', pin.target_object_id is not null
        ) as row_data
      from public.assistant_knowledge item
      join public.assistant_object_categories oc on oc.target_object_id = item.object_id
      join public.assistant_categories cat on cat.object_id = oc.category_object_id
      left join public.assistant_pins pin on pin.target_object_id = item.object_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('object_id', tag.object_id, 'name', tag.name, 'status', tag.status)
          order by lower(tag.name), tag.object_id) as items
        from public.assistant_object_tags ot
        join public.assistant_tags tag on tag.object_id = ot.tag_object_id
        where ot.target_object_id = item.object_id
      ) tags on true
      where cat.object_id = p_category_object_id
        and (p_status is null or item.status = p_status)
        and (p_query is null or position(lower(p_query) in lower(item.title)) > 0 or position(lower(p_query) in lower(item.content)) > 0)
      order by item.created_at desc, item.object_id asc
      limit p_limit offset p_offset
    ) filtered;
  else
    raise exception using errcode = '22023', message = 'invalid category view object type';
  end if;
  return v_rows;
end;
$$;

revoke all on function public.assistant_list_category_view(text,uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.assistant_list_category_view(text,uuid,text,text,integer,integer) to service_role;
