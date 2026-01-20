-- Scout Engine Phase 1: Schema additions
-- Migration: Add scout assignments and distributions tables for proactive share emission

-- 1. Add lastActiveAt to users table for 24h activity kill-switch
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP;
CREATE INDEX idx_users_last_active ON users (last_active_at);

-- 2. Create scout_assignments table
-- Tracks which players each user is scouting, supports stacking multiple scouts
CREATE TABLE scout_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  scout_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX scout_user_player_idx ON scout_assignments (user_id, player_id);
CREATE INDEX scout_player_idx ON scout_assignments (player_id);
-- Add unique constraint to prevent duplicate user-player assignments
CREATE UNIQUE INDEX scout_user_player_unique ON scout_assignments (user_id, player_id);

-- 3. Create scout_distributions table
-- Immutable ledger of hourly share distributions
-- Formula: (60 Shares) * (User's Scout-Minutes / Total Global Scout-Minutes)
CREATE TABLE scout_distributions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  hour_timestamp TIMESTAMP NOT NULL,
  player_id VARCHAR NOT NULL REFERENCES players(id),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_scout_minutes INTEGER NOT NULL,
  global_scout_minutes INTEGER NOT NULL,
  shares_earned DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX scout_dist_hour_player_idx ON scout_distributions (hour_timestamp, player_id);
CREATE INDEX scout_dist_user_hour_idx ON scout_distributions (user_id, hour_timestamp);
