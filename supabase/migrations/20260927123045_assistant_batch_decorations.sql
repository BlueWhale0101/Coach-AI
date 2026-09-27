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

revoke all on function public.assistant_get_object_decorations(uuid[]) from public, anon, authenticated;
