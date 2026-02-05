-- Migration: Add transaction_type column to lp_transactions table
-- This column was missing from the production database

ALTER TABLE lp_transactions 
ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'add';

-- Update existing rows to have 'add' as the transaction type
UPDATE lp_transactions 
SET transaction_type = 'add' 
WHERE transaction_type IS NULL OR transaction_type = '';
