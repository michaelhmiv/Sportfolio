-- Applied to Supabase project xolfyrbtkmwgllrazcfh on 2026-08-03.
--
-- Sportfolio's web and mobile clients use the Express API for application data;
-- Supabase is used for Auth. Direct PostgreSQL access by the backend owner role
-- is unaffected by RLS and Data API role revocation.
--
-- This migration makes every public-schema table server-only through PostgREST
-- unless a future, reviewed migration explicitly grants a narrower role/policy.

do $$
declare
  table_record record;
begin
  for table_record in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', table_record.table_name);
    execute format('revoke all privileges on table public.%I from anon', table_record.table_name);
    execute format('revoke all privileges on table public.%I from authenticated', table_record.table_name);
  end loop;
end
$$;

-- Preserve the narrowly scoped Auth-hook read path. This role is internal to
-- Supabase Auth and is not available to browser or ordinary authenticated users.
grant select on table public.plugin_oauth_clients to supabase_auth_admin;
