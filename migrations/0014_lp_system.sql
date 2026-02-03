-- AMM LP System Migration
-- Adds liquidity provider functionality to AMM pools

-- =============================================================================
-- STEP 1: Update player_pools table with LP tracking
-- =============================================================================
ALTER TABLE player_pools 
ADD COLUMN IF NOT EXISTS lp_shares_total DECIMAL(24,2) NOT NULL DEFAULT 1000,
ADD COLUMN IF NOT EXISTS fees_accumulated DECIMAL(12,2) NOT NULL DEFAULT 0;

-- =============================================================================
-- STEP 2: Create lp_positions table
-- Tracks user ownership of LP tokens for each pool
-- =============================================================================
CREATE TABLE IF NOT EXISTS lp_positions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  lp_shares DECIMAL(24,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, player_id)
);

-- Indexes for LP positions
CREATE INDEX IF NOT EXISTS idx_lp_positions_user ON lp_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_positions_player ON lp_positions(player_id);
CREATE INDEX IF NOT EXISTS idx_lp_positions_shares ON lp_positions(lp_shares);

-- =============================================================================
-- STEP 3: Create lp_transactions table
-- Audit trail for all liquidity additions and removals
-- =============================================================================
CREATE TABLE IF NOT EXISTS lp_transactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('add', 'remove')),
  lp_shares DECIMAL(24,2) NOT NULL,
  shares_amount DECIMAL(12,2) NOT NULL,
  play_money_amount DECIMAL(12,2) NOT NULL,
  pool_shares_before DECIMAL(12,2) NOT NULL,
  pool_play_money_before DECIMAL(12,2) NOT NULL,
  pool_lp_shares_total_before DECIMAL(24,2) NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Indexes for LP transactions
CREATE INDEX IF NOT EXISTS idx_lp_transactions_user ON lp_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_player ON lp_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_timestamp ON lp_transactions(timestamp);

-- =============================================================================
-- STEP 4: Seed initial protocol liquidity
-- Mint 1000 shares + 10000 SB for each active player
-- LP shares all go to a protocol system account
-- =============================================================================

-- Create protocol LP account (represents the house/protocol)
-- We'll use a special user ID for this
DO $$
DECLARE
  protocol_user_id VARCHAR := 'protocol_lp_owner';
  player_record RECORD;
BEGIN
  -- Check if protocol user exists, if not we need to handle this differently
  -- For now, we'll just create LP positions for all active players
  -- The protocol user should be created separately
  
  FOR player_record IN 
    SELECT id FROM players WHERE is_active = true
  LOOP
    -- Update player_pools lp_shares_total
    UPDATE player_pools 
    SET lp_shares_total = 1000
    WHERE player_id = player_record.id;
    
    -- Create LP position for protocol (will be associated with actual protocol user later)
    -- Note: This assumes a protocol user exists. If not, we'll need to create one.
    INSERT INTO lp_positions (user_id, player_id, lp_shares)
    VALUES (protocol_user_id, player_record.id, 1000)
    ON CONFLICT (user_id, player_id) DO NOTHING;
  END LOOP;
END $$;

-- =============================================================================
-- STEP 5: Create view for LP position details
-- Makes it easier to query LP positions with calculated values
-- =============================================================================
CREATE OR REPLACE VIEW lp_position_details AS
SELECT 
  lp.user_id,
  lp.player_id,
  lp.lp_shares,
  pp.lp_shares_total,
  pp.shares as pool_shares,
  pp.play_money as pool_play_money,
  CASE 
    WHEN pp.lp_shares_total > 0 THEN lp.lp_shares / pp.lp_shares_total
    ELSE 0
  END as ownership_percentage,
  CASE 
    WHEN pp.lp_shares_total > 0 THEN (lp.lp_shares / pp.lp_shares_total) * pp.shares
    ELSE 0
  END as equivalent_shares,
  CASE 
    WHEN pp.lp_shares_total > 0 THEN (lp.lp_shares / pp.lp_shares_total) * pp.play_money
    ELSE 0
  END as equivalent_play_money,
  CASE 
    WHEN pp.lp_shares_total > 0 THEN (lp.lp_shares / pp.lp_shares_total) * pp.shares * (pp.play_money / pp.shares)
    ELSE 0
  END as position_value
FROM lp_positions lp
JOIN player_pools pp ON lp.player_id = pp.player_id;

-- =============================================================================
-- Verification query
-- =============================================================================
SELECT 
  'Player pools with LP tracking' as metric,
  COUNT(*)::text as value
FROM player_pools
UNION ALL
SELECT 
  'LP positions created',
  COUNT(*)::text
FROM lp_positions
UNION ALL
SELECT 
  'Total LP shares issued',
  SUM(lp_shares_total)::text
FROM player_pools;
