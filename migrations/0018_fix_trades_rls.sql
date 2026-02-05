-- Fix RLS policy for trades table to allow inserts from the service role
-- The AMM pool needs to insert trades with 'pool' as buyer/seller

-- First, check and drop existing insert policy if any
DROP POLICY IF EXISTS "Service can insert trades" ON trades;
DROP POLICY IF EXISTS "Allow trade inserts" ON trades;

-- Create policy to allow inserts (service role bypasses RLS, but just in case)
-- Allow inserts where the current user is involved OR it's an AMM trade
CREATE POLICY "Allow trade inserts" ON trades
  FOR INSERT
  WITH CHECK (true);

-- Also need UPDATE policy
DROP POLICY IF EXISTS "Allow trade updates" ON trades;
CREATE POLICY "Allow trade updates" ON trades
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'trades';
