# Assistant.AI post-V1 roadmap and user feedback

This note is the working roadmap after the first end-to-end Assistant.AI deployment. It is intentionally driven by observed use rather than speculative feature expansion.

## Roadmap

### 1. Testing and stabilization

Run Assistant.AI in normal household use for at least a week before declaring V1.0 final.

During this period:

- Capture concrete failures, friction, surprising behavior, and repeated manual work in the User feedback section below.
- Fix issues demonstrated by real use.
- Avoid speculative features or architectural redesign unless testing exposes a real need.
- Preserve the current module boundaries and bounded-staleness execution model.
- Treat MCP/plugin registration and deployment behavior as part of the system that needs testing, not merely application code.

After stabilization settles, tag the resulting production state as `v1.0.0`.

### 2. Optimization pass

Optimize the measured V1 rather than redesigning it.

Review:

- Projection and API call patterns.
- Supabase queries and indexes.
- Site load and five-minute refresh behavior.
- MCP latency and agent-facing tool ergonomics.
- Reconciliation cost, reliability, and idempotence.
- Security configuration and Supabase advisor findings.
- Dead code and redundant paths.
- Test coverage and high-value regression tests.

Prefer small, evidence-based changes. Preserve the existing information-hiding/module boundaries unless measurements show a concrete reason to change them.

### 3. Coach.AI integration

Keep Coach.AI as a specialized bounded module rather than folding fitness semantics into Assistant.AI.

Planned sequence:

1. Inventory Coach.AI's current durable state, interfaces, reports, and legacy machinery.
2. Define the Coach module boundary and the agent-facing capabilities that actually need to be exposed.
3. Convert Coach.AI's conversational interface to a plugin.
4. Add Coach tabs/views to the existing Assistant.AI Site for browsing durable Coach data.
5. Add reports, trends, and plots to the Site.
6. Remove legacy Coach machinery that becomes redundant rather than permanently wrapping duplicate paths.

Target interaction pattern:

`ChatGPT for semantic interaction -> Coach.AI plugin -> Supabase durable state -> Site for browsing and visualization`

## User feedback

Add observations here during the stabilization period. Record what happened in normal use before deciding on a solution.

### 2026-09-30 — Scriptable task widget surfaces less-immediate tasks

**Observed behavior**

The Scriptable Tasks/Today widgets are being used frequently as a glanceable "what should I care about next?" surface. They sometimes surface Goodbye Jerrick BBQ tasks from later in the week instead of nearer tasks.

**Current behavior**

The widget does very little ranking itself: Tasks displays the first four tasks returned by the widget snapshot and Today displays the first two.

The underlying household-board projection orders open tasks by:

1. pinned;
2. overdue;
3. due within seven days;
4. otherwise actionable.

Within those groups it primarily uses `due_at`, then creation order. The widget compaction then retains pinned, overdue, due-today, and `actionable` tasks. A task with neither `not_before` nor `due_at` is therefore considered actionable immediately and can occupy scarce widget slots even when it is conceptually for later in the week.

**Immediate workaround**

For tasks that should not become actionable until a future day, set a meaningful `not_before` date. Do not invent a due date merely to control surfacing.

**Potential stabilization change**

Revisit widget/projection ranking based on observed use. A candidate ordering is:

`pinned -> overdue -> due today -> newly actionable / nearest relevant work -> due soon -> other actionable`

Future `not_before` tasks should remain hidden until they become actionable.

Do not implement the candidate policy solely from this note; validate it against additional real usage during the stabilization period.

**Update**

The widget adapter's redundant filtering was removed so it now preserves the Projection layer's task ordering. Meaningful `not_before` values remain the mechanism for keeping future work out of the actionable pool. Continue evaluating the resulting behavior during stabilization.

### 2026-09-30 — Tablet calendar should follow the useful part of the day

**Observed behavior**

The tablet board refreshes its data periodically, but the calendar viewport does not reposition as the day advances. By afternoon, the ambient board can remain centered on an earlier part of the day rather than the hours that are now useful.

**Desired behavior**

During the existing periodic refresh, update the calendar's scroll/visible position as well as its data. A simple first policy is sufficient: after noon, shift the calendar down so the afternoon and evening are visible.

This is an ambient-display behavior, not a scheduling/data-model change. Avoid adding a separate timer or orchestration mechanism if the existing five-minute refresh can own it cleanly.

### 2026-09-30 — Phone Site latency discourages use

**Observed behavior**

The Scriptable widget and Assistant.AI chat are proving highly useful, but the phone Site feels slow enough that the user is avoiding it.

**Impact**

Treat this as a stabilization usability issue, not merely optional optimization. The phone interface's role is quick browsing and lightweight task management; if opening or navigating it feels materially slower than the widget/chat path, it is failing that role even when functionally correct.

**Investigation target**

Measure before redesigning. Profile the phone path end to end, including initial document/PWA load, projection request latency, category/tag reference-data requests, route changes, rendering, and the five-minute refresh path. Identify whether the dominant delay is network/Edge Function cold start, sequential requests, projection/database work, unnecessary reloads, or client rendering.

Prefer changes that make the existing architecture faster. Do not introduce local shadow state, a second task store, or a new orchestration layer merely to mask latency.
