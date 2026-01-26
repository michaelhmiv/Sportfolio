-- ============================================================
-- PLAYER LIST PERFORMANCE TEST - SQL SCRIPT
-- ============================================================
-- Run these queries in Supabase Dashboard > SQL Editor
-- or via: psql "postgresql://user:pass@host:5432/db"
-- ============================================================

-- Show current row counts for context
SELECT 'Players (active)' as table_name, COUNT(*) as row_count FROM players WHERE is_active = true;
SELECT 'Orders (open/partial)' as table_name, COUNT(*) as row_count FROM orders WHERE status IN ('open', 'partial');
SELECT 'Orders (24h)' as table_name, COUNT(*) as row_count FROM orders WHERE created_at >= NOW() - INTERVAL '24 hours';

-- ============================================================
-- TEST 1: Basic players query (no complex joins)
-- Expected: Fast (< 50ms)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.id, p.first_name, p.last_name, p.team, p.position, p.sport,
       p.last_trade_price, p.volume_24h, p.price_change_24h, p.market_cap
FROM players p
WHERE p.is_active = true
ORDER BY p.volume_24h DESC
LIMIT 50;

-- ============================================================
-- TEST 2: Current Implementation - Correlated Subqueries
-- This is the SLOW approach used in getPlayersPaginated
-- Expected: Slow (> 1s for 50 rows)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.id, p.first_name, p.last_name, p.team, p.position, p.sport,
       p.last_trade_price, p.volume_24h, p.price_change_24h, p.market_cap,
       (SELECT MAX(limit_price)
        FROM orders o
        WHERE o.player_id = p.id
        AND o.side = 'buy'
        AND o.status IN ('open', 'partial')
       ) as best_bid,
       (SELECT MIN(limit_price)
        FROM orders o
        WHERE o.player_id = p.id
        AND o.side = 'sell'
        AND o.status IN ('open', 'partial')
       ) as best_ask,
       (SELECT
          CASE WHEN SUM(o.quantity) > 0
            THEN (SUM(CASE WHEN o.side = 'buy' THEN o.quantity ELSE 0 END)::numeric /
                  SUM(o.quantity)::numeric) * 100
            ELSE 50
          END
        FROM orders o
        WHERE o.player_id = p.id
        AND o.created_at >= NOW() - INTERVAL '24 hours'
       ) as buy_pressure
FROM players p
WHERE p.is_active = true
ORDER BY p.volume_24h DESC
LIMIT 50;

-- ============================================================
-- TEST 3: Optimized - Using CTEs with LEFT JOINs
-- This is the RECOMMENDED approach
-- Expected: Fast (< 200ms)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH best_bids AS (
  SELECT player_id, MAX(limit_price) as best_bid
  FROM orders
  WHERE side = 'buy' AND status IN ('open', 'partial')
  GROUP BY player_id
),
best_asks AS (
  SELECT player_id, MIN(limit_price) as best_ask
  FROM orders
  WHERE side = 'sell' AND status IN ('open', 'partial')
  GROUP BY player_id
),
sentiment AS (
  SELECT player_id,
         CASE WHEN SUM(quantity) > 0
           THEN (SUM(CASE WHEN side = 'buy' THEN quantity ELSE 0 END)::numeric /
                 SUM(quantity)::numeric) * 100
           ELSE 50 END as buy_pressure
  FROM orders
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  GROUP BY player_id
)
SELECT p.id, p.first_name, p.last_name, p.team, p.position, p.sport,
       p.last_trade_price, p.volume_24h, p.price_change_24h, p.market_cap,
       bb.best_bid, ba.best_ask, s.buy_pressure
FROM players p
LEFT JOIN best_bids bb ON p.id = bb.player_id
LEFT JOIN best_asks ba ON p.id = ba.player_id
LEFT JOIN sentiment s ON p.id = s.player_id
WHERE p.is_active = true
ORDER BY p.volume_24h DESC
LIMIT 50;

-- ============================================================
-- RECOMMENDED INDEXES
-- Run these to optimize the queries
-- ============================================================

-- Index for order book queries (best bid/ask)
CREATE INDEX IF NOT EXISTS idx_orders_player_status_side_created
ON orders(player_id, status, side, created_at DESC);

-- Index for sentiment queries (24h volume)
CREATE INDEX IF NOT EXISTS idx_orders_created_at_status
ON orders(created_at DESC, status);

-- Check if these indexes already exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'orders'
AND indexname LIKE '%orders%';

-- ============================================================
-- EXPECTED RESULTS
-- ============================================================
/*
BASELINE (Test 1):     ~20-50ms
CURRENT (Test 2):       ~2000-5000ms (correlated subqueries per row)
OPTIMIZED (Test 3):     ~100-300ms (CTEs with GROUP BY)

Expected improvement: 80-95% faster
*/
