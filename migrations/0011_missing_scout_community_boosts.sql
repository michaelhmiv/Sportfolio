-- Migration: Create missing Scout Engine, Community Shares, and Daily Boosts tables
-- Created: 2025-01-22
-- Purpose: Add tables and columns that are referenced in code but missing from production

-- ============================================
-- SECTION 1: Add missing columns to existing tables
-- ============================================

-- Add lastActiveAt to users table for Scout Engine 24h activity tracking
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Create index on last_active_at only if column exists
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Add power columns to holdings for condensed shares mechanics
DO $$ BEGIN
  ALTER TABLE holdings ADD COLUMN IF NOT EXISTS power INTEGER NOT NULL DEFAULT 1;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE holdings ADD COLUMN IF NOT EXISTS power_level DECIMAL(10, 2) NOT NULL DEFAULT 0.00;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Create index on power only if table exists
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS holdings_power_idx ON holdings (asset_id, power);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- ============================================
-- SECTION 2: Scout Engine Tables
-- ============================================

-- Scout assignments table - tracks which players each user is scouting
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS scout_assignments (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    scout_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_user_player_idx ON scout_assignments (user_id, player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_player_idx ON scout_assignments (player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS scout_user_player_unique ON scout_assignments (user_id, player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Scout distributions table - immutable ledger of hourly share distributions
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS scout_distributions (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    hour_timestamp TIMESTAMP NOT NULL,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_scout_minutes INTEGER NOT NULL,
    global_scout_minutes INTEGER NOT NULL,
    shares_earned DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_dist_hour_player_idx ON scout_distributions (hour_timestamp, player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_dist_user_hour_idx ON scout_distributions (user_id, hour_timestamp);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Scout history table - tracks duration of assignments for minute-level precision
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS scout_history (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    scout_count INTEGER NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_history_user_time_idx ON scout_history (user_id, started_at, ended_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_history_player_time_idx ON scout_history (player_id, started_at, ended_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- ============================================
-- SECTION 3: Community Shares Tables
-- ============================================

-- Community checkout sessions - tracks Whop purchases for community shares
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS community_checkout_sessions (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    whop_session_id VARCHAR(255) UNIQUE,
    plan_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    receipt_id VARCHAR(255) UNIQUE,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_checkout_user_idx ON community_checkout_sessions (user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_checkout_status_idx ON community_checkout_sessions (status);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_checkout_receipt_idx ON community_checkout_sessions (receipt_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Community orders - limit and market orders for community share trading
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS community_orders (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_type TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    filled_quantity INTEGER NOT NULL DEFAULT 0,
    limit_price DECIMAL(10, 2),
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_orders_side_status_idx ON community_orders (side, status);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_orders_user_idx ON community_orders (user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_orders_created_idx ON community_orders (created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Community trades - executed community share trade history
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS community_trades (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id VARCHAR(255) NOT NULL REFERENCES users(id),
    seller_id VARCHAR(255) NOT NULL REFERENCES users(id),
    buy_order_id VARCHAR(255) REFERENCES community_orders(id),
    sell_order_id VARCHAR(255) REFERENCES community_orders(id),
    quantity INTEGER NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    executed_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_trades_executed_idx ON community_trades (executed_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_trades_buyer_idx ON community_trades (buyer_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_trades_seller_idx ON community_trades (seller_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- ============================================
-- SECTION 4: Daily Boosts Tables
-- ============================================

-- Daily boosts table - tracks user boost selections for each day
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS daily_boosts (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id),
    sport TEXT NOT NULL,
    slot_tier INTEGER NOT NULL,
    boost_date TIMESTAMP NOT NULL,
    shares_entered INTEGER NOT NULL,
    power_level DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    game_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    fantasy_points DECIMAL(10, 2),
    payout DECIMAL(20, 2),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_user_date_idx ON daily_boosts (user_id, boost_date);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_user_sport_date_idx ON daily_boosts (user_id, sport, boost_date);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_status_idx ON daily_boosts (status);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_player_idx ON daily_boosts (player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_game_idx ON daily_boosts (game_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Boost payouts table - immutable ledger for audit trail
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS boost_payouts (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    boost_id VARCHAR(255) NOT NULL REFERENCES daily_boosts(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id),
    shares_used INTEGER NOT NULL,
    fantasy_points DECIMAL(10, 2) NOT NULL,
    multiplier INTEGER NOT NULL,
    payout_amount DECIMAL(20, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_payout_user_idx ON boost_payouts (user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_payout_boost_idx ON boost_payouts (boost_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS boost_payout_created_idx ON boost_payouts (created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- ============================================
-- SECTION 5: Community Boosts Tables
-- ============================================

-- Community boosts table - global 5x boosts created by premium share redemption
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS community_boosts (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id),
    sport TEXT NOT NULL,
    boost_date TIMESTAMP NOT NULL,
    game_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    fantasy_points DECIMAL(10, 2),
    total_payout DECIMAL(20, 2),
    beneficiary_count INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP
  );
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_boost_creator_date_idx ON community_boosts (creator_id, boost_date);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_boost_sport_date_idx ON community_boosts (sport, boost_date);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_boost_status_idx ON community_boosts (status);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_boost_player_idx ON community_boosts (player_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS community_boost_game_idx ON community_boosts (game_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;
