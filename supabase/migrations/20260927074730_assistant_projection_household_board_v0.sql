-- Assistant.AI Projection V0: read-only household board composition.
-- Projection owns no durable state and exposes one board-oriented read RPC.

create or replace function public.assistant_get_household_board(
  p_display_date date default null,
  p_timezone text default 'Australia/Darwin',
  p_now timestamptz default now(),
  p_task_limit integer default 15
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date;
  v_tomorrow date;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_near_due_end timestamptz;
  v_limit integer;
  v_now timestamptz;
begin
  if p_timezone is null or btrim(p_timezone) = ''
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid projection timezone';
  end if;

  v_now := coalesce(p_now, now());
  v_today := coalesce(p_display_date, (v_now at time zone p_timezone)::date);
  v_tomorrow := v_today + 1;
  v_window_start := v_today::timestamp at time zone p_timezone;
  v_window_end := (v_today + 2)::timestamp at time zone p_timezone;
  v_near_due_end := (v_today + 7)::timestamp at time zone p_timezone;
  v_limit := least(greatest(coalesce(p_task_limit, 15), 1), 50);

  return jsonb_build_object(
    'metadata', jsonb_build_object(
      'generated_at', now(),
      'now', v_now,
      'timezone', p_timezone,
      'today', v_today,
      'tomorrow', v_tomorrow,
      'task_limit', v_limit,
      'task_policy', 'projection_v0_pinned_overdue_due_soon_actionable'
    ),
    'tasks', coalesce((
      with task_rows as (
        select
          task.*,
          pin.pinned_at,
          cat.object_id as category_object_id,
          cat.name as category_name,
          cat.color as category_color,
          cat.status as category_status,
          case
            when pin.target_object_id is not null then 0
            when task.due_at is not null and task.due_at < v_now then 1
            when task.due_at is not null and task.due_at < v_near_due_end then 2
            else 3
          end as surface_bucket,
          case
            when pin.target_object_id is not null then 'pinned'
            when task.due_at is not null and task.due_at < v_now then 'overdue'
            when task.due_at is not null and task.due_at < v_near_due_end then 'due_soon'
            else 'actionable'
          end as surface_reason
        from public.assistant_tasks task
        left join public.assistant_pins pin on pin.target_object_id = task.object_id
        left join public.assistant_object_categories oc on oc.target_object_id = task.object_id
        left join public.assistant_categories cat on cat.object_id = oc.category_object_id
        where task.status = 'open'
          and (
            pin.target_object_id is not null
            or (task.due_at is not null and task.due_at < v_near_due_end)
            or task.not_before is null
            or task.not_before <= v_now
          )
        order by
          surface_bucket asc,
          task.due_at asc nulls last,
          pin.pinned_at desc nulls last,
          task.created_at asc,
          task.object_id asc
        limit v_limit
      )
      select jsonb_agg(
        jsonb_build_object(
          'object_id', task_rows.object_id,
          'title', task_rows.title,
          'description', task_rows.description,
          'status', task_rows.status,
          'priority', task_rows.priority,
          'not_before', task_rows.not_before,
          'due_at', task_rows.due_at,
          'created_at', task_rows.created_at,
          'updated_at', task_rows.updated_at,
          'pinned', task_rows.pinned_at is not null,
          'pinned_at', task_rows.pinned_at,
          'surface_reason', task_rows.surface_reason,
          'category', case when task_rows.category_object_id is null then null else jsonb_build_object(
            'object_id', task_rows.category_object_id,
            'name', task_rows.category_name,
            'color', task_rows.category_color,
            'status', task_rows.category_status
          ) end,
          'tags', coalesce((
            select jsonb_agg(jsonb_build_object(
              'object_id', tag.object_id,
              'name', tag.name,
              'status', tag.status
            ) order by lower(tag.name), tag.object_id)
            from public.assistant_object_tags ot
            join public.assistant_tags tag on tag.object_id = ot.tag_object_id
            where ot.target_object_id = task_rows.object_id
          ), '[]'::jsonb)
        )
        order by task_rows.surface_bucket asc, task_rows.due_at asc nulls last,
                 task_rows.pinned_at desc nulls last, task_rows.created_at asc,
                 task_rows.object_id asc
      )
      from task_rows
    ), '[]'::jsonb),
    'days', jsonb_build_array(
      public.assistant_household_board_day(v_today, 'today', p_timezone),
      public.assistant_household_board_day(v_tomorrow, 'tomorrow', p_timezone)
    )
  );
end;
$$;

create or replace function public.assistant_household_board_day(
  p_date date,
  p_id text,
  p_timezone text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_id,
    'date', p_date,
    'all_day_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'object_id', event.object_id,
        'title', event.title,
        'description', event.description,
        'time_kind', event.time_kind,
        'start_date', event.start_date,
        'end_date', event.end_date,
        'status', event.status,
        'category', case when cat.object_id is null then null else jsonb_build_object(
          'object_id', cat.object_id,
          'name', cat.name,
          'color', cat.color,
          'status', cat.status
        ) end,
        'pinned', pin.target_object_id is not null,
        'pinned_at', pin.pinned_at
      ) order by event.start_date asc, event.created_at asc, event.object_id asc)
      from public.assistant_schedule_events event
      left join public.assistant_object_categories oc on oc.target_object_id = event.object_id
      left join public.assistant_categories cat on cat.object_id = oc.category_object_id
      left join public.assistant_pins pin on pin.target_object_id = event.object_id
      where event.status = 'scheduled'
        and event.time_kind = 'all_day'
        and event.start_date < p_date + 1
        and event.end_date > p_date
    ), '[]'::jsonb),
    'timed_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'object_id', event.object_id,
        'title', event.title,
        'description', event.description,
        'time_kind', event.time_kind,
        'starts_at', event.starts_at,
        'ends_at', event.ends_at,
        'timezone', event.timezone,
        'display_timezone', p_timezone,
        'start_time', to_char(event.starts_at at time zone p_timezone, 'HH24:MI'),
        'end_time', to_char(event.ends_at at time zone p_timezone, 'HH24:MI'),
        'status', event.status,
        'category', case when cat.object_id is null then null else jsonb_build_object(
          'object_id', cat.object_id,
          'name', cat.name,
          'color', cat.color,
          'status', cat.status
        ) end,
        'pinned', pin.target_object_id is not null,
        'pinned_at', pin.pinned_at
      ) order by event.starts_at asc, event.created_at asc, event.object_id asc)
      from public.assistant_schedule_events event
      left join public.assistant_object_categories oc on oc.target_object_id = event.object_id
      left join public.assistant_categories cat on cat.object_id = oc.category_object_id
      left join public.assistant_pins pin on pin.target_object_id = event.object_id
      where event.status = 'scheduled'
        and event.time_kind = 'timed'
        and event.starts_at < ((p_date + 1)::timestamp at time zone p_timezone)
        and event.ends_at > (p_date::timestamp at time zone p_timezone)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.assistant_get_household_board(date,text,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.assistant_household_board_day(date,text,text) from public, anon, authenticated;

grant execute on function public.assistant_get_household_board(date,text,timestamptz,integer) to service_role;
grant execute on function public.assistant_household_board_day(date,text,text) to service_role;
