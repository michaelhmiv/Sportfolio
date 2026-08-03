-- Applied to Supabase project xolfyrbtkmwgllrazcfh on 2026-08-03.
-- Pins mutable function search paths and prevents public enumeration of the
-- avatars bucket. Public object URLs remain available through the public bucket.

do $$
declare
  function_record record;
  configured_path text;
begin
  for function_record in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'game')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    configured_path := case
      when function_record.schema_name = 'game' then 'game, public, pg_temp'
      else 'public, pg_temp'
    end;

    execute format(
      'alter function %I.%I(%s) set search_path = %s',
      function_record.schema_name,
      function_record.function_name,
      function_record.identity_arguments,
      configured_path
    );
  end loop;
end
$$;

drop policy if exists "Public read access 1oj01fe_0" on storage.objects;
