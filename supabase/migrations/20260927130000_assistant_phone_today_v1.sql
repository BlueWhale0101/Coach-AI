-- Phone Today composes existing board tasks with four Darwin-local agenda days.
-- This remains a read-only projection; all writes retain their owning modules.
create function public.assistant_get_phone_today(
  p_display_date date default null,
  p_timezone text default 'Australia/Darwin',
  p_now timestamptz default now(),
  p_task_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_board jsonb;
  v_today date;
begin
  if p_timezone is null or btrim(p_timezone) = ''
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid projection timezone';
  end if;
  if p_task_limit is null or p_task_limit < 1 or p_task_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid projection task limit';
  end if;

  v_board := public.assistant_get_household_board(p_display_date, p_timezone, p_now, p_task_limit);
  v_today := (v_board->'metadata'->>'today')::date;
  return jsonb_build_object(
    'metadata', v_board->'metadata',
    'tasks', v_board->'tasks',
    'days', (v_board->'days') || jsonb_build_array(
      public.assistant_household_board_day(v_today + 2, 'upcoming', p_timezone),
      public.assistant_household_board_day(v_today + 3, 'upcoming', p_timezone)
    )
  );
end;
$$;

revoke all on function public.assistant_get_phone_today(date,text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.assistant_get_phone_today(date,text,timestamptz,integer) to service_role;
