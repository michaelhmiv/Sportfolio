-- AMM System Users Migration
-- Creates required system users for AMM/LP functionality
-- 
-- This migration:
-- 1. Creates 'pool' user - Used as buyer/seller ID in AMM trades
-- 2. Creates 'protocol_lp_owner' user - Owns initial protocol liquidity

-- =============================================================================
-- STEP 1: Create 'pool' system user for AMM trades
-- =============================================================================
-- The AMM uses 'pool' as buyerId/sellerId in trades table.
-- This user must exist to satisfy foreign key constraints.

INSERT INTO users (id, email, username, balance, is_admin, is_premium, is_bot, created_at, updated_at)
VALUES (
  'pool',
  'pool@system.sportfolio.internal',
  'AMM Pool',
  '0.00',
  false,
  false,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- STEP 2: Create 'protocol_lp_owner' system user for LP positions
-- =============================================================================
-- The LP system migration (0014) references this user for initial liquidity.
-- This should have been created with that migration.

INSERT INTO users (id, email, username, balance, is_admin, is_premium, is_bot, created_at, updated_at)
VALUES (
  'protocol_lp_owner',
  'protocol@system.sportfolio.internal',
  'Protocol Liquidity',
  '0.00',
  false,
  false,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Verification
-- =============================================================================
SELECT 
  'System users created' as status,
  COUNT(*) as count
FROM users 
WHERE id IN ('pool', 'protocol_lp_owner');
