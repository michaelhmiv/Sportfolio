-- Add power column to holdings table to track power level per share
-- Each share has its own power level (1 = default, 5 = condensed, etc.)
-- Powered shares display as separate rows in portfolio

ALTER TABLE holdings
ADD COLUMN IF NOT EXISTS power INTEGER NOT NULL DEFAULT 1;

-- Add comment for documentation
COMMENT ON COLUMN holdings.power IS 'Power level per individual share. 1 = regular share, 5 = condensed (5:1). Cannot be separated once condensed.';

-- Update existing power_level to be computed from power * quantity
-- This is a transitional step - we'll migrate data and then remove power_level
