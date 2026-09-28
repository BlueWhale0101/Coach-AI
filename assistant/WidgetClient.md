# Widget Today client API (V0)

This is a read-only projection of the existing Phone Today result for a trusted personal client. It does not create or modify household state.

## Request

`GET /api/client/today` on the Assistant.AI Site, with `Authorization: Bearer <device token>`. No query parameters or request body. The device token is 32 random bytes encoded as 64 hexadecimal characters. Send it only in the header over HTTPS; do not put it in a URL or in the phone page's browser code.

The Site forwards this one request to `get-client-today` with the server-side `ACTION_API_SECRET`. The Edge Function validates that secret, hashes the device token with SHA-256, looks up the digest using its service role, checks the exact `widget:today:read` scope and optional expiration/revocation, and calls `assistant_get_phone_today`. It returns `Cache-Control: no-store`. The device credential cannot invoke any other Site API or Edge Function. No Supabase URL, service-role key, or action secret is returned to the client.

## Response

Success: `{ "ok": true, "data": { "date": "2026-09-28", "timezone": "Australia/Darwin", "generated_at": "<ISO instant>", "tasks": [], "events": [], "url": "/phone/" } }`. At most six tasks and three current/upcoming events are included. Tasks include `object_id`, `title`, nullable `due_at`, `surface_reason`, `pinned`, nullable `category` (`name`, `color`), and `url` (`/phone/tasks`). Events include `object_id`, `title`, local `date`, `all_day`, nullable `category`, `url` (`/phone/calendar`), and `starts_at`/`ends_at` for timed events. IDs allow future object-specific navigation; today's phone UI navigates to the destination, not directly to an expanded object. Neither descriptions nor internal rows are exposed.

Errors return `{ "ok": false, "code": "..." }` with 400 for unsupported query parameters, 401 for missing/invalid/revoked/expired/wrong-scope credentials, 405 for other methods, and 503 for unavailable configuration or reads. The response intentionally avoids reflecting submitted credentials or database errors.

## Provisioning and revocation

No token is provisioned by the migration. After review and deployment, create a random 32-byte token on a trusted machine, record its **SHA-256 digest of the 64-character token text** in `assistant_widget_client_credentials` with a label and scope `widget:today:read`, then transfer the raw token to the intended device through a secure channel. Insert using a privileged database administrator connection; the service role has SELECT only. Use a distinct token for each device. Revoke one device by setting its `revoked_at` timestamp; neither the server secret nor other device credentials need rotation. Never check tokens or token digests into Git.

The existing Site is owner-private. Its hosting sign-in gate may reject a Scriptable HTTP request before this route runs. Verify access from Scriptable after deployment; if the gate blocks the request, an explicitly approved route-level access solution is needed before the widget can use this API. Do not change the entire Site's audience merely to work around that gate. The Site and Edge Function are intentionally not deployed by this PR.
