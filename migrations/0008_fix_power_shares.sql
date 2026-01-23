-- Fix existing power shares that were created incorrectly
-- The old code created (quantity = powerGained, power = 5) which was wrong
-- The correct format is (quantity = 1, power = powerGained)

-- First, let's see what we have:
-- SELECT id, asset_id, quantity, power, power_level FROM holdings WHERE power > 1;

-- For each holding with power > 1 and quantity > 1, we need to:
-- 1. Calculate the actual total power = power * quantity
-- 2. Update to quantity = 1, power = total_power

UPDATE holdings
SET
  quantity = 1,
  power = CAST(power_level AS INTEGER),
  power_level = power_level  -- power_level stays the same (total power)
WHERE power > 1 AND quantity > 1;

-- Verify the fix:
-- SELECT id, asset_id, quantity, power, power_level FROM holdings WHERE power > 1;
