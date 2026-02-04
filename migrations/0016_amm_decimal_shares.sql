-- Migration: AMM Decimal Shares Support
-- Fixes issues #1, #2, #5 from AMM analysis

-- 1. Create "pool" system user for AMM trades
-- This satisfies FK constraints on trades.sellerId/buyerId
INSERT INTO users (id, username, email, is_bot)
VALUES ('pool', 'AMM Pool', 'pool@system.internal', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Alter holdings.quantity from INTEGER to DECIMAL(12,4)
-- This allows fractional share holdings from AMM trades
ALTER TABLE holdings 
  ALTER COLUMN quantity TYPE decimal(12, 4) 
  USING quantity::decimal(12, 4);

-- 3. Alter trades.quantity from INTEGER to DECIMAL(12,4)
-- This allows recording fractional share trades
ALTER TABLE trades 
  ALTER COLUMN quantity TYPE decimal(12, 4) 
  USING quantity::decimal(12, 4);

-- Verify migration
DO $$
BEGIN
  -- Check pool user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = 'pool') THEN
    RAISE EXCEPTION 'Pool user was not created';
  END IF;
  
  RAISE NOTICE 'AMM decimal shares migration completed successfully';
END $$;
