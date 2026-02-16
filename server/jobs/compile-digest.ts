/**
 * Daily Digest Compilation Job
 *
 * Runs at 6:00 AM ET daily to compile personalized news digests for each user.
 * Uses raw database queries - NO AI API calls.
 *
 * Content includes:
 * - Contest Results: Settled contests in last 24h
 * - Portfolio Health: 24h net worth change, top 3 movers
 * - Vesting Stats: 7-day totals and rolling average
 * - Global Market Movers: Top 5 biggest price changes
 */

import { db } from "../db";
import {
  users,
  contests,
  contestEntries,
  portfolioSnapshots,
  holdings,
  players,
  vestingClaims,
  scoutDistributions,
  scoutAssignments,
  dailyBoosts,
  boostPayouts,
  sharePayouts,
  trades,
} from "@shared/schema";
import { desc, eq, gte, and, sql, lte, lt, or } from "drizzle-orm";
import type { ProgressCallback } from "../lib/admin-stream";
import { getETDayBoundaries, getGameDay, getTodayET } from "../lib/time";

export interface DigestSection {
  title: string;
  items: Array<{
    label: string;
    value: string;
    change?: string;
    isPositive?: boolean;
  }>;
}

export interface DigestSummaryItem {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
}

export interface UserDigest {
  userId: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  summary: DigestSummaryItem[];
  sections: DigestSection[];
}

type DigestWindow = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  label: string;
};

const asNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
const formatSignedCurrency = (value: number) =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
const formatSignedPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

function getDigestWindow(): DigestWindow {
  const todayET = getTodayET();
  const { startOfDay: todayStart } = getETDayBoundaries(todayET);

  const yesterdayMarker = new Date(todayStart.getTime() - 60_000);
  const yesterdayET = getGameDay(yesterdayMarker);
  const { startOfDay: yesterdayStart, endOfDay: yesterdayEnd } = getETDayBoundaries(yesterdayET);

  const previousMarker = new Date(yesterdayStart.getTime() - 60_000);
  const previousET = getGameDay(previousMarker);
  const { startOfDay: previousStart, endOfDay: previousEnd } = getETDayBoundaries(previousET);

  return {
    start: yesterdayStart,
    end: yesterdayEnd,
    previousStart,
    previousEnd,
    label: yesterdayET,
  };
}

/**
 * Get contest results for a user from the last 24 hours
 */
async function getUserContestResults(userId: string, since: Date): Promise<DigestSection | null> {
  const entries = await db
    .select({
      contestName: contests.name,
      rank: contestEntries.rank,
      payout: contestEntries.payout,
      totalSharesEntered: contestEntries.totalSharesEntered,
      entryCount: contests.entryCount,
    })
    .from(contestEntries)
    .innerJoin(contests, eq(contestEntries.contestId, contests.id))
    .where(
      and(
        eq(contestEntries.userId, userId),
        eq(contests.status, "completed"),
        gte(contests.endsAt, since),
      ),
    )
    .limit(10);

  if (entries.length === 0) return null;

  return {
    title: "Contest Results",
    items: entries.map((e) => ({
      label: e.contestName,
      value: `Rank #${e.rank || "?"} of ${e.entryCount}`,
      change: e.payout ? `+$${parseFloat(e.payout).toFixed(2)}` : undefined,
      isPositive: parseFloat(e.payout || "0") > 0,
    })),
  };
}

/**
 * Get portfolio health metrics for a user
 */
async function getPortfolioHealth(userId: string): Promise<DigestSection | null> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Get latest and 24h ago snapshots
  const snapshots = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.snapshotDate))
    .limit(2);

  if (snapshots.length === 0) return null;

  const latest = snapshots[0];
  const previous = snapshots[1];

  const currentNetWorth = parseFloat(latest.totalNetWorth);
  const prevNetWorth = previous ? parseFloat(previous.totalNetWorth) : currentNetWorth;
  const change = currentNetWorth - prevNetWorth;
  const changePercent = prevNetWorth > 0 ? (change / prevNetWorth) * 100 : 0;

  // Get top 3 biggest movers in user's holdings
  const userHoldings = await db
    .select({
      playerId: holdings.assetId,
      quantity: holdings.quantity,
      firstName: players.firstName,
      lastName: players.lastName,
      priceChange24h: players.priceChange24h,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player")))
    .orderBy(desc(sql`ABS(${players.priceChange24h})`))
    .limit(3);

  const items: DigestSection["items"] = [
    {
      label: "Net Worth",
      value: `$${currentNetWorth.toFixed(2)}`,
      change: `${change >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`,
      isPositive: change >= 0,
    },
  ];

  userHoldings.forEach((h) => {
    const priceChange = parseFloat(h.priceChange24h || "0");
    items.push({
      label: `${h.firstName} ${h.lastName}`,
      value: `${h.quantity} shares`,
      change: `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(1)}%`,
      isPositive: priceChange >= 0,
    });
  });

  return {
    title: "Portfolio Health",
    items,
  };
}

/**
 * Get vesting stats for a user
 */
async function getVestingStats(userId: string): Promise<DigestSection | null> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const claims = await db
    .select({
      totalClaimed: sql<number>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`,
      claimCount: sql<number>`COUNT(*)`,
    })
    .from(vestingClaims)
    .where(and(eq(vestingClaims.userId, userId), gte(vestingClaims.claimedAt, sevenDaysAgo)));

  const stats = claims[0];
  if (!stats || stats.totalClaimed === 0) return null;

  const avgPerHour = stats.totalClaimed / (7 * 24);

  return {
    title: "Vesting Activity",
    items: [
      {
        label: "7-Day Shares Vested",
        value: `${stats.totalClaimed.toLocaleString()} shares`,
      },
      {
        label: "Average Rate",
        value: `${avgPerHour.toFixed(1)} shares/hour`,
      },
    ],
  };
}

/**
 * Get global market movers (top 5 up and down)
 */
async function getGlobalMarketMovers(): Promise<DigestSection> {
  const topGainers = await db
    .select({
      firstName: players.firstName,
      lastName: players.lastName,
      priceChange24h: players.priceChange24h,
      lastTradePrice: players.lastTradePrice,
    })
    .from(players)
    .where(and(eq(players.isActive, true), sql`${players.priceChange24h} IS NOT NULL`))
    .orderBy(desc(players.priceChange24h))
    .limit(5);

  const topLosers = await db
    .select({
      firstName: players.firstName,
      lastName: players.lastName,
      priceChange24h: players.priceChange24h,
      lastTradePrice: players.lastTradePrice,
    })
    .from(players)
    .where(and(eq(players.isActive, true), sql`${players.priceChange24h} IS NOT NULL`))
    .orderBy(players.priceChange24h)
    .limit(5);

  const items: DigestSection["items"] = [];

  topGainers.forEach((p) => {
    const change = parseFloat(p.priceChange24h || "0");
    if (change > 0) {
      items.push({
        label: `📈 ${p.firstName} ${p.lastName}`,
        value: `$${parseFloat(p.lastTradePrice || "0").toFixed(2)}`,
        change: `+${change.toFixed(1)}%`,
        isPositive: true,
      });
    }
  });

  topLosers.forEach((p) => {
    const change = parseFloat(p.priceChange24h || "0");
    if (change < 0) {
      items.push({
        label: `📉 ${p.firstName} ${p.lastName}`,
        value: `$${parseFloat(p.lastTradePrice || "0").toFixed(2)}`,
        change: `${change.toFixed(1)}%`,
        isPositive: false,
      });
    }
  });

  return {
    title: "Market Movers",
    items: items.slice(0, 10),
  };
}

async function getScoutActivitySection(
  userId: string,
  window: DigestWindow,
): Promise<{ section: DigestSection; sharesScouted: number }> {
  const [totals, activeScoutRow, topPlayers] = await Promise.all([
    db
      .select({
        sharesScouted: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as(
          "shares_scouted",
        ),
        scoutMinutes: sql<number>`COALESCE(SUM(${scoutDistributions.userScoutMinutes}), 0)`.as(
          "scout_minutes",
        ),
      })
      .from(scoutDistributions)
      .where(
        and(
          eq(scoutDistributions.userId, userId),
          gte(scoutDistributions.hourTimestamp, window.start),
          lt(scoutDistributions.hourTimestamp, window.end),
        ),
      ),
    db
      .select({
        totalScouts: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)`.as(
          "total_scouts",
        ),
      })
      .from(scoutAssignments)
      .where(eq(scoutAssignments.userId, userId)),
    db
      .select({
        firstName: players.firstName,
        lastName: players.lastName,
        sharesScouted: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as(
          "shares_scouted",
        ),
        scoutMinutes: sql<number>`COALESCE(SUM(${scoutDistributions.userScoutMinutes}), 0)`.as(
          "scout_minutes",
        ),
      })
      .from(scoutDistributions)
      .innerJoin(players, eq(scoutDistributions.playerId, players.id))
      .where(
        and(
          eq(scoutDistributions.userId, userId),
          gte(scoutDistributions.hourTimestamp, window.start),
          lt(scoutDistributions.hourTimestamp, window.end),
        ),
      )
      .groupBy(players.firstName, players.lastName)
      .orderBy(desc(sql`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`))
      .limit(3),
  ]);

  const totalSharesScouted = asNumber(totals[0]?.sharesScouted);
  const totalScoutMinutes = asNumber(totals[0]?.scoutMinutes);
  const activeScouts = asNumber(activeScoutRow[0]?.totalScouts);
  const efficiency = totalScoutMinutes > 0 ? totalSharesScouted / totalScoutMinutes : 0;

  const items: DigestSection["items"] = [
    {
      label: "Shares Scouted",
      value: `${totalSharesScouted.toFixed(2)} shares`,
    },
    {
      label: "Scout Minutes",
      value: `${Math.round(totalScoutMinutes).toLocaleString()} min`,
    },
    {
      label: "Scouting Efficiency",
      value: `${efficiency.toFixed(3)} shares/min`,
    },
    {
      label: "Active Scouts",
      value: `${Math.round(activeScouts)} assigned`,
    },
  ];

  topPlayers.forEach((player) => {
    const shares = asNumber(player.sharesScouted);
    const minutes = asNumber(player.scoutMinutes);
    items.push({
      label: `${player.firstName} ${player.lastName}`,
      value: `${shares.toFixed(2)} shares`,
      change: `${Math.round(minutes)} min`,
      isPositive: true,
    });
  });

  return {
    section: {
      title: "Scout Activity",
      items,
    },
    sharesScouted: totalSharesScouted,
  };
}

async function getBoostPerformanceSection(
  userId: string,
  window: DigestWindow,
): Promise<{ section: DigestSection; totalBoostPayout: number }> {
  const [boostsPlaced, payouts] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)`.as("count") })
      .from(dailyBoosts)
      .where(
        and(
          eq(dailyBoosts.userId, userId),
          gte(dailyBoosts.boostDate, window.start),
          lt(dailyBoosts.boostDate, window.end),
        ),
      ),
    db
      .select({
        firstName: players.firstName,
        lastName: players.lastName,
        payoutAmount: boostPayouts.payoutAmount,
        multiplier: boostPayouts.multiplier,
      })
      .from(boostPayouts)
      .innerJoin(players, eq(boostPayouts.playerId, players.id))
      .where(
        and(
          eq(boostPayouts.userId, userId),
          gte(boostPayouts.createdAt, window.start),
          lt(boostPayouts.createdAt, window.end),
        ),
      )
      .orderBy(desc(boostPayouts.payoutAmount)),
  ]);

  const boostsPlacedCount = asNumber(boostsPlaced[0]?.count);
  const settledCount = payouts.length;
  const totalBoostPayout = payouts.reduce((sum, payout) => sum + asNumber(payout.payoutAmount), 0);
  const positiveCount = payouts.filter((payout) => asNumber(payout.payoutAmount) > 0).length;
  const hitRate = boostsPlacedCount > 0 ? (positiveCount / boostsPlacedCount) * 100 : 0;

  const bestPayout = payouts[0];
  const lowestPayout = payouts[payouts.length - 1];

  const items: DigestSection["items"] = [
    {
      label: "Boosts Entered",
      value: boostsPlacedCount.toString(),
    },
    {
      label: "Boosts Settled",
      value: settledCount.toString(),
    },
    {
      label: "Hit Rate",
      value: `${hitRate.toFixed(1)}%`,
      isPositive: hitRate >= 50,
    },
    {
      label: "Total Boost Payout",
      value: formatCurrency(totalBoostPayout),
      change: formatSignedCurrency(totalBoostPayout),
      isPositive: totalBoostPayout >= 0,
    },
  ];

  if (bestPayout) {
    items.push({
      label: `Best Boost: ${bestPayout.firstName} ${bestPayout.lastName}`,
      value: formatCurrency(asNumber(bestPayout.payoutAmount)),
      change: `${bestPayout.multiplier}x slot`,
      isPositive: asNumber(bestPayout.payoutAmount) >= 0,
    });
  }

  if (lowestPayout && payouts.length > 1) {
    items.push({
      label: `Lowest Boost: ${lowestPayout.firstName} ${lowestPayout.lastName}`,
      value: formatCurrency(asNumber(lowestPayout.payoutAmount)),
      change: `${lowestPayout.multiplier}x slot`,
      isPositive: asNumber(lowestPayout.payoutAmount) >= 0,
    });
  }

  return {
    section: {
      title: "Boost Performance",
      items,
    },
    totalBoostPayout,
  };
}

async function getPortfolioAttributionSection(userId: string): Promise<DigestSection> {
  const heldPlayers = await db
    .select({
      quantity: holdings.quantity,
      firstName: players.firstName,
      lastName: players.lastName,
      lastTradePrice: players.lastTradePrice,
      priceChange24h: players.priceChange24h,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player")));

  const positions = heldPlayers
    .map((position) => {
      const quantity = asNumber(position.quantity);
      const price = asNumber(position.lastTradePrice);
      const priceChange24h = asNumber(position.priceChange24h);
      const marketValue = quantity * price;
      const estimatedContribution = marketValue * (priceChange24h / 100);

      return {
        name: `${position.firstName} ${position.lastName}`,
        quantity,
        marketValue,
        priceChange24h,
        estimatedContribution,
      };
    })
    .filter((position) => position.quantity > 0);

  if (positions.length === 0) {
    return {
      title: "Portfolio Attribution",
      items: [
        {
          label: "Holdings",
          value: "No player holdings",
        },
      ],
    };
  }

  const totalHeldValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const estimatedMove = positions.reduce(
    (sum, position) => sum + position.estimatedContribution,
    0,
  );
  const topPositive = [...positions].sort(
    (a, b) => b.estimatedContribution - a.estimatedContribution,
  )[0];
  const topNegative = [...positions].sort(
    (a, b) => a.estimatedContribution - b.estimatedContribution,
  )[0];

  return {
    title: "Portfolio Attribution",
    items: [
      {
        label: "Held Value",
        value: formatCurrency(totalHeldValue),
      },
      {
        label: "Estimated 24h Move",
        value: formatSignedCurrency(estimatedMove),
        change: formatSignedPercent(
          totalHeldValue > 0 ? (estimatedMove / totalHeldValue) * 100 : 0,
        ),
        isPositive: estimatedMove >= 0,
      },
      {
        label: `Top Positive: ${topPositive.name}`,
        value: formatSignedCurrency(topPositive.estimatedContribution),
        change: formatSignedPercent(topPositive.priceChange24h),
        isPositive: topPositive.estimatedContribution >= 0,
      },
      {
        label: `Top Negative: ${topNegative.name}`,
        value: formatSignedCurrency(topNegative.estimatedContribution),
        change: formatSignedPercent(topNegative.priceChange24h),
        isPositive: topNegative.estimatedContribution >= 0,
      },
    ],
  };
}

async function getEarningsBreakdownSection(
  userId: string,
  window: DigestWindow,
): Promise<{ section: DigestSection; totalCashEarnings: number }> {
  const [boostResult, sharePayoutResult, vestingResult, userTrades] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(${boostPayouts.payoutAmount}), 0)`.as("total"),
      })
      .from(boostPayouts)
      .where(
        and(
          eq(boostPayouts.userId, userId),
          gte(boostPayouts.createdAt, window.start),
          lt(boostPayouts.createdAt, window.end),
        ),
      ),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${sharePayouts.payoutAmount}), 0)`.as("total"),
      })
      .from(sharePayouts)
      .where(
        and(
          eq(sharePayouts.userId, userId),
          eq(sharePayouts.status, "processed"),
          gte(sharePayouts.processedAt, window.start),
          lt(sharePayouts.processedAt, window.end),
        ),
      ),
    db
      .select({
        totalShares: sql<number>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as(
          "total_shares",
        ),
      })
      .from(vestingClaims)
      .where(
        and(
          eq(vestingClaims.userId, userId),
          gte(vestingClaims.claimedAt, window.start),
          lt(vestingClaims.claimedAt, window.end),
        ),
      ),
    db
      .select({
        quantity: trades.quantity,
        price: trades.price,
      })
      .from(trades)
      .where(
        and(
          or(eq(trades.buyerId, userId), eq(trades.sellerId, userId)),
          gte(trades.executedAt, window.start),
          lt(trades.executedAt, window.end),
        ),
      ),
  ]);

  const boostPayout = asNumber(boostResult[0]?.total);
  const sharePayout = asNumber(sharePayoutResult[0]?.total);
  const vestedShares = asNumber(vestingResult[0]?.totalShares);
  const tradeVolume = userTrades.reduce(
    (sum, trade) => sum + asNumber(trade.quantity) * asNumber(trade.price),
    0,
  );

  const totalCashEarnings = boostPayout + sharePayout;

  return {
    section: {
      title: "Earnings Breakdown",
      items: [
        {
          label: "Total Cash Earnings",
          value: formatCurrency(totalCashEarnings),
          change: formatSignedCurrency(totalCashEarnings),
          isPositive: totalCashEarnings >= 0,
        },
        {
          label: "Boost Payouts",
          value: formatCurrency(boostPayout),
          isPositive: boostPayout >= 0,
        },
        {
          label: "Share Payouts",
          value: formatCurrency(sharePayout),
          isPositive: sharePayout >= 0,
        },
        {
          label: "Shares Vested",
          value: `${Math.round(vestedShares).toLocaleString()} shares`,
        },
        {
          label: "Trades Executed",
          value: userTrades.length.toString(),
        },
        {
          label: "Trade Volume",
          value: formatCurrency(tradeVolume),
        },
      ],
    },
    totalCashEarnings,
  };
}

/**
 * Compile daily digest for a single user
 */
export async function compileUserDigest(userId: string): Promise<UserDigest> {
  const window = getDigestWindow();

  const [
    contestResults,
    portfolioHealth,
    vestingStats,
    scoutActivity,
    boostPerformance,
    earnings,
    attribution,
    marketMovers,
  ] = await Promise.all([
    getUserContestResults(userId, window.start),
    getPortfolioHealth(userId),
    getVestingStats(userId),
    getScoutActivitySection(userId, window),
    getBoostPerformanceSection(userId, window),
    getEarningsBreakdownSection(userId, window),
    getPortfolioAttributionSection(userId),
    getGlobalMarketMovers(),
  ]);

  const latestSnapshots = await db
    .select({
      totalNetWorth: portfolioSnapshots.totalNetWorth,
      netWorthRank: portfolioSnapshots.netWorthRank,
      snapshotDate: portfolioSnapshots.snapshotDate,
    })
    .from(portfolioSnapshots)
    .where(
      and(eq(portfolioSnapshots.userId, userId), lte(portfolioSnapshots.snapshotDate, window.end)),
    )
    .orderBy(desc(portfolioSnapshots.snapshotDate))
    .limit(2);

  const latestNetWorth = asNumber(latestSnapshots[0]?.totalNetWorth);
  const previousNetWorth = asNumber(
    latestSnapshots[1]?.totalNetWorth || latestSnapshots[0]?.totalNetWorth,
  );
  const netWorthDelta = latestNetWorth - previousNetWorth;
  const netWorthDeltaPercent = previousNetWorth > 0 ? (netWorthDelta / previousNetWorth) * 100 : 0;
  const rankDelta =
    latestSnapshots[0]?.netWorthRank !== null && latestSnapshots[1]?.netWorthRank !== null
      ? asNumber(latestSnapshots[1]?.netWorthRank) - asNumber(latestSnapshots[0]?.netWorthRank)
      : 0;

  const summary: DigestSummaryItem[] = [
    {
      label: "Net Worth",
      value: formatCurrency(latestNetWorth),
    },
    {
      label: "Yesterday P/L",
      value: formatSignedCurrency(netWorthDelta),
      change: formatSignedPercent(netWorthDeltaPercent),
      isPositive: netWorthDelta >= 0,
    },
    {
      label: "Shares Scouted",
      value: `${scoutActivity.sharesScouted.toFixed(2)} shares`,
      isPositive: scoutActivity.sharesScouted >= 0,
    },
    {
      label: "Boost Earnings",
      value: formatCurrency(boostPerformance.totalBoostPayout),
      change: formatSignedCurrency(boostPerformance.totalBoostPayout),
      isPositive: boostPerformance.totalBoostPayout >= 0,
    },
    {
      label: "Cash Earnings",
      value: formatCurrency(earnings.totalCashEarnings),
      change: formatSignedCurrency(earnings.totalCashEarnings),
      isPositive: earnings.totalCashEarnings >= 0,
    },
    {
      label: "Rank Movement",
      value:
        rankDelta === 0
          ? "No change"
          : rankDelta > 0
            ? `Up ${rankDelta}`
            : `Down ${Math.abs(rankDelta)}`,
      isPositive: rankDelta >= 0,
    },
  ];

  const sections: DigestSection[] = [
    scoutActivity.section,
    boostPerformance.section,
    attribution,
    earnings.section,
  ];

  if (contestResults) sections.push(contestResults);
  if (portfolioHealth) sections.push(portfolioHealth);
  if (vestingStats) sections.push(vestingStats);
  sections.push(marketMovers);

  return {
    userId,
    generatedAt: new Date(),
    periodStart: window.start,
    periodEnd: window.end,
    periodLabel: window.label,
    summary,
    sections,
  };
}

/**
 * Run the daily digest compilation for all users with notifications enabled
 */
export async function compileAllDigests(progressCallback?: ProgressCallback): Promise<{
  success: boolean;
  usersProcessed: number;
  errors: number;
}> {
  try {
    progressCallback?.({
      message: "Starting daily digest compilation...",
      type: "info",
      timestamp: new Date().toISOString(),
    });
    console.log("[Digest] Starting daily digest compilation...");

    // Get all users with notifications enabled
    const activeUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isBot, false), eq(users.newsNotificationsEnabled, true)));

    console.log(`[Digest] Compiling digests for ${activeUsers.length} users`);
    progressCallback?.({
      message: `Processing ${activeUsers.length} users...`,
      type: "info",
      timestamp: new Date().toISOString(),
    });

    let processed = 0;
    let errors = 0;

    for (const user of activeUsers) {
      try {
        await compileUserDigest(user.id);
        processed++;
      } catch (error: any) {
        console.error(`[Digest] Error for user ${user.id}:`, error.message);
        errors++;
      }
    }

    console.log(`[Digest] Completed: ${processed} users, ${errors} errors`);
    progressCallback?.({
      message: `Completed: ${processed} users processed, ${errors} errors`,
      type: "complete",
      timestamp: new Date().toISOString(),
    });

    return { success: true, usersProcessed: processed, errors };
  } catch (error: any) {
    console.error("[Digest] Compilation failed:", error.message);
    progressCallback?.({
      message: `Error: ${error.message}`,
      type: "error",
      timestamp: new Date().toISOString(),
    });
    return { success: false, usersProcessed: 0, errors: 1 };
  }
}
