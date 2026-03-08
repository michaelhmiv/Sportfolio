CREATE TABLE IF NOT EXISTS "player_multipliers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "player_id" varchar NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "multiplier" integer NOT NULL,
  "avg_cost_basis" numeric(10, 4) NOT NULL DEFAULT 0.0000,
  "total_cost_basis" numeric(20, 2) NOT NULL DEFAULT 0.00,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "player_multiplier_user_player_idx"
  ON "player_multipliers" ("user_id", "player_id");

CREATE INDEX IF NOT EXISTS "player_multiplier_player_idx"
  ON "player_multipliers" ("player_id");

CREATE TABLE IF NOT EXISTS "player_multiplier_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "player_id" varchar NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "shares_consumed" integer NOT NULL DEFAULT 0,
  "effective_shares_burned" integer NOT NULL DEFAULT 0,
  "multiplier_delta" integer NOT NULL DEFAULT 0,
  "multiplier_after" integer NOT NULL DEFAULT 0,
  "consumed_total_cost_basis" numeric(20, 2) NOT NULL DEFAULT 0.00,
  "retained_total_cost_basis" numeric(20, 2) NOT NULL DEFAULT 0.00,
  "boost_id" varchar,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "player_multiplier_event_user_player_created_idx"
  ON "player_multiplier_events" ("user_id", "player_id", "created_at");

CREATE INDEX IF NOT EXISTS "player_multiplier_event_type_idx"
  ON "player_multiplier_events" ("event_type");

ALTER TABLE "daily_boosts"
  ADD COLUMN IF NOT EXISTS "share_multiplier" numeric(10, 2) NOT NULL DEFAULT 1.00;

ALTER TABLE "daily_boosts"
  ADD COLUMN IF NOT EXISTS "share_source_type" text NOT NULL DEFAULT 'regular';

ALTER TABLE "share_payouts"
  ADD COLUMN IF NOT EXISTS "earning_units" numeric(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE "share_payouts"
  ADD COLUMN IF NOT EXISTS "earning_model" text NOT NULL DEFAULT 'legacy_share_power';

ALTER TABLE "share_payouts"
  ADD COLUMN IF NOT EXISTS "void_reason" text;

UPDATE "daily_boosts"
SET
  "share_multiplier" = COALESCE("power_level"::numeric, "shares_entered"::numeric, 1),
  "share_source_type" = CASE
    WHEN COALESCE("power_level"::numeric, 1) > 1 THEN 'stacked'
    ELSE 'regular'
  END
WHERE "share_multiplier" = 1.00;

UPDATE "share_payouts"
SET "earning_units" = "share_power"
WHERE "earning_units" = 0.00;

INSERT INTO "player_multipliers" (
  "user_id",
  "player_id",
  "multiplier",
  "avg_cost_basis",
  "total_cost_basis",
  "created_at",
  "updated_at"
)
SELECT
  h."user_id",
  h."asset_id",
  ROUND(COALESCE(h."power_level"::numeric, h."power"::numeric))::integer,
  COALESCE(h."avg_cost_basis", 0),
  COALESCE(h."total_cost_basis", 0),
  now(),
  now()
FROM "holdings" h
WHERE h."asset_type" = 'player'
  AND COALESCE(h."power", 1) > 1
  AND h."quantity"::numeric > 0
ON CONFLICT ("user_id", "player_id") DO UPDATE
SET
  "multiplier" = EXCLUDED."multiplier",
  "avg_cost_basis" = EXCLUDED."avg_cost_basis",
  "total_cost_basis" = EXCLUDED."total_cost_basis",
  "updated_at" = now();

INSERT INTO "player_multiplier_events" (
  "user_id",
  "player_id",
  "event_type",
  "shares_consumed",
  "effective_shares_burned",
  "multiplier_delta",
  "multiplier_after",
  "consumed_total_cost_basis",
  "retained_total_cost_basis",
  "created_at"
)
SELECT
  h."user_id",
  h."asset_id",
  'migration_backfill',
  ROUND(COALESCE(h."power_level"::numeric, h."power"::numeric) * 2)::integer,
  ROUND(COALESCE(h."power_level"::numeric, h."power"::numeric))::integer,
  ROUND(COALESCE(h."power_level"::numeric, h."power"::numeric))::integer,
  ROUND(COALESCE(h."power_level"::numeric, h."power"::numeric))::integer,
  COALESCE(h."total_cost_basis", 0) * 2,
  COALESCE(h."total_cost_basis", 0),
  now()
FROM "holdings" h
WHERE h."asset_type" = 'player'
  AND COALESCE(h."power", 1) > 1
  AND h."quantity"::numeric > 0;

DELETE FROM "holdings"
WHERE "asset_type" = 'player'
  AND COALESCE("power", 1) > 1;

UPDATE "share_payouts"
SET
  "status" = 'voided',
  "void_reason" = 'stacked_share_multiplier_cutover',
  "processed_at" = now()
WHERE "status" = 'pending';

UPDATE "players" p
SET
  "total_shares" = COALESCE((
    SELECT ROUND(SUM(effective_shares))::integer
    FROM (
      SELECT h."quantity"::numeric AS effective_shares
      FROM "holdings" h
      WHERE h."asset_type" = 'player'
        AND h."asset_id" = p."id"
        AND h."quantity"::numeric > 0

      UNION ALL

      SELECT pm."multiplier"::numeric AS effective_shares
      FROM "player_multipliers" pm
      WHERE pm."player_id" = p."id"
        AND pm."multiplier" > 0
    ) player_positions
  ), 0),
  "last_updated" = now();
