ALTER TABLE "player_pools"
  ALTER COLUMN "shares" SET DEFAULT '50000',
  ALTER COLUMN "play_money" SET DEFAULT '500000',
  ALTER COLUMN "k" SET DEFAULT '25000000000',
  ALTER COLUMN "lp_shares_total" SET DEFAULT '50000';

UPDATE "player_pools"
SET
  "shares" = '50000.00',
  "play_money" = '500000.00',
  "k" = '25000000000.00',
  "lp_shares_total" = '50000.00',
  "fees_accumulated" = '0',
  "fee_growth_per_lp_share" = '0',
  "total_volume" = '0',
  "total_trades" = 0,
  "updated_at" = NOW()
WHERE "total_trades" = 0
  AND (
    CAST("shares" AS numeric) <= 0
    OR CAST("play_money" AS numeric) <= 0
    OR CAST("k" AS numeric) <= 0
    OR CAST("lp_shares_total" AS numeric) <= 0
    OR ABS(
      (CAST("shares" AS numeric) * CAST("play_money" AS numeric))
      - CAST("k" AS numeric)
    ) > 0.01
    OR (
      CAST("shares" AS numeric) = 1000
      AND CAST("play_money" AS numeric) = 10000
      AND CAST("lp_shares_total" AS numeric) = 1000
    )
  );
