-- Applied to Supabase project xolfyrbtkmwgllrazcfh on 2026-08-03 after the
-- security advisor confirmed that anon and authenticated had full CRUD grants
-- on sensitive/user-owned public tables with RLS disabled.
--
-- Sportfolio application data flows through the Express/Postgres backend. The
-- browser Supabase client is used for Auth and does not query these tables via
-- PostgREST. Enabling RLS and revoking Data API roles does not change direct
-- backend Postgres access by the application owner role.

do $$
declare
  table_name text;
  protected_tables text[] := array[
    'user',
    'session',
    'account',
    'verification',
    'account_deletion_requests',
    'transactions',
    'watchlist',
    'user_notification_preferences',
    'user_notification_settings',
    'user_push_devices',
    'user_push_tokens',
    'price_alerts',
    'transaction_alerts',
    'push_notification_events'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all privileges on table public.%I from anon', table_name);
      execute format('revoke all privileges on table public.%I from authenticated', table_name);
    end if;
  end loop;
end
$$;
