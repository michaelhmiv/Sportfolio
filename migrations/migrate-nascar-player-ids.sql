-- NASCAR Player ID Migration Script
-- This migrates NASCAR players from series-specific IDs to unified IDs
--
-- Old format: nascar_NCS_123, nascar_NXS_123, nascar_NTS_123
-- New format: nascar_123
--
-- Run this script against your Supabase database

BEGIN;

-- 1. Create ID mapping table
CREATE TEMP TABLE nascar_id_mapping AS
SELECT
    id as old_id,
    'nascar_' || (regexp_match(id, 'nascar_(NCS|NXS|NTS)_(\d+)$'))[2] as new_id
FROM players
WHERE sport = 'NASCAR'
AND id LIKE 'nascar_NCS_%'
   OR id LIKE 'nascar_NXS_%'
   OR id LIKE 'nascar_NTS_%';

-- Show what will be migrated
SELECT 'Players to migrate:' as info, count(*) as count FROM nascar_id_mapping;
SELECT * FROM nascar_id_mapping LIMIT 10;

-- 2. Update players table
UPDATE players p
SET id = m.new_id
FROM nascar_id_mapping m
WHERE p.id = m.old_id;

-- 3. Update player_game_stats
UPDATE player_game_stats pgs
SET player_id = m.new_id
FROM nascar_id_mapping m
WHERE pgs.player_id = m.old_id;

-- 4. Update holdings
UPDATE holdings h
SET asset_id = m.new_id
FROM nascar_id_mapping m
WHERE h.asset_id = m.old_id;

-- 5. Update daily_boosts
UPDATE daily_boosts db
SET player_id = m.new_id
FROM nascar_id_mapping m
WHERE db.player_id = m.old_id;

-- 6. Update share_payouts
UPDATE share_payouts sp
SET player_id = m.new_id
FROM nascar_id_mapping m
WHERE sp.player_id = m.old_id;

-- 7. Update holdings_locks
UPDATE holdings_locks hl
SET asset_id = m.new_id
FROM nascar_id_mapping m
WHERE hl.asset_id = m.old_id;

-- Verify the migration
SELECT 'Players after migration:' as info, count(*) as count FROM players WHERE sport = 'NASCAR';
SELECT id, team, first_name, last_name FROM players WHERE sport = 'NASCAR' LIMIT 10;

COMMIT;
