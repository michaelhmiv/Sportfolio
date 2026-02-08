import { db } from "../db";
import { users, userMilestones, trades, holdings, players } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { broadcastToUser } from "../websocket";

// Milestone thresholds
const MILESTONE_THRESHOLDS = {
  netWorth: [1000, 10000, 100000, 1000000, 10000000],
  portfolioValue: [1000, 10000, 100000, 1000000, 10000000],
  totalTrades: [10, 50, 100, 500, 1000],
};

// Calculate user's net worth (cash + portfolio value)
async function calculateNetWorth(userId: string): Promise<number> {
  const user = await db
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user[0]) return 0;

  // Get portfolio value from holdings
  const portfolioValue = await db
    .select({
      totalValue: sql<number>`SUM(${holdings.quantity} * ${players.currentPrice})`,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.assetType, "player"),
        sql`${holdings.quantity} > 0`,
      ),
    );

  const cashBalance = parseFloat(user[0].balance);
  const portfolio = portfolioValue[0]?.totalValue || 0;

  return cashBalance + portfolio;
}

// Calculate user's total trades
async function calculateTotalTrades(userId: string): Promise<number> {
  const [buyTrades, sellTrades] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(eq(trades.buyerId, userId)),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .where(eq(trades.sellerId, userId)),
  ]);

  return (buyTrades[0]?.count || 0) + (sellTrades[0]?.count || 0);
}

// Check and create milestones for a user
async function checkUserMilestones(userId: string): Promise<void> {
  // Get current stats
  const netWorth = await calculateNetWorth(userId);
  const totalTrades = await calculateTotalTrades(userId);

  // Check net worth milestones
  for (const threshold of MILESTONE_THRESHOLDS.netWorth) {
    if (netWorth >= threshold) {
      await createMilestoneIfNotExists(userId, "netWorth", threshold);
    }
  }

  // Check total trades milestones
  for (const threshold of MILESTONE_THRESHOLDS.totalTrades) {
    if (totalTrades >= threshold) {
      await createMilestoneIfNotExists(userId, "totalTrades", threshold);
    }
  }
}

// Create milestone record if it doesn't exist
async function createMilestoneIfNotExists(
  userId: string,
  milestoneType: string,
  threshold: number,
): Promise<void> {
  // Check if milestone already exists
  const existing = await db
    .select()
    .from(userMilestones)
    .where(
      and(
        eq(userMilestones.userId, userId),
        eq(userMilestones.milestoneType, milestoneType),
        eq(userMilestones.threshold, threshold.toString()),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    // Create new milestone
    await db.insert(userMilestones).values({
      userId,
      milestoneType,
      threshold: threshold.toString(),
      achievedAt: new Date(),
      celebrated: false,
    });

    // Broadcast to user
    broadcastToUser(userId, {
      type: "marketActivity",
      data: {
        milestoneType,
        threshold,
        achievedAt: new Date().toISOString(),
        event: "milestone_achieved",
      },
    });

    console.log(`[Milestones] User ${userId} achieved ${milestoneType} milestone: ${threshold}`);
  }
}

// Get all users
async function getAllUsers(): Promise<string[]> {
  const result = await db.select({ id: users.id }).from(users);
  return result.map((r: { id: string }) => r.id);
}

// Main job function
export async function checkMilestonesJob(): Promise<void> {
  console.log("[Milestones Job] Starting milestone check...");
  const startTime = Date.now();

  try {
    // Guard: this job depends on the user_milestones table.
    // If the DB is behind migrations, skip instead of generating per-user errors.
    try {
      await db.select({ id: userMilestones.id }).from(userMilestones).limit(1);
    } catch (err: any) {
      if (err?.code === "42P01") {
        console.warn(
          "[Milestones Job] Skipping: user_milestones table does not exist (migrations not applied)",
        );
        return;
      }
      throw err;
    }

    const usersList = await getAllUsers();
    console.log(`[Milestones Job] Checking milestones for ${usersList.length} users...`);

    for (const userId of usersList) {
      try {
        await checkUserMilestones(userId);
      } catch (error) {
        console.error(`[Milestones Job] Error checking milestones for user ${userId}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Milestones Job] Completed in ${duration}ms`);
  } catch (error) {
    console.error("[Milestones Job] Fatal error:", error);
    throw error;
  }
}
