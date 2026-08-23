-- Sportfolio clean sports-data reset for MLB/NASCAR public-data migration.
--
-- PURPOSE
--   Clears current sports/economy/slate data so the app can reseed cleanly with:
--     - MLB players keyed as mlb_<MLBAM_ID> from public MLB StatsAPI
--     - NASCAR data from the existing public NASCAR integration
--   Preserves users/auth, profile/config tables, docs/blog content, notification settings,
--   automation configuration and other non-sports infrastructure.
--
-- SAFETY
--   DO NOT run casually. Run the DRY RUN section first and review row counts.
--   This script is intentionally transaction-wrapped. If anything looks wrong,
--   ROLLBACK instead of COMMIT.
--
-- DRY RUN / AUDIT COUNTS ------------------------------------------------------
select 'players_by_sport' as section, sport, count(*)::bigint as rows
from players
group by sport
order by sport;

select 'daily_games_by_sport' as section, sport, count(*)::bigint as rows
from daily_games
group by sport
order by sport;

select 'player_game_stats_by_sport' as section, sport, count(*)::bigint as rows
from player_game_stats
group by sport
order by sport;

select 'trades_by_sport' as section, p.sport, count(*)::bigint as rows
from trades t
join players p on p.id = t.player_id
group by p.sport
order by p.sport;

select 'lp_positions_by_sport' as section, p.sport, count(*)::bigint as rows
from lp_positions lp
join players p on p.id = lp.player_id
group by p.sport
order by p.sport;

select 'holdings_by_sport' as section, p.sport, count(*)::bigint as rows
from holdings h
join players p on p.id = h.asset_id
where h.asset_type = 'player'
group by p.sport
order by p.sport;

select 'daily_boosts_by_sport' as section, sport, count(*)::bigint as rows
from daily_boosts
group by sport
order by sport;

select 'users_preserved' as section, null::text as sport, count(*)::bigint as rows
from users;

-- DESTRUCTIVE RESET -----------------------------------------------------------
-- Uncomment the block below only after reviewing the dry-run counts and taking a
-- database backup/export if desired.

/*
begin;

-- Reset user sports/economy state. These tables are safe to clear for a pre-launch
-- reset because there is no meaningful user portfolio state to preserve.
do $$
declare
  table_name text;
  tables_to_truncate text[] := array[
    'holdings_locks',
    'holdings',
    'orders',
    'trades',
    'lp_transactions',
    'lp_positions',
    'player_pools',
    'price_history',
    'portfolio_snapshots',
    'market_snapshots',
    'player_market_metrics',
    'player_game_stats',
    'daily_boosts',
    'boost_payouts',
    'share_payouts',
    'community_boosts',
    'scout_assignments',
    'scout_distributions',
    'scout_history',
    'vesting',
    'vesting_claims',
    'vesting_splits',
    'watch_list',
    'player_id_aliases',
    'contest_lineups',
    'contest_entries',
    'daily_games',
    'players'
  ];
begin
  foreach table_name in array tables_to_truncate loop
    if to_regclass('public.' || table_name) is not null then
      execute format('truncate table public.%I cascade', table_name);
    end if;
  end loop;
end $$;

-- Keep job logs bounded after reset.
delete from job_execution_logs
where started_at < now() - interval '14 days';

-- Verification counts should show no sports rows until reseed jobs run.
select 'players_after_reset' as section, count(*)::bigint as rows from players;
select 'daily_games_after_reset' as section, count(*)::bigint as rows from daily_games;
select 'player_game_stats_after_reset' as section, count(*)::bigint as rows from player_game_stats;
select 'users_after_reset_preserved' as section, count(*)::bigint as rows from users;

commit;
*/
