import { db } from "../db";
import { holdings, players, userCollections } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { broadcastToUser } from "../websocket";

// Collection types configuration
const COLLECTION_CONFIG = {
  team: {
    // Team collections: collect all active players from a team
    checkCriteria: async (userId: string, teamAbbr: string) => {
      // Get all active players from this team
      const teamPlayers = await db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.team, teamAbbr), eq(players.isActive, true)));

      const totalPlayers = teamPlayers.length;
      if (totalPlayers === 0) return { progress: 0, total: 0 };

      const playerIds = teamPlayers.map((p: { id: string }) => p.id);

      // Count how many of these players the user owns
      const userHoldings = await db
        .select({ playerId: holdings.assetId })
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            inArray(holdings.assetId, playerIds),
            sql`${holdings.quantity} > 0`,
          ),
        );

      return {
        progress: userHoldings.length,
        total: totalPlayers,
      };
    },
  },
  rookie: {
    // Rookie Hunter: own 5+ rookies
    checkCriteria: async (userId: string) => {
      // For now, we'll consider all players as potential rookies
      // In a real implementation, you'd have a isRookie flag or check years in league
      const targetCount = 5;

      const rookieHoldings = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${holdings.assetId})` })
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            sql`${holdings.quantity} > 0`,
          ),
        );

      return {
        progress: Math.min(rookieHoldings[0]?.count || 0, targetCount),
        total: targetCount,
      };
    },
  },
  position: {
    // Position Master: own players from all positions (PG, SG, SF, PF, C)
    checkCriteria: async (userId: string) => {
      const positions = ["PG", "SG", "SF", "PF", "C"];

      // Get unique positions the user owns
      const ownedPositions = await db
        .select({ position: players.position })
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            sql`${holdings.quantity} > 0`,
            inArray(players.position, positions),
          ),
        )
        .groupBy(players.position);

      return {
        progress: ownedPositions.length,
        total: positions.length,
      };
    },
  },
  allstar: {
    // All-Star Collector: own 10+ all-star caliber players (marketCap > $1M)
    checkCriteria: async (userId: string) => {
      const targetCount = 10;
      const minMarketCap = 1000000; // $1M

      const allstarHoldings = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${holdings.assetId})` })
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            sql`${holdings.quantity} > 0`,
            sql`${players.marketCap} >= ${minMarketCap}`,
          ),
        );

      return {
        progress: Math.min(allstarHoldings[0]?.count || 0, targetCount),
        total: targetCount,
      };
    },
  },
};

// Get all teams that have active players
async function getActiveTeams(): Promise<string[]> {
  const result = await db
    .select({ team: players.team })
    .from(players)
    .where(eq(players.isActive, true))
    .groupBy(players.team);

  return result.map((r: { team: string }) => r.team);
}

// Get all users with holdings
async function getActiveUsers(): Promise<string[]> {
  const result = await db
    .select({ userId: holdings.userId })
    .from(holdings)
    .where(sql`${holdings.quantity} > 0`)
    .groupBy(holdings.userId);

  return result.map((r: { userId: string }) => r.userId);
}

// Update collections for a specific user
async function updateUserCollections(userId: string): Promise<void> {
  const teams = await getActiveTeams();

  // Check team collections
  for (const team of teams) {
    const { progress, total } = await COLLECTION_CONFIG.team.checkCriteria(userId, team);

    if (total > 0) {
      // Check if collection record exists
      const existing = await db
        .select()
        .from(userCollections)
        .where(
          and(
            eq(userCollections.userId, userId),
            eq(userCollections.collectionType, "team"),
            eq(userCollections.targetId, team),
          ),
        )
        .limit(1);

      const wasCompleted = existing[0]?.completed || false;
      const isNowCompleted = progress >= total;

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(userCollections)
          .set({
            progress,
            completed: isNowCompleted,
            completedAt: isNowCompleted && !wasCompleted ? new Date() : existing[0].completedAt,
            updatedAt: new Date(),
          })
          .where(eq(userCollections.id, existing[0].id));
      } else {
        // Create new record
        await db.insert(userCollections).values({
          userId,
          collectionType: "team",
          targetId: team,
          progress,
          total,
          completed: isNowCompleted,
          completedAt: isNowCompleted ? new Date() : null,
        });
      }

      // Broadcast completion if newly completed
      if (isNowCompleted && !wasCompleted) {
        broadcastToUser(userId, {
          type: "marketActivity",
          data: {
            collectionType: "team",
            targetId: team,
            progress,
            total,
            event: "collection_completed",
          },
        });
      }
    }
  }

  // Check other collection types
  const nonTeamConfigs = {
    rookie: COLLECTION_CONFIG.rookie,
    position: COLLECTION_CONFIG.position,
    allstar: COLLECTION_CONFIG.allstar,
  };

  for (const [collectionType, config] of Object.entries(nonTeamConfigs)) {
    const { progress, total } = await config.checkCriteria(userId);

    if (total > 0) {
      const existing = await db
        .select()
        .from(userCollections)
        .where(
          and(
            eq(userCollections.userId, userId),
            eq(userCollections.collectionType, collectionType),
            eq(userCollections.targetId, collectionType), // Use type as target for non-team collections
          ),
        )
        .limit(1);

      const wasCompleted = existing[0]?.completed || false;
      const isNowCompleted = progress >= total;

      if (existing.length > 0) {
        await db
          .update(userCollections)
          .set({
            progress,
            completed: isNowCompleted,
            completedAt: isNowCompleted && !wasCompleted ? new Date() : existing[0].completedAt,
            updatedAt: new Date(),
          })
          .where(eq(userCollections.id, existing[0].id));
      } else {
        await db.insert(userCollections).values({
          userId,
          collectionType,
          targetId: collectionType,
          progress,
          total,
          completed: isNowCompleted,
          completedAt: isNowCompleted ? new Date() : null,
        });
      }

      if (isNowCompleted && !wasCompleted) {
        broadcastToUser(userId, {
          type: "marketActivity",
          data: {
            collectionType,
            targetId: collectionType,
            progress,
            total,
            event: "collection_completed",
          },
        });
      }
    }
  }
}

// Main job function
export async function updateCollectionsJob(): Promise<void> {
  console.log("[Collections Job] Starting collection update...");
  const startTime = Date.now();

  try {
    // Guard: this job depends on the user_collections table.
    // If the DB is behind migrations (common when swapping providers), skip instead of spamming logs.
    try {
      await db.select({ id: userCollections.id }).from(userCollections).limit(1);
    } catch (err: any) {
      if (err?.code === "42P01") {
        console.warn(
          "[Collections Job] Skipping: user_collections table does not exist (migrations not applied)",
        );
        return;
      }
      throw err;
    }

    const users = await getActiveUsers();
    console.log(`[Collections Job] Updating collections for ${users.length} users...`);

    for (const userId of users) {
      try {
        await updateUserCollections(userId);
      } catch (error) {
        console.error(`[Collections Job] Error updating collections for user ${userId}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Collections Job] Completed in ${duration}ms`);
  } catch (error) {
    console.error("[Collections Job] Fatal error:", error);
    throw error;
  }
}
