-- Individually revocable, read-only credentials for trusted personal widget clients.
-- Insert only a SHA-256 digest of a randomly generated 32-byte bearer token.
create table public.assistant_widget_client_credentials (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (length(btrim(label)) between 1 and 100),
  scope text not null check (scope = 'widget:today:read'),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

alter table public.assistant_widget_client_credentials enable row level security;
revoke all on table public.assistant_widget_client_credentials from public, anon, authenticated;
grant select on table public.assistant_widget_client_credentials to service_role;
