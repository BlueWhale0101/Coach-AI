# Projection V0

## Hidden design decision

Projection owns **how independently modeled Assistant.AI objects are assembled for consumption by a specific read surface**.

Projection owns no durable household state and performs no mutations. It is a read composition boundary: writes continue to go through the module that owns the changed state.

## V0 scope

V0 implements one narrowly scoped household-board read:

- upcoming task cards for the ambient tablet board;
- Today and Tomorrow schedule events;
- only the metadata needed to render that board.

It is not a generic query API, dashboard state store, cache, GraphQL layer, rule engine, recommendation engine, or second domain model.

## Household board task surfacing policy

The household board asks: "What stuff should we be thinking about?"

V0 surfaces open Tasks when any of these are true:

1. the task is explicitly pinned by Attention;
2. the task has a meaningful `due_at` before the projection's `now`;
3. the task has a meaningful `due_at` within the next seven local calendar days;
4. the task is currently actionable because `not_before` is null or no later than `now`.

The projection does not invent due dates. A missing `due_at` remains missing and the UI renders no deadline label.

Ordering is deterministic:

1. pinned tasks;
2. overdue tasks;
3. due-soon tasks;
4. currently actionable tasks;
5. `due_at ASC NULLS LAST`;
6. `pinned_at DESC NULLS LAST`;
7. task `created_at ASC`;
8. `object_id ASC`.

Pinned means "keep this on the household board even if normal surfacing logic would not." It is not Task priority.

## Calendar semantics

The projection accepts an explicit display timezone. Today and Tomorrow are calculated as local dates in that timezone. Timed event windows are the complete two-day local interval converted to instants; all-day event windows use Scheduling's half-open date intervals. Empty time is not returned because the client renders time spatially.

## Phone Today read

`assistant_get_phone_today` reuses the household board's bounded task selection and composes four Darwin-local days through the existing day helper. The phone selects attention-worthy tasks and displays today's schedule plus a few upcoming entries. This read creates no task deadlines or durable phone state. The RPC is `SECURITY INVOKER`, executable by `service_role` only, and reached from the browser through the Site's specific `/api/phone-today` allowlist entry.

## Mutation boundary

Projection has no mutation endpoint. The tablet board completes Tasks through the Tasks capability and pins/unpins objects through Attention capabilities.

## Tablet hosting boundary

The hosted tablet board must not expose Supabase service-role credentials or `ACTION_API_SECRET` in browser JavaScript. The OpenAI Site therefore serves same-origin `/api/*` routes from its hosted runtime and those routes call Assistant Edge Functions with server-side runtime variables:

- `ASSISTANT_SUPABASE_FUNCTIONS_URL`
- `ASSISTANT_ACTION_API_SECRET`

If either value is absent, the Site fails closed with a configuration error rather than falling back to fixture data or exposing secrets to the browser. Fixture data remains available only through `?fixtures=1` for local/demo use.

## Staged Undo

The tablet board may stage fast reversible interactions locally before issuing the durable module command. For completion, the UI removes the task immediately, shows an Undo strip, and waits about five seconds. If Undo is pressed, no database command is sent. If the window expires, the UI calls Tasks `complete-task`. If the write fails, the UI restores the task and reports that the change was not saved.

In-app navigation keeps the staged mutation pending. A second mutation flushes the first to the owning capability and leaves Undo available for the second. Closing the page during the staging window still discards the local timer; durable offline delivery is outside V0.
