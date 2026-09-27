# MCP / Plugin Conversational Surface V0

## Hidden design decision

MCP owns **how Assistant.AI capabilities are presented safely and intelligibly to an AI agent**.

It is an adapter over existing semantic module interfaces. It owns no household state, performs no private table manipulation, and does not define task, scheduling, recurrence, classification, attention, projection, or knowledge semantics.

## Boundary

The MCP server exposes a small conversational vocabulary rather than mechanically exposing every Edge Function. It calls Assistant module capabilities through the same action-secret Edge Function boundary used by other server-side Assistant clients.

It must not expose:
- arbitrary SQL;
- arbitrary Edge Function proxying;
- Object Registry creation;
- private recurrence bookkeeping operations;
- generic arbitrary object mutation;
- Coach.AI tools, tables, or contracts.

The model performs natural-language interpretation. The MCP adapter validates tool shape, resolves existing category/tag names where that is part of the conversational surface, and forwards explicit semantic operations to owning modules.

## V0 tool vocabulary

| Tool | Read/write | Owner capability |
| --- | --- | --- |
| `find_tasks` | read | Tasks `list-tasks` / `search-tasks` |
| `get_task` | read | Tasks `get-task` |
| `create_task` | write | Tasks `create-task` |
| `update_task` | write | Tasks `update-task` |
| `complete_task` | terminal write | Tasks `complete-task` |
| `cancel_task` | terminal write | Tasks `cancel-task` |
| `find_knowledge` | read | Knowledge `list-knowledge` / `search-knowledge` |
| `get_knowledge` | read | Knowledge `get-knowledge` |
| `remember` | write | Knowledge `create-knowledge` |
| `update_knowledge` | write | Knowledge `update-knowledge` |
| `archive_knowledge` | terminal write | Knowledge `archive-knowledge` |
| `find_events` | read | Scheduling `list-schedule-events` / `search-schedule-events` |
| `get_event` | read | Scheduling `get-schedule-event` |
| `create_event` | write | Scheduling `create-schedule-event` |
| `update_event` | write | Scheduling `update-schedule-event` |
| `cancel_event` | terminal write | Scheduling `cancel-schedule-event` |
| `set_reminder` | write | Reminders `create-reminder` |
| `set_recurrence` | write | Recurrence `create-recurrence` |
| `update_recurrence` | write | Recurrence `update-recurrence` |
| `end_recurrence` | terminal write | Recurrence `end-recurrence` |
| `set_category` | write | Classification list/clear/set category capabilities |
| `set_tags` | write | Classification list tags / replace object tags capabilities |
| `pin` | write | Attention `pin-object` |
| `unpin` | write | Attention `unpin-object` |
| `get_household_board` | read | Projection `get-household-board` |

Read-only tools are annotated with `readOnlyHint: true`. Write tools are not. Terminal or difficult-to-reverse V0 tools are annotated with `destructiveHint: true`: `complete_task`, `cancel_task`, `archive_knowledge`, `cancel_event`, and `end_recurrence`.

## Object resolution

Existing-object writes require stable Assistant `object_id` values. The model should use read/search tools to resolve identity first. If more than one plausible object remains, it asks the user to choose rather than guessing.

Write tools intentionally do not accept vague text references such as "the electrician thing" and silently perform hidden fuzzy matching.

## Semantic rules for the model

Tasks are actionable commitments that can become done. `due_at` is a real deadline: when failure becomes late. It is not a surfacing time or reminder time.

Knowledge is durable reference information. The conversational tool is named `remember` to keep that distinct from Tasks.

Events occupy calendar time. Timed events use absolute start/end instants plus display timezone. All-day events use Scheduling's date interval with exclusive `end_date`.

Reminders target an existing Assistant object. Setting a reminder does not change Task `due_at` unless the user separately states a real deadline.

Recurrence is a friendly adapter over Recurrence V0. It accepts only rule shapes representable by Recurrence V0 and delegates rule validation and calendar arithmetic to Recurrence. It does not expose occurrence listing, completion-relative next calculation, or ledger recording as conversational tools.

Categories and Tags are existing registry objects. `set_category` resolves an active category by case-insensitive name or clears with `null`; it never creates a category. `set_tags` resolves every requested active tag name first. If any requested tag is unknown, no tag assignment changes are applied. After successful name resolution, MCP calls Classification's atomic replacement capability instead of sequencing individual add/remove operations.

Pins keep objects prominent on the household board. Pinning is not Task priority.

## Security model

The MCP server is a server-side adapter. It may hold:
- its own MCP request authentication configuration;
- `ASSISTANT_SUPABASE_FUNCTIONS_URL` or `ASSISTANT_MCP_FUNCTIONS_URL`;
- `ASSISTANT_ACTION_API_SECRET`.

The browser must never receive the service-role key or action secret. The MCP server does not hold a Supabase service-role key; existing Edge Functions remain responsible for service-role access, RLS posture, and module validation.

For local/developer-mode testing, the included HTTP server can require `ASSISTANT_MCP_BEARER_TOKEN`. Published ChatGPT plugin deployment still requires the current OpenAI MCP authentication flow, normally OAuth 2.1 protected-resource metadata in front of the MCP endpoint. The repository does not introduce a new identity provider or external hosting provider in V0.

## OpenAI plugin packaging

The portable plugin package lives in `assistant/plugin/assistant-ai`:
- `plugin.json` declares package identity and OpenAI presentation metadata;
- `mcp.json` declares a streamable HTTP MCP server entry with a placeholder URL to be replaced after a secure MCP host is reviewed;
- `skills/assistant-ai/SKILL.md` contains concise model guidance for semantic use of the tools.

The MCP server uses the official `@modelcontextprotocol/sdk` `McpServer` with the Streamable HTTP transport. OpenAI's current documentation expects production MCP servers to be reachable at stable HTTPS streamable HTTP endpoints, typically `/mcp`, and tools that access private data or actions to be protected by the MCP authorization flow. Developer-mode testing can use a public HTTPS endpoint or Secure MCP Tunnel. If no approved OpenAI-hosted or reviewed MCP host/auth surface is available, deployment stops at this boundary.

The 15 checked conversation cases in this repository are golden behavioral specifications: they assert the intended tool sequence for representative utterances. They do not execute a model. Actual model-selection evaluation remains blocked until the MCP server can be connected to ChatGPT developer mode.

## Deliberate exclusions

V0 does not implement Coach migration, Capture, Gmail, Google Calendar, provenance, phone UI, new tablet views, notification daemons, workers, queues, event buses, custom NLP, workflow engines, embeddings, generic SQL, generic Edge Function proxying, category/tag auto-creation, or a new recurrence engine.
