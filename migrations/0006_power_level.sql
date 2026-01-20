-- Add power_level column to holdings table for condensed shares (5:1 ratio)
-- This enables the "Condense" mechanic where users can compress 5 raw shares into 1 Power Level
-- Power Level shares are used exclusively in Daily Boosts slots for multiplied earnings

ALTER TABLE holdings 
ADD COLUMN IF NOT EXISTS power_level DECIMAL(10, 2) NOT NULL DEFAULT 0.00;

-- Add comment for documentation
COMMENT ON COLUMN holdings.power_level IS 'Condensed shares at 5:1 ratio. Used for Daily Boosts slots. Does not earn passive scout dividends.';
