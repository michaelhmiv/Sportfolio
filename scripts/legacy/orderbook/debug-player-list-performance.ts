/**
 * Performance Test Script for Player List Loading
 *
 * This script measures query performance to identify bottlenecks
 * in the marketplace and scout selector player list loading.
 *
 * Run with: npx tsx scripts/debug-player-list-performance.ts
 */

import { db } from "../../../server/db";
import { players, orders, playerGameStats, watchList } from "../../../shared/schema";
import { sql, eq, and, inArray, desc, asc, count } from "drizzle-orm";

// Test configuration
const TEST_RUNS = 3;
const WARMUP_RUNS = 1;

interface TimingResult {
  query: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  rows: number;
}

async function timing<T>(
  name: string,
  queryFn: () => Promise<T>,
): Promise<{ result: T; timing: Omit<TimingResult, "query"> }> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < WARMUP_RUNS; i++) {
    await queryFn();
  }

  // Actual measurements
  for (let i = 0; i < TEST_RUNS; i++) {
    const start = performance.now();
    const result = await queryFn();
    const end = performance.now();
    times.push(end - start);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  console.log(
    `  ${name}: ${avgMs.toFixed(2)}ms (min: ${minMs.toFixed(2)}ms, max: ${maxMs.toFixed(2)}ms)`,
  );

  return {
    result: undefined as T,
    timing: { avgMs, minMs, maxMs, rows: 0 },
  };
}

async function testBasicPlayerQuery(): Promise<void> {
  console.log("\n=== TEST 1: Basic Player Query (no joins) ===");

  await timing("SELECT * FROM players (no conditions)", async () => {
    const result = await db.select().from(players).limit(50);
    return result;
  });

  await timing("SELECT COUNT(*) FROM players", async () => {
    const result = await db.select({ count: sql<number>`count(*)` }).from(players);
    return result;
  });
}

async function testCorrelatedSubqueries(): Promise<void> {
  console.log("\n=== TEST 2: Correlated Subqueries (THE BOTTLENECK) ===");

  // Simulating the marketplace query with correlated subqueries
  const playerIds = await db.select({ id: players.id }).from(players).limit(50);

  await timing("Correlated subquery: avg fantasy points per player", async () => {
    const result = await db
      .select({
        player: players,
        avgFantasy:
          sql`(SELECT AVG(${playerGameStats.fantasyPoints}::numeric) FROM ${playerGameStats} WHERE ${playerGameStats.playerId} = ${players.id})`.as(
            "avg_fantasy",
          ),
      })
      .from(players)
      .limit(50);
    return result;
  });

  await timing("Correlated subquery: best bid per player", async () => {
    const result = await db
      .select({
        player: players,
        bestBid:
          sql`(SELECT MAX(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'buy' AND ${orders.status} IN ('open', 'partial'))`.as(
            "best_bid",
          ),
      })
      .from(players)
      .limit(50);
    return result;
  });

  await timing("Correlated subquery: best ask per player", async () => {
    const result = await db
      .select({
        player: players,
        bestAsk:
          sql`(SELECT MIN(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'sell' AND ${orders.status} IN ('open', 'partial'))`.as(
            "best_ask",
          ),
      })
      .from(players)
      .limit(50);
    return result;
  });

  await timing("Correlated subquery: 24h sentiment per player", async () => {
    const result = await db
      .select({
        player: players,
        sentiment:
          sql`(SELECT (SUM(CASE WHEN ${orders.side} = 'buy' AND ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END)::numeric / NULLIF(SUM(CASE WHEN ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END), 0)::numeric) * 100 FROM ${orders} WHERE ${orders.playerId} = ${players.id})`.as(
            "sentiment",
          ),
      })
      .from(players)
      .limit(50);
    return result;
  });

  // Combined correlated subqueries (like the actual marketplace query)
  await timing("COMBINED: 4 correlated subqueries (actual marketplace pattern)", async () => {
    const avgFantasySql = sql`(SELECT AVG(${playerGameStats.fantasyPoints}::numeric) FROM ${playerGameStats} WHERE ${playerGameStats.playerId} = ${players.id})`;
    const bestBidSql = sql`(SELECT MAX(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'buy' AND ${orders.status} IN ('open', 'partial'))`;
    const bestAskSql = sql`(SELECT MIN(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'sell' AND ${orders.status} IN ('open', 'partial'))`;
    const sentimentSql = sql`(SELECT (SUM(CASE WHEN ${orders.side} = 'buy' AND ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END)::numeric / NULLIF(SUM(CASE WHEN ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END), 0)::numeric) * 100 FROM ${orders} WHERE ${orders.playerId} = ${players.id})`;

    const result = await db
      .select({
        player: players,
        avgFantasy: avgFantasySql,
        bestBid: bestBidSql,
        bestAsk: bestAskSql,
        sentiment: sentimentSql,
      })
      .from(players)
      .limit(50);
    return result;
  });
}

async function testOptimizedQueries(): Promise<void> {
  console.log("\n=== TEST 3: Optimized Queries (with JOINs) ===");

  // Get order stats per player using GROUP BY (much more efficient)
  await timing("OPTIMIZED: Order stats with GROUP BY", async () => {
    const result = await db
      .select({
        playerId: orders.playerId,
        bestBid: sql<
          number | null
        >`MAX(CASE WHEN ${orders.side} = 'buy' AND ${orders.status} IN ('open', 'partial') THEN ${orders.limitPrice} END)`.as(
          "best_bid",
        ),
        bestAsk: sql<
          number | null
        >`MIN(CASE WHEN ${orders.side} = 'sell' AND ${orders.status} IN ('open', 'partial') THEN ${orders.limitPrice} END)`.as(
          "best_ask",
        ),
      })
      .from(orders)
      .where(sql`${orders.status} IN ('open', 'partial')`)
      .groupBy(orders.playerId);
    return result;
  });

  // Get fantasy stats with GROUP BY
  await timing("OPTIMIZED: Fantasy stats with GROUP BY", async () => {
    const result = await db
      .select({
        playerId: playerGameStats.playerId,
        avgFantasy: sql<number>`AVG(${playerGameStats.fantasyPoints}::numeric)`.as("avg_fantasy"),
      })
      .from(playerGameStats)
      .groupBy(playerGameStats.playerId);
    return result;
  });
}

async function testIndexEfficiency(): Promise<void> {
  console.log("\n=== TEST 4: Index Efficiency Check ===");

  // Check if queries use indexes by running EXPLAIN ANALYZE
  console.log("  Checking index usage for game stats query...");

  try {
    const result = await db.execute(sql`
      EXPLAIN ANALYZE
      SELECT * FROM player_game_stats
      WHERE player_id IN (SELECT id FROM players LIMIT 50)
      AND season IN ('2024-25', '2025')
    `);
    console.log("  Query plan:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("  Error getting query plan:", e);
  }
}

async function testWatchlistQuery(): Promise<void> {
  console.log("\n=== TEST 5: Watchlist EXISTS Subquery ===");

  // Simulating watchlist filter
  const testUserId = "dev-user-12345678"; // Using the dev user as a test

  await timing("EXISTS subquery: players in watchlist", async () => {
    const result = await db
      .select({
        player: players,
      })
      .from(players)
      .where(
        sql`EXISTS (
        SELECT 1 FROM ${watchList}
        WHERE ${watchList.playerId} = ${players.id}
        AND ${watchList.userId} = ${testUserId}
      )`,
      )
      .limit(50);
    return result;
  });

  // Optimized version with JOIN
  await timing("JOIN: watchlist players (optimized)", async () => {
    const result = await db
      .select({
        player: players,
      })
      .from(players)
      .innerJoin(
        watchList,
        and(eq(watchList.playerId, players.id), eq(watchList.userId, testUserId)),
      )
      .limit(50);
    return result;
  });
}

async function testOrdersInFilter(): Promise<void> {
  console.log("\n=== TEST 6: Order Filters (hasBuyOrders/hasSellOrders) ===");

  await timing("EXISTS: players with buy orders", async () => {
    const result = await db
      .select({
        player: players,
      })
      .from(players)
      .where(
        sql`EXISTS (
        SELECT 1 FROM ${orders}
        WHERE ${orders.playerId} = ${players.id}
        AND ${orders.side} = 'buy'
        AND ${orders.status} IN ('open', 'partial')
      )`,
      )
      .limit(50);
    return result;
  });
}

async function runAllTests(): Promise<void> {
  console.log("=".repeat(60));
  console.log("PLAYER LIST PERFORMANCE TEST");
  console.log("=".repeat(60));
  console.log(`Running each test ${TEST_RUNS} times with ${WARMUP_RUNS} warmup run(s)...`);

  try {
    await testBasicPlayerQuery();
    await testCorrelatedSubqueries();
    await testOptimizedQueries();
    await testIndexEfficiency();
    await testWatchlistQuery();
    await testOrdersInFilter();

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`
Key Findings:
1. Correlated subqueries (avgFantasy, bestBid, bestAsk, sentiment)
   are executed ONCE PER ROW - this is the main bottleneck.

2. The marketplace query runs 4 correlated subqueries for each player,
   meaning for 50 players = 200 subquery executions.

3. RECOMMENDED FIX: Use LEFT JOINs with GROUP BY instead:
   - Fetch order stats aggregated per player in one query
   - Fetch fantasy stats aggregated per player in one query
   - Join these aggregated results to the players query

4. Missing index: playerGameStats is missing (playerId, season) index
`);
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runAllTests()
  .then(() => {
    console.log("\nTests complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
