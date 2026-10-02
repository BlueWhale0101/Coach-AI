# Coach.AI private plugin

The chat remains the coach; Supabase remains canonical. This adds a Coach skill
and an independent localhost MCP server wrapping the six existing Actions.
It changes no database schema, Edge Function, admin UI or Assistant service.

## Tools and source contracts

The server derives nested event schemas, enums and bounds from root
`actions.yaml` (JSON-formatted OpenAPI), using the installed Zod/SDK versions.
It forwards validated payloads to the existing functions, preserving raw text,
arbitrary nested facts/estimates and complete response data including IDs and
pagination. It exposes no SQL, generic proxy, or Assistant tools.

`get_logs` and `search_events` are read-only. Daily summaries and some trends
regenerate/upsert derived summaries, so their MCP annotations are not read-only.
`add_log_entry` is not idempotent. The client never retries; ambiguous writes
return an unknown outcome so the coach can retrieve records before retrying.
Errors omit backend details and internal exceptions.

## VPS deployment

Use an isolated checkout at `/opt/coach-ai` on the existing VPS. Do not alter
the Assistant checkout, port 8787, its systemd units, existing tunnel, WireGuard,
firewall or public network listeners. Coach binds only `127.0.0.1:8788`.
Use Node 20+ and verify `/usr/bin/node` matches the installed binary before
installing the supplied systemd unit.

After this change is merged:

```bash
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin coach-ai
git clone https://github.com/BlueWhale0101/Coach-AI.git /opt/coach-ai
cd /opt/coach-ai
npm ci --omit=dev --ignore-scripts
sudo install -o root -g coach-ai -m 640 /dev/null /etc/coach-ai-mcp.env
sudoedit /etc/coach-ai-mcp.env
```

The service unit runs under the dedicated non-login `coach-ai` account. Keep
the checkout root-owned and readable by that account; it has no writable host
state. `/etc/coach-ai-mcp.env` is readable only by `root` and the `coach-ai`
group, so the process can read its action secret without gaining access to
Assistant.AI's secrets or other host configuration.

Enter these server-side variables using the existing Coach Action secret;
never send that secret in chat or add it to plugin files:

```text
COACH_MCP_FUNCTIONS_URL=https://zjgklcigytxvjexiizdn.supabase.co/functions/v1
COACH_ACTION_API_SECRET=<existing Coach ACTION_API_SECRET>
COACH_MCP_PORT=8788
```

Optional `COACH_MCP_BEARER_TOKEN` protects the local MCP endpoint. Configure
it only if the chosen tunnel connector can supply it. The private tunnel is
the remote access boundary. Browser-origin requests are rejected.

```bash
sudo install -m 644 coach/deploy/coach-ai-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coach-ai-mcp.service
curl --fail http://127.0.0.1:8788/health
ss -lntp
```

Provision a **separate OpenAI Secure MCP Tunnel** pointing to
`http://127.0.0.1:8788/mcp` through the host's supported tunnel flow; run its
client under a separate systemd service with a distinct local client port.
Keep the Assistant tunnel and services untouched. No public MCP URL is needed.
This repository does not invent a tunnel ID or unsupported tunnel CLI flags.

In ChatGPT use Plugins → + → Create App → Tunnel, select the new Coach tunnel,
and verify discovery of all six tools. Test `get_logs` for a known day and
`get_day_summary` with `generate_if_missing: false` before trying a user log.
Do not write a fake fitness record to production as an authentication test.

## Skill package and final binding

Run `node scripts/build-coach-plugin.mjs` to generate references from the
canonical Coach instructions and data semantics. Package `coach/plugin/coach-ai`
as one directory and save it with Plugin Creator.

The initial package intentionally contains coaching skills only: no unverified
MCP URL, placeholder URL or app ID. It can coach but cannot store data until
the private Coach app is connected. After live discovery succeeds, bind the
verified app ID through `.app.json` and `extensions.com.openai.apps`, or the
host's supported plugin dependency UI, and update the **same plugin**.
Do not bind Assistant's tunnel as if it exposed Coach tools.

Plugin creation is not live server deployment. Host permission prompts and
voice tool availability must be checked in the installed plugin; they are not
guaranteed by MCP annotations.

## Verification and rollback

Run `node --test tests/coach-mcp.test.mjs` and `npm test`. The focused tests use
an in-memory backend and real MCP clients, not production writes.
Validate tool discovery, nested schemas, raw wording, corrections, pagination,
derived-write annotations, timeouts, secret filtering and HTTP access checks.

To roll back, stop/disable only the new Coach MCP/tunnel services and disconnect
the Coach app. The existing Custom GPT and Assistant plugin remain usable.
