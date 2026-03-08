UPDATE "daily_boosts"
SET
  "share_multiplier" = COALESCE(NULLIF("power_level"::numeric, 0), "share_multiplier", 1.00),
  "share_source_type" = CASE
    WHEN COALESCE(NULLIF("power_level"::numeric, 0), "share_multiplier", 1.00) > 1 THEN 'stacked'
    ELSE 'regular'
  END
WHERE "power_level" IS NOT NULL;

UPDATE "share_payouts"
SET
  "earning_units" = COALESCE(NULLIF("share_power"::numeric, 0), "earning_units"),
  "earning_model" = COALESCE(NULLIF("earning_model", ''), 'legacy_share_power')
WHERE "share_power" IS NOT NULL;

WITH ranked_holdings AS (
  SELECT
    "id",
    "user_id",
    "asset_type",
    "asset_id",
    "quantity"::numeric AS quantity_value,
    "total_cost_basis"::numeric AS total_cost_basis_value,
    FIRST_VALUE("id") OVER (
      PARTITION BY "user_id", "asset_type", "asset_id"
      ORDER BY "last_updated" DESC NULLS LAST, "id"
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "asset_type", "asset_id"
      ORDER BY "last_updated" DESC NULLS LAST, "id"
    ) AS row_number
  FROM "holdings"
),
aggregated_holdings AS (
  SELECT
    keep_id,
    SUM(quantity_value) AS merged_quantity,
    SUM(total_cost_basis_value) AS merged_total_cost_basis
  FROM ranked_holdings
  GROUP BY keep_id
)
UPDATE "holdings" h
SET
  "quantity" = ROUND(aggregated_holdings.merged_quantity, 4),
  "avg_cost_basis" = CASE
    WHEN aggregated_holdings.merged_quantity > 0
      THEN ROUND(aggregated_holdings.merged_total_cost_basis / aggregated_holdings.merged_quantity, 4)
    ELSE 0
  END,
  "total_cost_basis" = ROUND(aggregated_holdings.merged_total_cost_basis, 2),
  "last_updated" = now()
FROM aggregated_holdings
WHERE h."id" = aggregated_holdings.keep_id;

WITH ranked_holdings AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "asset_type", "asset_id"
      ORDER BY "last_updated" DESC NULLS LAST, "id"
    ) AS row_number
  FROM "holdings"
)
DELETE FROM "holdings" h
USING ranked_holdings
WHERE h."id" = ranked_holdings."id"
  AND ranked_holdings.row_number > 1;

DROP INDEX IF EXISTS "holdings_power_idx";
DROP INDEX IF EXISTS "user_asset_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "holdings_user_asset_idx"
  ON "holdings" ("user_id", "asset_type", "asset_id");

ALTER TABLE "holdings"
  DROP COLUMN IF EXISTS "power";

ALTER TABLE "holdings"
  DROP COLUMN IF EXISTS "power_level";

ALTER TABLE "daily_boosts"
  DROP COLUMN IF EXISTS "power_level";

ALTER TABLE "share_payouts"
  DROP COLUMN IF EXISTS "share_power";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'player_multipliers_multiplier_min_check'
  ) THEN
    ALTER TABLE "player_multipliers"
      ADD CONSTRAINT "player_multipliers_multiplier_min_check"
      CHECK ("multiplier" >= 2) NOT VALID;
  END IF;
END $$;
