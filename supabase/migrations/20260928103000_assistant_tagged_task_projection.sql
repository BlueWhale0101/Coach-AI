-- Read task lists by Classification tag before applying a bounded page.
create function public.assistant_list_tagged_tasks(
  p_tag_object_id uuid,
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
declare v_rows jsonb;
begin
  if p_tag_object_id is null or p_limit is null or p_limit < 1 or p_limit > 100 or
     p_offset is null or p_offset < 0 or
     (p_status is not null and p_status not in ('open', 'completed', 'cancelled')) then
    raise exception using errcode = '22023', message = 'invalid tagged task filters';
  end if;

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
          'category', case when cat.object_id is null then null else jsonb_build_object(
            'object_id', cat.object_id, 'name', cat.name, 'color', cat.color, 'status', cat.status
          ) end,
          'tags', coalesce(tags.items, '[]'::jsonb)
        ), 'pinned', pin.target_object_id is not null
      ) as row_data
    from public.assistant_tasks task
    join public.assistant_object_tags member on member.target_object_id = task.object_id
      and member.tag_object_id = p_tag_object_id
    join public.assistant_tags selected_tag on selected_tag.object_id = member.tag_object_id
      and selected_tag.status = 'active'
    left join public.assistant_object_categories oc on oc.target_object_id = task.object_id
    left join public.assistant_categories cat on cat.object_id = oc.category_object_id
    left join public.assistant_pins pin on pin.target_object_id = task.object_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('object_id', tag.object_id, 'name', tag.name, 'status', tag.status)
        order by lower(tag.name), tag.object_id) as items
      from public.assistant_object_tags ot
      join public.assistant_tags tag on tag.object_id = ot.tag_object_id
      where ot.target_object_id = task.object_id
    ) tags on true
    where (p_category_object_id is null or cat.object_id = p_category_object_id)
      and (p_status is null or task.status = p_status)
      and (p_query is null or task.title ilike '%' || p_query || '%' or
        coalesce(task.description, '') ilike '%' || p_query || '%')
    order by task.due_at asc nulls last, task.created_at asc, task.object_id asc
    limit p_limit offset p_offset
  ) filtered;
  return v_rows;
end;
$$;

revoke all on function public.assistant_list_tagged_tasks(uuid,uuid,text,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.assistant_list_tagged_tasks(uuid,uuid,text,text,integer,integer) to service_role;
