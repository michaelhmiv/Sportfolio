-- Add cumulative fee growth tracking for LP fee attribution.
-- Fees are still added to pool reserves; this is used for "fees earned" display.

ALTER TABLE player_pools
  ADD COLUMN IF NOT EXISTS fee_growth_per_lp_share numeric(24, 12) NOT NULL DEFAULT 0;

ALTER TABLE lp_positions
  ADD COLUMN IF NOT EXISTS fee_growth_snapshot numeric(24, 12) NOT NULL DEFAULT 0;

ALTER TABLE lp_positions
  ADD COLUMN IF NOT EXISTS fees_earned_total numeric(12, 2) NOT NULL DEFAULT 0;
