-- Add powerLevel column to daily_boosts table to track power at time of boost
ALTER TABLE daily_boosts ADD COLUMN IF NOT EXISTS power_level decimal(10, 2) NOT NULL DEFAULT '0.00';
