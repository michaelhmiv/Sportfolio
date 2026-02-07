import "dotenv/config";
import { db } from "../server/db";
import { dailyGames } from "@shared/schema";
import { eq, asc, and, lte, gte, inArray, sql } from "drizzle-orm";

async function cleanupDuplicateGames() {
  console.log("=== Cleaning up duplicate game records ===\n");

  // Get all NBA games with potential duplicates (gameId starting with 18447 - MySportsFeeds legacy)
  // These are the legacy records we want to remove
  const legacyIds = await db
    .select({ id: dailyGames.id, gameId: dailyGames.gameId })
    .from(dailyGames)
    .where(sql`${dailyGames.gameId} LIKE '18447%'`)
    .limit(500);

  console.log(
    `Found ${legacyIds.length} legacy MySportsFeeds records (gameId starting with 18447)`,
  );

  if (legacyIds.length === 0) {
    console.log("No legacy records to clean up.");
    return;
  }

  // Check if there are BallDontLie equivalents for each legacy record
  let deletedCount = 0;
  let keptCount = 0;

  for (const legacy of legacyIds) {
    // Parse the legacy record to get teams and time
    const legacyRecord = await db.select().from(dailyGames).where(eq(dailyGames.id, legacy.id));

    if (legacyRecord.length === 0) continue;
    const rec = legacyRecord[0];

    // Check if there's a BallDontLie equivalent (6-digit gameId) for the same teams at the same time
    // Use a fuzzy match on startTime (within 5 minutes)
    const startTime = new Date(rec.startTime);
    const minTime = new Date(startTime.getTime() - 5 * 60 * 1000);
    const maxTime = new Date(startTime.getTime() + 5 * 60 * 1000);

    const possibleMatches = await db
      .select()
      .from(dailyGames)
      .where(
        and(
          eq(dailyGames.sport, "NBA"),
          sql`${dailyGames.gameId} NOT LIKE '18447%'`,
          sql`${dailyGames.awayTeam} = ${rec.awayTeam}`,
          sql`${dailyGames.homeTeam} = ${rec.homeTeam}`,
          sql`${dailyGames.startTime} >= ${minTime}`,
          sql`${dailyGames.startTime} <= ${maxTime}`,
        ),
      );

    if (possibleMatches.length > 0) {
      // There's a BallDontLie equivalent - delete the legacy record
      console.log(
        `Deleting legacy ${legacy.gameId} (${rec.awayTeam}@${rec.homeTeam}) - BDL equivalent exists: ${possibleMatches[0].gameId}`,
      );
      await db.delete(dailyGames).where(eq(dailyGames.id, rec.id));
      deletedCount++;
    } else {
      // No equivalent - keep this record (it's the only one we have)
      console.log(`Keeping ${legacy.gameId} (${rec.awayTeam}@${rec.homeTeam}) - no BDL equivalent`);
      keptCount++;
    }
  }

  console.log(`\n=== Cleanup Complete ===`);
  console.log(`Legacy records deleted: ${deletedCount}`);
  console.log(`Legacy records kept (no BDL equivalent): ${keptCount}`);
}

cleanupDuplicateGames().catch(console.error);
