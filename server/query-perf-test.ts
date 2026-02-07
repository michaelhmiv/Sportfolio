/**
 * Query Performance Test Script
 * Run with: npx tsx server/query-perf-test.ts
 *
 * This script measures the performance of player list queries
 * to identify bottlenecks and optimization opportunities.
 */

import { neon } from "@neondatabase/serverless";
import { performance } from "node:perf_hooks";

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.DEV_DATABASE_URL;

  if (!databaseUrl) {
    console.error("❌ ERROR: DATABASE_URL or DEV_DATABASE_URL must be set");
    console.log(
      "Example: DATABASE_URL='postgresql://user:pass@host:5432/db' npx tsx server/query-perf-test.ts",
    );
    process.exit(1);
  }

  console.log("🔍 Connecting to database...");
  const sql = neon(databaseUrl);

  // Test 1: Simple player count
  console.log("\n📊 Test 1: Simple player count");
  const t1Start = performance.now();
  const playersResult = await sql`SELECT COUNT(*) as count FROM players WHERE is_active = true`;
  const t1End = performance.now();
  console.log(`   Players count: ${playersResult[0].count}`);
  console.log(`   ⏱️  Time: ${(t1End - t1Start).toFixed(2)}ms`);

  // Test 2: getPlayersPaginated - basic query (no joins)
  console.log("\n📊 Test 2: Basic players query (no complex joins)");
  const t2Start = performance.now();
  const basicPlayers = await sql`
    SELECT p.id, p.first_name, p.last_name, p.team, p.position, p.sport,
           p.last_trade_price, p.volume_24h, p.price_change_24h, p.market_cap
    FROM players p
    WHERE p.is_active = true
    ORDER BY p.volume_24h DESC
    LIMIT 50
  `;
  const t2End = performance.now();
  console.log(`   Players fetched: ${basicPlayers.length}`);
  console.log(`   ⏱️  Time: ${(t2End - t2Start).toFixed(2)}ms`);

  // Test 3: Correlated subquery - Best Bid (current slow approach)
  console.log("\n📊 Test 3: Correlated subquery - Best Bid (CURRENT SLOW APPROACH)");
  const t3Start = performance.now();
  const withCorrelatedBid = await sql`
    SELECT p.id, p.first_name, p.last_name, p.team, p.sport, p.volume_24h,
           (SELECT MAX(limit_price)
            FROM orders o
            WHERE o.player_id = p.id
            AND o.side = 'buy'
            AND o.status IN ('open', 'partial')
           ) as best_bid
    FROM players p
    WHERE p.is_active = true
    ORDER BY p.volume_24h DESC
    LIMIT 50
  `;
  const t3End = performance.now();
  console.log(`   Players with best bid: ${withCorrelatedBid.length}`);
  console.log(`   ⏱️  Time: ${(t3End - t3Start).toFixed(2)}ms`);

  // Test 4: Correlated subquery - Best Ask (current slow approach)
  console.log("\n📊 Test 4: Correlated subquery - Best Ask (CURRENT SLOW APPROACH)");
  const t4Start = performance.now();
  const withCorrelatedAsk = await sql`
    SELECT p.id, p.first_name, p.last_name, p.team, p.sport, p.volume_24h,
           (SELECT MIN(limit_price)
            FROM orders o
            WHERE o.player_id = p.id
            AND o.side = 'sell'
            AND o.status IN ('open', 'partial')
           ) as best_ask
    FROM players p
    WHERE p.is_active = true
    ORDER BY p.volume_24h DESC
    LIMIT 50
  `;
  const t4End = performance.now();
  console.log(`   Players with best ask: ${withCorrelatedAsk.length}`);
  console.log(`   ⏱️  Time: ${(t4End - t4Start).toFixed(2)}ms`);

  // Test 5: Sentiment calculation with correlated subquery
  console.log(
    "\n📊 Test 5: Sentiment calculation with correlated subquery (CURRENT SLOW APPROACH)",
  );
  const t5Start = performance.now();
  const withSentiment = await sql`
    SELECT p.id, p.first_name, p.last_name, p.team, p.sport, p.volume_24h,
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
    LIMIT 50
  `;
  const t5End = performance.now();
  console.log(`   Players with sentiment: ${withSentiment.length}`);
  console.log(`   ⏱️  Time: ${(t5End - t5Start).toFixed(2)}ms`);

  // Test 6: Combined correlated subqueries (like current implementation)
  console.log("\n📊 Test 6: COMBINED correlated subqueries (FULL CURRENT IMPLEMENTATION)");
  const t6Start = performance.now();
  const withAllCorrelated = await sql`
    SELECT p.id, p.first_name, p.last_name, p.team, p.position, p.sport,
           p.last_trade_price, p.volume_24h, p.price_change_24h, p.market_cap,
           (SELECT MAX(limit_price)
            FROM orders o
            WHERE o.player_id = p.id AND o.side = 'buy' AND o.status IN ('open', 'partial')
           ) as best_bid,
           (SELECT MIN(limit_price)
            FROM orders o
            WHERE o.player_id = p.id AND o.side = 'sell' AND o.status IN ('open', 'partial')
           ) as best_ask,
           (SELECT
              CASE WHEN SUM(o.quantity) > 0
                THEN (SUM(CASE WHEN o.side = 'buy' THEN o.quantity ELSE 0 END)::numeric /
                      SUM(o.quantity)::numeric) * 100
                ELSE 50
              END
            FROM orders o
            WHERE o.player_id = p.id AND o.created_at >= NOW() - INTERVAL '24 hours'
           ) as buy_pressure
    FROM players p
    WHERE p.is_active = true
    ORDER BY p.volume_24h DESC
    LIMIT 50
  `;
  const t6End = performance.now();
  console.log(`   Players with all metrics: ${withAllCorrelated.length}`);
  console.log(`   ⏱️  Time: ${(t6End - t6Start).toFixed(2)}ms`);

  // Test 7: OPTIMIZED - Using LEFT JOINs instead of correlated subqueries
  console.log("\n📊 Test 7: OPTIMIZED - Using LEFT JOINs instead of correlated subqueries");
  const t7Start = performance.now();
  const withJoins = await sql`
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
    LIMIT 50
  `;
  const t7End = performance.now();
  console.log(`   Players with all metrics (optimized): ${withJoins.length}`);
  console.log(`   ⏱️  Time: ${(t7End - t7Start).toFixed(2)}ms`);

  // Test 8: Order book count for context
  console.log("\n📊 Test 8: Order book size");
  const t8Start = performance.now();
  const orderCount =
    await sql`SELECT COUNT(*) as count FROM orders WHERE status IN ('open', 'partial')`;
  const t8End = performance.now();
  console.log(`   Open/partial orders: ${orderCount[0].count}`);
  console.log(`   ⏱️  Time: ${(t8End - t8Start).toFixed(2)}ms`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📈 PERFORMANCE SUMMARY");
  console.log("=".repeat(60));
  console.log(`\nCurrent (correlated subqueries): ${(t6End - t6Start).toFixed(2)}ms`);
  console.log(`Optimized (LEFT JOINs):          ${(t7End - t7Start).toFixed(2)}ms`);

  const improvement = ((t6End - t6Start - (t7End - t7Start)) / (t6End - t6Start)) * 100;
  if (improvement > 0) {
    console.log(`\n✅ Potential speedup: ${improvement.toFixed(1)}% faster`);
  } else {
    console.log(
      `\n⚠️  JOIN approach was ${Math.abs(improvement).toFixed(1)}% slower (may need index tuning)`,
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("💡 RECOMMENDATIONS");
  console.log("=".repeat(60));
  console.log(`
1. Replace correlated subqueries with CTEs + LEFT JOINs
   - Current: Runs 3+ subqueries PER row
   - Optimized: Single pass with 3 pre-aggregated CTEs

2. Add missing database indexes:
   - CREATE INDEX idx_orders_player_status_side ON orders(player_id, status, side)
   - CREATE INDEX idx_orders_created_at ON orders(created_at DESC)

3. Consider caching:
   - Cache player list responses for 5-10 seconds
   - Use Redis or in-memory cache for order book aggregates
  `);
}

main().catch(console.error);
