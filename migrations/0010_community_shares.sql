-- Migration: Community Shares Tables
-- Community shares are used to create community boosts (+1x multiplier for all holders of a player)

-- Community checkout sessions table
CREATE TABLE IF NOT EXISTS community_checkout_sessions (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whop_session_id VARCHAR(255) UNIQUE,
  plan_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  receipt_id VARCHAR(255) UNIQUE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_checkout_user_idx ON community_checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS community_checkout_status_idx ON community_checkout_sessions(status);
CREATE INDEX IF NOT EXISTS community_checkout_receipt_idx ON community_checkout_sessions(receipt_id);

-- Community orders table
CREATE TABLE IF NOT EXISTS community_orders (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  filled_quantity INTEGER NOT NULL DEFAULT 0,
  limit_price DECIMAL(10, 2),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_orders_side_status_idx ON community_orders(side, status);
CREATE INDEX IF NOT EXISTS community_orders_user_idx ON community_orders(user_id);
CREATE INDEX IF NOT EXISTS community_orders_created_idx ON community_orders(created_at);

-- Community trades table
CREATE TABLE IF NOT EXISTS community_trades (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id VARCHAR(255) NOT NULL REFERENCES users(id),
  seller_id VARCHAR(255) NOT NULL REFERENCES users(id),
  buy_order_id VARCHAR(255) REFERENCES community_orders(id),
  sell_order_id VARCHAR(255) REFERENCES community_orders(id),
  quantity INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_trades_executed_idx ON community_trades(executed_at);
CREATE INDEX IF NOT EXISTS community_trades_buyer_idx ON community_trades(buyer_id);
CREATE INDEX IF NOT EXISTS community_trades_seller_idx ON community_trades(seller_id);
