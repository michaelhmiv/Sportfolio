-- Preserve four-decimal share quantities throughout the AMM reserve and LP audit trail.
-- Holdings and trades already use numeric(12,4); pool reserves must use the same
-- precision so fractional trades do not get rounded away when the pool is updated.

ALTER TABLE player_pools
  ALTER COLUMN shares TYPE numeric(12, 4)
  USING shares::numeric(12, 4);

ALTER TABLE lp_transactions
  ALTER COLUMN shares_amount TYPE numeric(12, 4)
  USING shares_amount::numeric(12, 4),
  ALTER COLUMN pool_shares_before TYPE numeric(12, 4)
  USING pool_shares_before::numeric(12, 4);

DO $$
BEGIN
  IF (
    SELECT numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'player_pools'
      AND column_name = 'shares'
  ) <> 4 THEN
    RAISE EXCEPTION 'player_pools.shares is not using four-decimal precision';
  END IF;

  IF (
    SELECT numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lp_transactions'
      AND column_name = 'shares_amount'
  ) <> 4 THEN
    RAISE EXCEPTION 'lp_transactions.shares_amount is not using four-decimal precision';
  END IF;

  IF (
    SELECT numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lp_transactions'
      AND column_name = 'pool_shares_before'
  ) <> 4 THEN
    RAISE EXCEPTION 'lp_transactions.pool_shares_before is not using four-decimal precision';
  END IF;
END $$;
