-- AMM Migration: Replace order book with constant product AMM pools
-- This migration creates the player_pools table and archives old order data

-- =============================================================================
-- STEP 1: Create player_pools table (constant product AMM pools)
-- Each player has one pool: x * y = k where x=shares, y=play_money
-- =============================================================================
CREATE TABLE IF NOT EXISTS player_pools (
  player_id VARCHAR PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  shares DECIMAL(12,2) NOT NULL DEFAULT 1000,
  play_money DECIMAL(12,2) NOT NULL DEFAULT 10000,
  k DECIMAL(24,2) GENERATED ALWAYS AS (shares * play_money) STORED,
  total_volume DECIMAL(12,2) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for player_pools
CREATE INDEX IF NOT EXISTS idx_player_pools_updated ON player_pools(updated_at);

-- =============================================================================
-- STEP 2: Seed initial pools for all active players
-- Initial liquidity: 1000 shares / 10000 SB = $10/share starting price
-- =============================================================================
INSERT INTO player_pools (player_id, shares, play_money)
SELECT id, 1000, 10000
FROM players
WHERE is_active = true
ON CONFLICT (player_id) DO NOTHING;

-- =============================================================================
-- STEP 3: Archive old order book data (keep for safety, clear live tables)
-- =============================================================================

-- Create archive table for orders if not exists
CREATE TABLE IF NOT EXISTS orders_archive AS
SELECT *, NOW() as archived_at FROM orders WHERE 1=0;

-- Archive existing orders
INSERT INTO orders_archive
SELECT *, NOW() as archived_at FROM orders;

-- Create archive table for bot_actions_log if not exists  
CREATE TABLE IF NOT EXISTS bot_actions_log_archive AS
SELECT *, NOW() as archived_at FROM bot_actions_log WHERE 1=0;

-- Archive existing bot actions
INSERT INTO bot_actions_log_archive
SELECT *, NOW() as archived_at FROM bot_actions_log;

-- =============================================================================
-- STEP 4: Clear live tables (data is now in archives)
-- =============================================================================
TRUNCATE TABLE orders;
TRUNCATE TABLE bot_actions_log;

-- =============================================================================
-- STEP 5: Add indexes to archive tables for easier querying
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_orders_archive_archived_at ON orders_archive(archived_at);
CREATE INDEX IF NOT EXISTS idx_orders_archive_player ON orders_archive(player_id);
CREATE INDEX IF NOT EXISTS idx_bot_actions_archive_archived_at ON bot_actions_log_archive(archived_at);

-- =============================================================================
-- STEP 6: Verify migration counts
-- =============================================================================
SELECT 
  'Player pools created' as metric,
  COUNT(*)::text as value
FROM player_pools
UNION ALL
SELECT 
  'Orders archived',
  COUNT(*)::text
FROM orders_archive
UNION ALL
SELECT 
  'Bot actions archived',
  COUNT(*)::text
FROM bot_actions_log_archive;
