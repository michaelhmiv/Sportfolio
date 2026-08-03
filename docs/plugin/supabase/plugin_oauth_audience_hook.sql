-- Applied to Supabase project xolfyrbtkmwgllrazcfh on 2026-08-03.
-- This migration is inert until the hook is enabled and an OAuth client is
-- explicitly inserted into public.plugin_oauth_clients.

create table if not exists public.plugin_oauth_clients (
  client_id text primary key,
  resource text not null default 'https://www.sportfolio.market/mcp/plugin',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint plugin_oauth_clients_resource_https check (resource ~ '^https://')
);

comment on table public.plugin_oauth_clients is
  'Explicit OAuth client allowlist used by the Sportfolio marketplace access-token hook.';

alter table public.plugin_oauth_clients enable row level security;

revoke all on table public.plugin_oauth_clients from anon, authenticated, public;
grant select on table public.plugin_oauth_clients to supabase_auth_admin;

drop policy if exists "Auth admin reads plugin OAuth clients" on public.plugin_oauth_clients;
create policy "Auth admin reads plugin OAuth clients"
  on public.plugin_oauth_clients
  for select
  to supabase_auth_admin
  using (true);

create or replace function public.sportfolio_plugin_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  oauth_client_id text := event->'claims'->>'client_id';
  target_resource text;
begin
  if oauth_client_id is not null then
    select client.resource
      into target_resource
      from public.plugin_oauth_clients as client
     where client.client_id = oauth_client_id
       and client.enabled = true;

    if target_resource is not null then
      claims := jsonb_set(claims, '{aud}', to_jsonb(target_resource), true);
      claims := jsonb_set(claims, '{sportfolio_plugin}', 'true'::jsonb, true);
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.sportfolio_plugin_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.sportfolio_plugin_access_token_hook(jsonb) from anon, authenticated, public;
