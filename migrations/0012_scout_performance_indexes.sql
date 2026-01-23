-- Migration: Add performance indexes for Scout Engine queries
-- Created: 2025-01-22
-- Purpose: Add missing standalone index on scout_assignments.user_id for JOIN performance

-- Add standalone index on scout_assignments.user_id
-- The existing scout_user_player_idx is a composite (user_id, player_id) index,
-- but for JOIN queries that filter by user_id with additional conditions,
-- a standalone index can provide better performance
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS scout_user_idx ON scout_assignments (user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;
