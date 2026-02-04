-- Emergency fix: Create AMM tables only (no archiving)
-- Run this if migration 0013 failed due to disk space

-- Create player_pools table
CREATE TABLE IF NOT EXISTS player_pools (
  player_id VARCHAR PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  shares DECIMAL(12,2) NOT NULL DEFAULT 1000,
  play_money DECIMAL(12,2) NOT NULL DEFAULT 10000,
  k DECIMAL(24,2) NOT NULL DEFAULT 10000000,
  lp_shares_total DECIMAL(24,2) NOT NULL DEFAULT 1000,
  fees_accumulated DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_volume DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_trades INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_pools_updated ON player_pools(updated_at);

-- Create lp_positions table
CREATE TABLE IF NOT EXISTS lp_positions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  lp_shares DECIMAL(24,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_lp_positions_user ON lp_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_positions_player ON lp_positions(player_id);

-- Create lp_transactions table
CREATE TABLE IF NOT EXISTS lp_transactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type VARCHAR NOT NULL, -- 'add', 'remove'
  lp_shares DECIMAL(24,2) NOT NULL,
  shares DECIMAL(12,2) NOT NULL,
  play_money DECIMAL(12,2) NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lp_transactions_user ON lp_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_player ON lp_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_timestamp ON lp_transactions(timestamp);

-- Seed pools for existing active players
INSERT INTO player_pools (player_id, shares, play_money)
SELECT id, 1000, 10000
FROM players
WHERE is_active = true
ON CONFLICT (player_id) DO NOTHING;

-- Show results
SELECT 'player_pools' as table_name, COUNT(*) as count FROM player_pools
UNION ALL
SELECT 'lp_positions', COUNT(*) FROM lp_positions
UNION ALL
SELECT 'lp_transactions', COUNT(*) FROM lp_transactions;
