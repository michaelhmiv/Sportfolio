-- Migration: Player market metrics table + scale indexes for large multi-sport player lists
-- Purpose:
-- 1) Precompute complex sort metrics (FPTS, sentiment, value index, bid/ask) in a durable table
-- 2) Add supporting indexes for scalable list/filter queries as player counts grow (NBA+NFL+MLB+)

-- ---------------------------------------------------------------------------
-- 1) Create player_market_metrics table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_market_metrics (
  player_id varchar PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  avg_fantasy_points numeric(10,2) NOT NULL DEFAULT 0.00,
  buy_pressure numeric(5,2) NOT NULL DEFAULT 50.00,
  total_order_volume_24h integer NOT NULL DEFAULT 0,
  value_index numeric(10,2) NOT NULL DEFAULT 0.00,
  best_bid numeric(10,2) NOT NULL DEFAULT 0.00,
  best_ask numeric(10,2) NOT NULL DEFAULT 0.00,
  bid_size integer NOT NULL DEFAULT 0,
  ask_size integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pmm_avg_fantasy_points_idx ON player_market_metrics (avg_fantasy_points);
CREATE INDEX IF NOT EXISTS pmm_buy_pressure_idx ON player_market_metrics (buy_pressure);
CREATE INDEX IF NOT EXISTS pmm_value_index_idx ON player_market_metrics (value_index);
CREATE INDEX IF NOT EXISTS pmm_best_bid_idx ON player_market_metrics (best_bid);
CREATE INDEX IF NOT EXISTS pmm_best_ask_idx ON player_market_metrics (best_ask);
CREATE INDEX IF NOT EXISTS pmm_updated_at_idx ON player_market_metrics (updated_at);

-- Seed baseline rows (job will fill actual values)
INSERT INTO player_market_metrics (player_id)
SELECT id
FROM players
ON CONFLICT (player_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Add high-value list indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS players_active_sport_volume_idx ON players (is_active, sport, volume_24h DESC);
CREATE INDEX IF NOT EXISTS players_active_sport_price_idx ON players (is_active, sport, last_trade_price DESC);
CREATE INDEX IF NOT EXISTS players_active_sport_market_cap_idx ON players (is_active, sport, market_cap DESC);
CREATE INDEX IF NOT EXISTS players_active_sport_change_idx ON players (is_active, sport, price_change_24h DESC);
CREATE INDEX IF NOT EXISTS players_active_name_idx ON players (is_active, last_name, first_name);

CREATE INDEX IF NOT EXISTS watch_user_watchlist_player_idx ON watch_list (user_id, watchlist_id, player_id);

