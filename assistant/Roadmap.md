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
- Phone startup performance as a separate concern from data-fetch latency: tap -> first paint -> cached content -> synchronized.
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


### 2026-10-01 — Make cold phone startup feel immediate

**Observed behavior**

The new offline-first/local cache has materially improved the phone experience. Once the PWA is running, locally cached task/calendar data removes most of the network-driven lag and the app feels much faster.

A remaining delay is visible when the PWA has been evicted or suspended by iOS. Roughly two seconds of startup latency in that case is a different problem from data latency: the application itself has to boot before cached state can be useful.

**Startup model**

Treat startup as a separate measured pipeline:

`tap -> iOS/WebKit launch -> application shell load -> JavaScript execution -> local state open -> first useful paint -> synchronization`

Measure at least these intervals independently:

1. tap -> first paint;
2. first paint -> cached useful content;
3. cached content -> synchronized state.

The local-first work has made the third interval largely irrelevant to perceived usability. The next optimization target is the first two.

**Performance target**

First useful pixels should require:

- no network;
- no backend response;
- no synchronization;
- as little JavaScript and initialization work as practical.

When last-known-good data exists, prefer showing stale data immediately over a skeleton. Refresh it quietly afterward.

**Candidate optimizations**

- Render a useful Assistant shell directly in the initial document so first paint does not depend on JavaScript initialization.
- Persist a tiny precomputed snapshot of the last rendered phone view and paint it immediately, then hydrate from the authoritative local cache.
- Keep startup JavaScript small. Lazy-load functionality that is not needed for the first screen, such as search, knowledge browsing, editing UI, and distant-calendar functionality.
- Avoid scanning, filtering, decorating, cleaning, or synchronizing the full local store before first useful paint. Display the already-prepared phone projection first; defer maintenance work.
- Aggressively service-worker-cache the application shell and all assets required for first paint so a cold-ish launch requires zero network.
- Avoid blocking fonts and heavyweight asset dependencies; favor system fonts and small local assets.
- Split phone startup code from unrelated tablet or secondary-view machinery if bundle analysis shows that code is on the critical path.
- Move necessary but non-render-critical work until after first paint using an appropriate deferred/idle mechanism.

**Constraint**

There is an eventual floor imposed by iOS launching the PWA/WebKit process after eviction. Do not treat platform launch time as an application-data problem or introduce architectural complexity merely to hide it.

**Priority**

This is a high-value optimization because the phone UI is intended for quick interaction. A reduction from a noticeable cold-start pause toward an immediate-feeling last-known-good view is likely to improve actual use more than adding several new Assistant features.
