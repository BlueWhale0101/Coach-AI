-- Reconcile production hardening applied after Tasks V0 was first deployed.
-- The original Tasks migration had already run before the RPC security mode was
-- changed in source. Keep this forward migration so a fresh database and the
-- production migration history describe the same transition.

alter function public.assistant_create_task(text, text, text, timestamptz, timestamptz)
  security invoker;
alter function public.assistant_update_task(uuid, jsonb)
  security invoker;
alter function public.assistant_complete_task(uuid)
  security invoker;
alter function public.assistant_cancel_task(uuid)
  security invoker;
alter function public.assistant_search_tasks(text, text, text, boolean, timestamptz, timestamptz, timestamptz, integer, integer)
  security invoker;
