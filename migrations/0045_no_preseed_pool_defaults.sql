-- Remove seeded AMM defaults so new players start at zero until real liquidity is added.
ALTER TABLE players
  ALTER COLUMN current_price SET DEFAULT '0.00';

ALTER TABLE player_pools
  ALTER COLUMN shares SET DEFAULT '0',
  ALTER COLUMN play_money SET DEFAULT '0',
  ALTER COLUMN k SET DEFAULT '0',
  ALTER COLUMN lp_shares_total SET DEFAULT '0';
