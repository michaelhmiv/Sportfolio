import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import {
  dailyBoosts,
  dailyGames,
  holdings,
  playerGameStats,
  players,
  portfolioSnapshots,
  scoutAssignments,
  users,
  watchList,
} from "@shared/schema";
import { db } from "../db";
import {
  sendCategoryBroadcastNotification,
  sendNotificationToUsers,
  sendUserNotification,
} from "../services/notification-dispatcher";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";

const WATCHLIST_MOVE_THRESHOLD = 8;
const WATCHLIST_VOLUME_THRESHOLD = 500;
const MARKET_MOVE_THRESHOLD = 15;
const MARKET_VOLUME_THRESHOLD = 2000;
const LEADERBOARD_JUMP_THRESHOLD = 5;
const PREMIUM_EXPIRY_REMINDER_DAYS = new Set([7, 3, 1, 0]);

type SignalOutcome = {
  recordsProcessed: number;
  errorCount: number;
};

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function toIsoHour(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

async function runWatchlistAlerts(now: Date): Promise<SignalOutcome> {
  const rows = await db
    .select({
      userId: watchList.userId,
      playerId: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      priceChange24h: players.priceChange24h,
      volume24h: players.volume24h,
    })
    .from(watchList)
    .innerJoin(players, eq(players.id, watchList.playerId));

  const alertsByUser = new Map<
    string,
    Array<{
      playerId: string;
      name: string;
      priceChange24h: number;
      volume24h: number;
    }>
  >();

  for (const row of rows) {
    const priceChange24h = toNumber(row.priceChange24h);
    const volume24h = toNumber(row.volume24h);
    const significant =
      Math.abs(priceChange24h) >= WATCHLIST_MOVE_THRESHOLD ||
      volume24h >= WATCHLIST_VOLUME_THRESHOLD;
    if (!significant) {
      continue;
    }

    const current = alertsByUser.get(row.userId) || [];
    current.push({
      playerId: row.playerId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      priceChange24h,
      volume24h,
    });
    alertsByUser.set(row.userId, current);
  }

  let recordsProcessed = 0;
  let errorCount = 0;
  const hourKey = toIsoHour(now);

  await Promise.all(
    Array.from(alertsByUser.entries()).map(async ([userId, items]) => {
      const ranked = items
        .slice()
        .sort(
          (left, right) =>
            Math.abs(right.priceChange24h) - Math.abs(left.priceChange24h) ||
            right.volume24h - left.volume24h,
        );
      const lead = ranked[0];
      if (!lead) {
        return;
      }

      const body =
        ranked.length === 1
          ? `${lead.name} moved ${lead.priceChange24h >= 0 ? "+" : ""}${lead.priceChange24h.toFixed(2)}% in the last 24h.`
          : `${ranked.length} watchlist players are moving. ${lead.name} leads at ${lead.priceChange24h >= 0 ? "+" : ""}${lead.priceChange24h.toFixed(2)}%.`;

      try {
        const result = await sendUserNotification({
          userId,
          category: "watchlist_alerts",
          title: "Watchlist Alert",
          body,
          deepLink: "/watchlists",
          data: {
            leadPlayerId: lead.playerId,
            leadChange24h: lead.priceChange24h.toFixed(2),
            highlightedCount: String(Math.min(ranked.length, 3)),
          },
          dedupeKey: `watchlist_alerts:${hourKey}:${lead.playerId}`,
          cooldownMs: 45 * 60 * 1000,
        });
        recordsProcessed += result.recipientUsers;
      } catch (error) {
        errorCount += 1;
        console.error("[notification_signals/watchlist] Failed to send watchlist alert:", error);
      }
    }),
  );

  return { recordsProcessed, errorCount };
}

async function runMarketPulseAlerts(now: Date): Promise<SignalOutcome> {
  const movers = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      priceChange24h: players.priceChange24h,
      volume24h: players.volume24h,
      absoluteChange: sql<number>`abs(${players.priceChange24h}::numeric)`,
    })
    .from(players)
    .where(
      or(
        sql`abs(${players.priceChange24h}::numeric) >= ${MARKET_MOVE_THRESHOLD}`,
        gte(players.volume24h, MARKET_VOLUME_THRESHOLD),
      ),
    )
    .orderBy(
      desc(sql`abs(${players.priceChange24h}::numeric)`),
      desc(players.volume24h),
      players.lastName,
    )
    .limit(5);

  if (movers.length === 0) {
    return { recordsProcessed: 0, errorCount: 0 };
  }

  const lead = movers[0];
  const leadName = `${lead.firstName} ${lead.lastName}`.trim();
  const leadChange = toNumber(lead.priceChange24h);
  const body =
    movers.length === 1
      ? `${leadName} is moving ${leadChange >= 0 ? "+" : ""}${leadChange.toFixed(2)}% right now.`
      : `${leadName} leads today at ${leadChange >= 0 ? "+" : ""}${leadChange.toFixed(2)}%. ${movers.length} players triggered market pulse thresholds.`;

  try {
    const result = await sendCategoryBroadcastNotification({
      category: "market_alerts",
      title: "Market Pulse",
      body,
      deepLink: "/pools",
      data: {
        leadPlayerId: lead.id,
        leadChange24h: leadChange.toFixed(2),
        moverCount: String(movers.length),
      },
      dedupeKey: `market_pulse:${toIsoHour(now)}`,
      cooldownMs: 60 * 60 * 1000,
    });
    return {
      recordsProcessed: result.recipientUsers,
      errorCount: 0,
    };
  } catch (error) {
    console.error("[notification_signals/market] Failed to send market pulse alert:", error);
    return {
      recordsProcessed: 0,
      errorCount: 1,
    };
  }
}

async function runLeaderboardMovementAlerts(now: Date): Promise<SignalOutcome> {
  const snapshotDates = await db
    .selectDistinct({
      snapshotDate: portfolioSnapshots.snapshotDate,
    })
    .from(portfolioSnapshots)
    .orderBy(desc(portfolioSnapshots.snapshotDate))
    .limit(2);

  if (snapshotDates.length < 2) {
    return { recordsProcessed: 0, errorCount: 0 };
  }

  const currentDate = snapshotDates[0].snapshotDate;
  const previousDate = snapshotDates[1].snapshotDate;

  const [currentRows, previousRows] = await Promise.all([
    db
      .select({
        userId: portfolioSnapshots.userId,
        netWorthRank: portfolioSnapshots.netWorthRank,
      })
      .from(portfolioSnapshots)
      .innerJoin(users, eq(users.id, portfolioSnapshots.userId))
      .where(and(eq(portfolioSnapshots.snapshotDate, currentDate), eq(users.isBot, false))),
    db
      .select({
        userId: portfolioSnapshots.userId,
        netWorthRank: portfolioSnapshots.netWorthRank,
      })
      .from(portfolioSnapshots)
      .innerJoin(users, eq(users.id, portfolioSnapshots.userId))
      .where(and(eq(portfolioSnapshots.snapshotDate, previousDate), eq(users.isBot, false))),
  ]);

  const previousRankByUser = new Map<string, number>();
  for (const row of previousRows) {
    if (typeof row.netWorthRank === "number" && row.netWorthRank > 0) {
      previousRankByUser.set(row.userId, row.netWorthRank);
    }
  }

  let recordsProcessed = 0;
  let errorCount = 0;
  const dateKey = now.toISOString().slice(0, 10);

  await Promise.all(
    currentRows.map(async (row) => {
      const currentRank = row.netWorthRank;
      const previousRank = previousRankByUser.get(row.userId);
      if (!currentRank || !previousRank) {
        return;
      }

      const jump = previousRank - currentRank;
      const milestoneHit = [1, 3, 10].includes(currentRank) && previousRank > currentRank;
      if (jump < LEADERBOARD_JUMP_THRESHOLD && !milestoneHit) {
        return;
      }

      const body = milestoneHit
        ? `You moved to #${currentRank} on the net worth leaderboard.`
        : `You climbed ${jump} spots to #${currentRank} on net worth.`;

      try {
        const result = await sendUserNotification({
          userId: row.userId,
          category: "leaderboard_competition",
          title: "Leaderboard Update",
          body,
          deepLink: "/leaderboards",
          data: {
            rank: String(currentRank),
            rankDelta: String(jump),
          },
          dedupeKey: `leaderboard_movement:${dateKey}:${currentRank}`,
          cooldownMs: 12 * 60 * 60 * 1000,
        });
        recordsProcessed += result.recipientUsers;
      } catch (error) {
        errorCount += 1;
        console.error(
          "[notification_signals/leaderboard] Failed to send leaderboard alert:",
          error,
        );
      }
    }),
  );

  return { recordsProcessed, errorCount };
}

async function runPremiumExpiryReminders(now: Date): Promise<SignalOutcome> {
  const upperBound = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const soonExpiring = await db
    .select({
      id: users.id,
      premiumExpiresAt: users.premiumExpiresAt,
    })
    .from(users)
    .where(
      and(
        eq(users.isPremium, true),
        isNotNull(users.premiumExpiresAt),
        lte(users.premiumExpiresAt, upperBound),
        gte(users.premiumExpiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ),
    );

  let recordsProcessed = 0;
  let errorCount = 0;

  await Promise.all(
    soonExpiring.map(async (row) => {
      const expiresAt = row.premiumExpiresAt;
      if (!expiresAt) {
        return;
      }

      const msUntil = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.max(0, Math.ceil(msUntil / (24 * 60 * 60 * 1000)));
      if (!PREMIUM_EXPIRY_REMINDER_DAYS.has(daysRemaining)) {
        return;
      }

      const body =
        daysRemaining === 0
          ? "Your premium access expires today. Renew to keep premium benefits active."
          : `Your premium access expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;

      try {
        const result = await sendUserNotification({
          userId: row.id,
          category: "billing_premium",
          title: "Premium Expiry Reminder",
          body,
          deepLink: "/premium",
          data: {
            expiresAt: expiresAt.toISOString(),
            daysRemaining: String(daysRemaining),
          },
          dedupeKey: `premium_expiry:${expiresAt.toISOString().slice(0, 10)}:${daysRemaining}`,
          cooldownMs: 24 * 60 * 60 * 1000,
        });
        recordsProcessed += result.recipientUsers;
      } catch (error) {
        errorCount += 1;
        console.error("[notification_signals/premium] Failed to send premium reminder:", error);
      }
    }),
  );

  return { recordsProcessed, errorCount };
}

async function runGameLifecycleAlerts(now: Date): Promise<SignalOutcome> {
  const recentWindow = new Date(now.getTime() - 30 * 60 * 1000);
  const lookbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const games = await db
    .select({
      gameId: dailyGames.gameId,
      sport: dailyGames.sport,
      status: dailyGames.status,
      startTime: dailyGames.startTime,
      homeTeam: dailyGames.homeTeam,
      awayTeam: dailyGames.awayTeam,
      lastFetchedAt: dailyGames.lastFetchedAt,
    })
    .from(dailyGames)
    .where(
      and(
        inArray(dailyGames.status, ["inprogress", "completed"]),
        gte(dailyGames.lastFetchedAt, recentWindow),
        gte(dailyGames.startTime, lookbackStart),
      ),
    )
    .orderBy(desc(dailyGames.lastFetchedAt))
    .limit(30);

  if (games.length === 0) {
    return { recordsProcessed: 0, errorCount: 0 };
  }

  const gameIds = games.map((game) => game.gameId);
  const gamePlayerRows = await db
    .select({
      gameId: playerGameStats.gameId,
      playerId: playerGameStats.playerId,
    })
    .from(playerGameStats)
    .where(inArray(playerGameStats.gameId, gameIds));

  const playerIds = Array.from(new Set(gamePlayerRows.map((row) => row.playerId)));
  if (playerIds.length === 0) {
    return { recordsProcessed: 0, errorCount: 0 };
  }

  const [holdingRows, boostRows, scoutRows] = await Promise.all([
    db
      .select({
        userId: holdings.userId,
        playerId: holdings.assetId,
      })
      .from(holdings)
      .where(
        and(
          eq(holdings.assetType, "player"),
          inArray(holdings.assetId, playerIds),
          sql`${holdings.quantity}::numeric > 0`,
        ),
      ),
    db
      .select({
        userId: dailyBoosts.userId,
        playerId: dailyBoosts.playerId,
      })
      .from(dailyBoosts)
      .where(inArray(dailyBoosts.playerId, playerIds)),
    db
      .select({
        userId: scoutAssignments.userId,
        playerId: scoutAssignments.playerId,
      })
      .from(scoutAssignments)
      .where(
        and(inArray(scoutAssignments.playerId, playerIds), sql`${scoutAssignments.scoutCount} > 0`),
      ),
  ]);

  const interestedUsersByPlayer = new Map<string, Set<string>>();
  const addInterest = (playerId: string, userId: string) => {
    const current = interestedUsersByPlayer.get(playerId) || new Set<string>();
    current.add(userId);
    interestedUsersByPlayer.set(playerId, current);
  };

  for (const row of holdingRows) {
    addInterest(row.playerId, row.userId);
  }
  for (const row of boostRows) {
    addInterest(row.playerId, row.userId);
  }
  for (const row of scoutRows) {
    addInterest(row.playerId, row.userId);
  }

  const playerIdsByGame = new Map<string, string[]>();
  for (const row of gamePlayerRows) {
    const current = playerIdsByGame.get(row.gameId) || [];
    current.push(row.playerId);
    playerIdsByGame.set(row.gameId, current);
  }

  let recordsProcessed = 0;
  let errorCount = 0;

  await Promise.all(
    games.map(async (game) => {
      const gamePlayerIds = playerIdsByGame.get(game.gameId) || [];
      const interestedUsers = new Set<string>();
      for (const playerId of gamePlayerIds) {
        const watchers = interestedUsersByPlayer.get(playerId);
        if (!watchers) continue;
        for (const userId of watchers) {
          interestedUsers.add(userId);
        }
      }

      if (interestedUsers.size === 0) {
        return;
      }

      const isFinal = game.status === "completed";
      const title = isFinal ? "Game Final" : "Game Started";
      const body = isFinal
        ? `${game.awayTeam} at ${game.homeTeam} is final.`
        : `${game.awayTeam} at ${game.homeTeam} just went live.`;

      try {
        const result = await sendNotificationToUsers({
          userIds: Array.from(interestedUsers),
          category: "game_lifecycle",
          title,
          body,
          deepLink: "/portfolio",
          data: {
            gameId: game.gameId,
            sport: game.sport,
            status: game.status,
          },
          dedupeKey: `game_lifecycle:${game.gameId}:${game.status}`,
          cooldownMs: 8 * 60 * 60 * 1000,
        });
        recordsProcessed += result.recipientUsers;
      } catch (error) {
        errorCount += 1;
        console.error("[notification_signals/game] Failed to send game lifecycle alert:", error);
      }
    }),
  );

  return { recordsProcessed, errorCount };
}

export async function runNotificationSignalDetectors(
  progressCallback?: ProgressCallback,
): Promise<JobResult> {
  const startedAt = new Date();
  progressCallback?.({
    type: "info",
    timestamp: startedAt.toISOString(),
    message: "Running notification signal detectors",
  });

  let recordsProcessed = 0;
  let errorCount = 0;

  const tasks: Array<{ name: string; run: (now: Date) => Promise<SignalOutcome> }> = [
    { name: "watchlist_alerts", run: runWatchlistAlerts },
    { name: "market_alerts", run: runMarketPulseAlerts },
    { name: "leaderboard_competition", run: runLeaderboardMovementAlerts },
    { name: "game_lifecycle", run: runGameLifecycleAlerts },
    { name: "billing_premium_expiry", run: runPremiumExpiryReminders },
  ];

  for (const task of tasks) {
    try {
      const result = await task.run(startedAt);
      recordsProcessed += result.recordsProcessed;
      errorCount += result.errorCount;
      progressCallback?.({
        type: "info",
        timestamp: new Date().toISOString(),
        message: `[${task.name}] processed=${result.recordsProcessed} errors=${result.errorCount}`,
      });
    } catch (error) {
      errorCount += 1;
      console.error(`[notification_signals] ${task.name} failed:`, error);
      progressCallback?.({
        type: "error",
        timestamp: new Date().toISOString(),
        message: `[${task.name}] failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  progressCallback?.({
    type: "complete",
    timestamp: new Date().toISOString(),
    message: `Notification signal detectors complete: processed=${recordsProcessed} errors=${errorCount}`,
  });

  return {
    requestCount: 0,
    recordsProcessed,
    errorCount,
  };
}
