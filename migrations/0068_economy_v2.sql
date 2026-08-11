-- Sportfolio Economy V2
-- Intentionally retires Stack Power and the legacy unbounded payout model.
-- Safe to rerun: Stack data is migrated once and the source tables are then dropped.

-- 1. Convert retained Stack Power back to Singles at exactly 1 Power -> 1 Single.
-- The other half of the original 2:1 stacking input was already burned and MUST NOT be restored.
DO $$
BEGIN
  IF to_regclass('public.player_multipliers') IS NOT NULL THEN
    INSERT INTO holdings (
      user_id,
      asset_type,
      asset_id,
      quantity,
      avg_cost_basis,
      total_cost_basis,
      last_updated
    )
    SELECT
      pm.user_id,
      'player',
      pm.player_id,
      pm.multiplier::numeric,
      CASE WHEN pm.multiplier > 0 THEN pm.total_cost_basis / pm.multiplier ELSE 0 END,
      pm.total_cost_basis,
      now()
    FROM player_multipliers pm
    WHERE pm.multiplier > 0
    ON CONFLICT (user_id, asset_type, asset_id) DO UPDATE
    SET
      quantity = holdings.quantity::numeric + EXCLUDED.quantity::numeric,
      total_cost_basis = holdings.total_cost_basis::numeric + EXCLUDED.total_cost_basis::numeric,
      avg_cost_basis = CASE
        WHEN holdings.quantity::numeric + EXCLUDED.quantity::numeric > 0 THEN
          (holdings.total_cost_basis::numeric + EXCLUDED.total_cost_basis::numeric)
          / (holdings.quantity::numeric + EXCLUDED.quantity::numeric)
        ELSE 0
      END,
      last_updated = now();
  END IF;
END $$;

-- Existing Boosts/payouts belong to the retired economy. There are no meaningful external users,
-- so clear them rather than preserve a dual-economy compatibility path.
DELETE FROM holdings_locks WHERE lock_type = 'boost';
DELETE FROM boost_payouts;
DELETE FROM daily_boosts;
DELETE FROM share_payouts;

-- Retired Stack tables are no longer part of the active schema.
DROP TABLE IF EXISTS player_multiplier_events CASCADE;
DROP TABLE IF EXISTS player_multipliers CASCADE;

-- Recreate share payouts as immutable per-user EPS snapshots for Economy V2.
DROP TABLE IF EXISTS share_payouts CASCADE;
CREATE TABLE share_payouts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id varchar NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  eligible_shares numeric(20,4) NOT NULL,
  fantasy_points numeric(12,4),
  game_eps_sb numeric(24,8),
  payout_amount numeric(20,4),
  status text NOT NULL DEFAULT 'pending',
  void_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp,
  CONSTRAINT share_payouts_economy_v2_status_check
    CHECK (status IN ('pending','processed','voided')),
  CONSTRAINT share_payouts_economy_v2_shares_check CHECK (eligible_shares >= 0),
  CONSTRAINT share_payouts_economy_v2_unique UNIQUE (user_id, player_id, game_id)
);
CREATE INDEX share_payouts_game_status_idx ON share_payouts(game_id, status);
CREATE INDEX share_payouts_player_game_idx ON share_payouts(player_id, game_id);
CREATE INDEX share_payouts_user_created_idx ON share_payouts(user_id, created_at DESC);

-- One authoritative normalized earnings record per player/game.
CREATE TABLE IF NOT EXISTS player_game_earnings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id varchar NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  sport text NOT NULL,
  economy_version text NOT NULL,
  season_phase text NOT NULL,
  economy_class text NOT NULL,
  season_target_sb numeric(20,4) NOT NULL,
  benchmark_fantasy_points numeric(20,4) NOT NULL,
  total_eligible_shares numeric(24,4) NOT NULL DEFAULT 0,
  fantasy_points numeric(12,4),
  sb_per_fantasy_point numeric(24,8),
  base_pool_sb numeric(24,4),
  game_eps_sb numeric(24,8),
  status text NOT NULL DEFAULT 'snapshotted',
  snapshotted_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp,
  CONSTRAINT player_game_earnings_phase_check
    CHECK (season_phase IN ('preseason','regular','postseason')),
  CONSTRAINT player_game_earnings_status_check
    CHECK (status IN ('snapshotted','processed','voided','no_shares')),
  CONSTRAINT player_game_earnings_unique UNIQUE (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS player_game_earnings_game_status_idx
  ON player_game_earnings(game_id, status);
CREATE INDEX IF NOT EXISTS player_game_earnings_player_game_idx
  ON player_game_earnings(player_id, game_id);
CREATE INDEX IF NOT EXISTS player_game_earnings_phase_created_idx
  ON player_game_earnings(season_phase, snapshotted_at DESC);

-- Direct-share Boost schema. Convert quantity fields to fractional-share precision.
ALTER TABLE daily_boosts
  ALTER COLUMN shares_entered TYPE numeric(20,4) USING shares_entered::numeric;
ALTER TABLE daily_boosts
  ADD COLUMN IF NOT EXISTS shares_burned numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at timestamp,
  ADD COLUMN IF NOT EXISTS game_eps_sb numeric(24,8),
  ADD COLUMN IF NOT EXISTS base_component_sb numeric(20,4),
  ADD COLUMN IF NOT EXISTS boost_bonus_sb numeric(20,4),
  ADD COLUMN IF NOT EXISTS total_economic_earnings_sb numeric(20,4);
ALTER TABLE daily_boosts DROP COLUMN IF EXISTS share_multiplier;
ALTER TABLE daily_boosts DROP COLUMN IF EXISTS share_source_type;

ALTER TABLE daily_boosts DROP CONSTRAINT IF EXISTS daily_boosts_slot_tier_check;
ALTER TABLE daily_boosts ADD CONSTRAINT daily_boosts_slot_tier_check
  CHECK (slot_tier IN (2,3,5,7,10));
ALTER TABLE daily_boosts DROP CONSTRAINT IF EXISTS daily_boosts_shares_entered_check;
ALTER TABLE daily_boosts ADD CONSTRAINT daily_boosts_shares_entered_check CHECK (shares_entered > 0);

DROP TABLE IF EXISTS boost_payouts CASCADE;
CREATE TABLE boost_payouts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  boost_id varchar NOT NULL REFERENCES daily_boosts(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id varchar NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  shares_used numeric(20,4) NOT NULL,
  fantasy_points numeric(12,4) NOT NULL,
  multiplier integer NOT NULL,
  game_eps_sb numeric(24,8) NOT NULL,
  base_component_sb numeric(20,4) NOT NULL,
  boost_bonus_sb numeric(20,4) NOT NULL,
  total_economic_earnings_sb numeric(20,4) NOT NULL,
  payout_amount numeric(20,4) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT boost_payouts_economy_v2_multiplier_check CHECK (multiplier >= 1),
  CONSTRAINT boost_payouts_economy_v2_unique UNIQUE (boost_id)
);
CREATE INDEX boost_payout_user_idx ON boost_payouts(user_id, created_at DESC);
CREATE INDEX boost_payout_player_game_idx ON boost_payouts(player_id, game_id);

-- Immutable economy event ledger for operational inflation/supply telemetry.
CREATE TABLE IF NOT EXISTS economy_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  player_id varchar REFERENCES players(id) ON DELETE SET NULL,
  game_id text,
  sb_delta numeric(24,4) NOT NULL DEFAULT 0,
  shares_delta numeric(24,4) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS economy_events_type_created_idx
  ON economy_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS economy_events_player_created_idx
  ON economy_events(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS economy_events_user_created_idx
  ON economy_events(user_id, created_at DESC);

-- Recompute user-held outstanding Singles. AMM reserve shares remain pool inventory and are not
-- included in players.total_shares under the current canonical accounting contract.
UPDATE players p
SET total_shares = COALESCE((
  SELECT SUM(h.quantity::numeric)
  FROM holdings h
  WHERE h.asset_type = 'player'
    AND h.asset_id = p.id
    AND h.quantity::numeric > 0
), 0),
last_updated = now();
