# Widget Today client API (V0)

This is a read-only projection of the existing Phone Today result for a trusted personal client. It does not create or modify household state.

## Request

`GET https://<supabase-project>.supabase.co/functions/v1/get-client-today`, with `Authorization: Bearer <device token>`. No query parameters or request body. The Supabase project/function URL is public configuration, not a secret. The device token is 32 random bytes encoded as 64 hexadecimal characters. Send it only in the header over HTTPS; do not put it in a URL or in the phone page's browser code.

The dedicated Edge Function hashes the device token with SHA-256, looks up the digest using its server-side service role, checks the exact `widget:today:read` scope and optional expiration/revocation, and calls `assistant_get_phone_today`. It returns `Cache-Control: no-store`. The device token is the only client credential and cannot authorize any other Assistant capability. No service-role key, action secret, or other server credential is sent to or returned to the client. This function is configured with `verify_jwt = false` so Supabase can pass the device bearer token to its own validator.

## Response

Success: `{ "ok": true, "data": { "date": "2026-09-28", "timezone": "Australia/Darwin", "generated_at": "<ISO instant>", "tasks": [], "events": [], "url": "/phone/" } }`. At most six tasks and three current/upcoming events are included. Tasks include `object_id`, `title`, nullable `due_at`, `surface_reason`, `pinned`, nullable `category` (`name`, `color`), and `url` (`/phone/tasks`). Events include `object_id`, `title`, local `date`, `all_day`, nullable `category`, `url` (`/phone/calendar`), and `starts_at`/`ends_at` for timed events. IDs allow future object-specific navigation; today's phone UI navigates to the destination, not directly to an expanded object. Neither descriptions nor internal rows are exposed.

Errors return `{ "ok": false, "code": "..." }` with 400 for unsupported query parameters, 401 for missing/invalid/revoked/expired/wrong-scope credentials, 405 for other methods, and 503 for unavailable configuration or reads. The response intentionally avoids reflecting submitted credentials or database errors.

## Provisioning and revocation

No token is provisioned by the migration. After review and deployment, create a random 32-byte token on a trusted machine, record its **SHA-256 digest of the 64-character token text** in `assistant_widget_client_credentials` with a label and scope `widget:today:read`, then transfer the raw token to the intended device through a secure channel. Insert using a privileged database administrator connection; the service role has SELECT only. Use a distinct token for each device. Revoke one device by setting its `revoked_at` timestamp; other device credentials and server credentials need no rotation. Never check tokens or token digests into Git.

The Assistant.AI Site remains owner-private. Scriptable requests the dedicated Edge Function directly, so its access does not depend on Site sign-in. The Edge Function and migration are intentionally not deployed by this PR. No Scriptable UI is included.
