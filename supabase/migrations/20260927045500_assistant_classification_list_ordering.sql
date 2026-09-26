-- Assistant.AI Classification list ordering capability RPCs.
-- Forward-only migration because 20260926112231 was already applied to preview.

create or replace function public.assistant_list_categories(p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns setof public.assistant_categories
language sql stable security invoker set search_path = public as $$
  select c.* from public.assistant_categories c
  where p_status is null or c.status = p_status
  order by c.sort_order asc, lower(c.name) asc, c.object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.assistant_list_tags(p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns setof public.assistant_tags
language sql stable security invoker set search_path = public as $$
  select t.* from public.assistant_tags t
  where p_status is null or t.status = p_status
  order by lower(t.name) asc, t.object_id asc
  limit least(greatest(p_limit, 0), 101) offset greatest(p_offset, 0);
$$;

revoke all on function public.assistant_list_categories(text,integer,integer) from public, anon, authenticated;
revoke all on function public.assistant_list_tags(text,integer,integer) from public, anon, authenticated;

grant execute on function public.assistant_list_categories(text,integer,integer) to service_role;
grant execute on function public.assistant_list_tags(text,integer,integer) to service_role;
