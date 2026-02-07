-- Purpose:
-- Speed up 24h volume aggregation per player.
-- The app regularly computes rolling 24h volume from the trades table.

CREATE INDEX IF NOT EXISTS trades_player_executed_at_idx
  ON trades (player_id, executed_at DESC);

-- Purpose:
-- Safety net: enforce 1 share per Daily Boost slot.
-- Prevents accidental burning of an entire position if a client/backend regression
-- submits shares_entered > 1.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_boosts_one_share_per_slot'
  ) THEN
    ALTER TABLE daily_boosts
      ADD CONSTRAINT daily_boosts_one_share_per_slot
      CHECK (shares_entered = 1)
      NOT VALID;
  END IF;
END $$;

-- After cleaning legacy rows (if any), you can validate:
-- ALTER TABLE daily_boosts VALIDATE CONSTRAINT daily_boosts_one_share_per_slot;
