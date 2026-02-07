import "dotenv/config";
import { db } from "../server/db";
import { scoutHistory, scoutDistributions, scoutAssignments } from "../shared/schema";
import { eq, gte, and, sql } from "drizzle-orm";

async function verifyImplementation() {
  console.log("=== SCOUT DISTRIBUTION IMPLEMENTATION VERIFICATION ===\n");

  // Test the exact formula from the code
  const hourEnd = new Date("2026-01-20T17:00:00Z");
  const hourStart = new Date("2026-01-20T16:00:00Z");
  const hourEndISO = hourEnd.toISOString();
  const hourStartISO = hourStart.toISOString();

  console.log(`Window: ${hourStartISO} to ${hourEndISO}\n`);

  // Replicate the exact CTE from scout-distribution.ts
  console.log("Running CTE from scout-distribution.ts...\n");

  const result = await db.execute(sql`
    WITH active_users AS (
      SELECT id
      FROM users
      WHERE last_active_at > ${hourStartISO}::timestamp - INTERVAL '24 hours'
    ),
    history_periods AS (
      SELECT
        sh.user_id,
        sh.player_id,
        sh.scout_count,
        GREATEST(sh.started_at, ${hourStartISO}::timestamp) as effective_start,
        LEAST(COALESCE(sh.ended_at, ${hourEndISO}::timestamp), ${hourEndISO}::timestamp) as effective_end
      FROM scout_history sh
      JOIN active_users u ON sh.user_id = u.id
      WHERE
        sh.started_at < ${hourEndISO}::timestamp
        AND (sh.ended_at IS NULL OR sh.ended_at > ${hourStartISO}::timestamp)
    ),
    calculated_minutes AS (
      SELECT
        user_id,
        player_id,
        scout_count,
        EXTRACT(EPOCH FROM (effective_end - effective_start)) / 60.0 as duration_minutes
      FROM history_periods
      WHERE effective_end > effective_start
    ),
    user_totals AS (
      SELECT
        user_id,
        player_id,
        SUM(scout_count * duration_minutes) as user_scout_minutes
      FROM calculated_minutes
      GROUP BY user_id, player_id
    ),
    player_totals AS (
      SELECT
        player_id,
        SUM(user_scout_minutes) as global_scout_minutes
      FROM user_totals
      GROUP BY player_id
    )
    SELECT
      ut.user_id as "userId",
      ut.player_id as "playerId",
      ut.user_scout_minutes as "userScoutMinutes",
      pt.global_scout_minutes as "globalScoutMinutes",
      FLOOR((60.0 * ut.user_scout_minutes / pt.global_scout_minutes) * 100) / 100 as "sharesEarned",
      ROUND((60.0 * ut.user_scout_minutes / pt.global_scout_minutes)::numeric, 2) as "sharesExact"
    FROM user_totals ut
    JOIN player_totals pt ON ut.player_id = pt.player_id
    WHERE pt.global_scout_minutes > 0
    ORDER BY ut.player_id, ut.user_scout_minutes DESC
  `);

  const rows = result.rows as any[];

  // Group by player
  const byPlayer: Record<string, any[]> = {};
  rows.forEach((row) => {
    if (!byPlayer[row.playerId]) byPlayer[row.playerId] = [];
    byPlayer[row.playerId].push(row);
  });

  console.log("=== VERIFICATION BY PLAYER ===\n");

  let totalVerified = 0;
  let totalDiscrepancy = 0;

  for (const [playerId, playerRows] of Object.entries(byPlayer)) {
    console.log(`Player: ${playerId}`);
    console.log("-".repeat(60));

    // Get player name from assignments
    // (simplified - just showing playerId)

    let playerTotalShares = 0;
    let playerTotalMinutes = 0;

    playerRows.forEach((row, idx) => {
      const expectedFormula =
        (60 * parseFloat(row.userScoutMinutes)) / parseFloat(row.globalScoutMinutes);
      const roundedFormula = Math.floor(expectedFormula * 100) / 100;
      const sharesEarned = parseFloat(row.sharesEarned);
      const discrepancy = Math.abs(roundedFormula - sharesEarned);

      playerTotalShares += sharesEarned;
      playerTotalMinutes += parseFloat(row.userScoutMinutes);

      const isDevUser = row.userId === "dev-user-12345678";

      console.log(`  ${isDevUser ? "★ " : "  "}User ${row.userId.substring(0, 8)}...`);
      console.log(
        `     Formula: (60 × ${parseFloat(row.userScoutMinutes).toFixed(1)}) / ${parseFloat(row.globalScoutMinutes).toFixed(1)}`,
      );
      console.log(`     Expected (rounded): ${roundedFormula.toFixed(2)}`);
      console.log(`     Actual shares: ${sharesEarned.toFixed(2)}`);
      console.log(`     Discrepancy: ${discrepancy > 0 ? "⚠️ " + discrepancy.toFixed(2) : "✓"}`);

      if (discrepancy > 0.01) {
        totalDiscrepancy++;
        console.log(`     *** DISCREPANCY FOUND! ***`);
      }
      console.log("");
    });

    console.log(
      `  Player Total: ${playerTotalShares.toFixed(2)} / 60 shares (${((playerTotalShares / 60) * 100).toFixed(1)}%)`,
    );
    console.log(`\n`);
  }

  console.log("=== SUMMARY ===");
  console.log(`Total players processed: ${Object.keys(byPlayer).length}`);
  console.log(`Total distribution rows: ${rows.length}`);
  console.log(`Discrepancies found: ${totalDiscrepancy}`);

  // Now compare with actual scout_distributions records
  console.log("\n=== COMPARISON WITH ACTUAL DB RECORDS ===");

  const actualDists = await db
    .select()
    .from(scoutDistributions)
    .where(eq(scoutDistributions.hourTimestamp, hourEnd));

  console.log(`Records in scout_distributions for ${hourEndISO}: ${actualDists.length}`);

  let dbMatchCount = 0;
  let dbMismatchCount = 0;

  for (const actual of actualDists) {
    const calcRow = rows.find((r) => r.playerId === actual.playerId && r.userId === actual.userId);

    if (calcRow) {
      const calcShares = parseFloat(calcRow.sharesEarned);
      const dbShares = parseFloat(actual.sharesEarned.toString());
      const match = Math.abs(calcShares - dbShares) < 0.01;

      console.log(`Player ${actual.playerId} | User ${actual.userId.substring(0, 8)}...`);
      console.log(
        `  Calculated: ${calcShares.toFixed(2)} | In DB: ${dbShares.toFixed(2)} | ${match ? "✓" : "⚠️ MISMATCH"}`,
      );

      if (!match) dbMismatchCount++;
      else dbMatchCount++;
    }
  }

  console.log(`\nDB Records Match: ${dbMatchCount}`);
  console.log(`DB Records Mismatched: ${dbMismatchCount}`);

  if (dbMismatchCount === 0) {
    console.log("\n✅ IMPLEMENTATION IS CORRECT - All calculations match the database!");
  } else {
    console.log("\n❌ ISSUES FOUND - There are mismatches between calculation and stored values");
  }
}

verifyImplementation().catch(console.error);
