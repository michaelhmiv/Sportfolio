ALTER TABLE "share_payouts"
  ALTER COLUMN "earning_model" SET DEFAULT 'multiplier_only';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'player_multipliers_multiplier_min_check'
      AND conrelid = 'player_multipliers'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE "player_multipliers"
      VALIDATE CONSTRAINT "player_multipliers_multiplier_min_check";
  END IF;
END $$;
