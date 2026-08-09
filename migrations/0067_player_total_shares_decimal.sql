-- Align the player-wide share accumulator with the fractional-share economy.
-- Holdings and trades have supported DECIMAL(12,4) since migration 0016, while
-- scout distributions award fractional shares. Preserve existing totals while
-- allowing future fractional credits to update players.total_shares safely.

ALTER TABLE players
  ALTER COLUMN total_shares TYPE decimal(12, 4)
  USING total_shares::decimal(12, 4),
  ALTER COLUMN total_shares SET DEFAULT '0.0000';
