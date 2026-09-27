create or replace function public.assistant_replace_object_tags(p_target_object_id uuid, p_tag_object_ids uuid[] default '{}'::uuid[])
returns table(target_object_id uuid, category jsonb, tags jsonb)
language plpgsql security invoker set search_path = public as $$
declare
  v_requested uuid[] := coalesce(p_tag_object_ids, '{}'::uuid[]);
  v_distinct uuid[];
  v_missing uuid[];
begin
  if not exists (select 1 from public.assistant_objects where id = p_target_object_id for update) then
    raise exception using errcode = '23503', message = 'classification target not found';
  end if;

  if exists (select 1 from unnest(v_requested) as requested(tag_object_id) where requested.tag_object_id is null) then
    raise exception using errcode = '22023', message = 'tag ids must not contain null';
  end if;

  select coalesce(array_agg(distinct requested.tag_object_id order by requested.tag_object_id), '{}'::uuid[])
    into v_distinct
    from unnest(v_requested) as requested(tag_object_id);

  perform 1 from public.assistant_tags t
    where t.object_id = any(v_distinct)
    for update;

  select coalesce(array_agg(missing.tag_object_id order by missing.tag_object_id), '{}'::uuid[])
    into v_missing
    from (
      select unnest(v_distinct) as tag_object_id
      except
      select t.object_id
        from public.assistant_tags t
        where t.object_id = any(v_distinct) and t.status = 'active'
    ) missing;

  if cardinality(v_missing) > 0 then
    raise exception using errcode = 'P0002', message = 'active tag not found';
  end if;

  delete from public.assistant_object_tags ot
    where ot.target_object_id = p_target_object_id
      and not (ot.tag_object_id = any(v_distinct));

  insert into public.assistant_object_tags(target_object_id, tag_object_id)
    select p_target_object_id, requested.tag_object_id
      from unnest(v_distinct) as requested(tag_object_id)
    on conflict do nothing;

  return query select * from public.assistant_get_object_classification(p_target_object_id);
end;
$$;

revoke all on function public.assistant_replace_object_tags(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.assistant_replace_object_tags(uuid,uuid[]) to service_role;
