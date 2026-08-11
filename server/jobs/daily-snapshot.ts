/**
 * Daily Portfolio Snapshot Job
 *
 * Takes close snapshots of all users' portfolio metrics for historical tracking.
 * The completed ET business day is represented by a stable UTC-midnight key so
 * market and portfolio history share the same close-date convention.
 */

import { storage } from "../storage";
import type { JobResult } from "./types";
import type { ProgressCallback } from "../lib/admin-stream";
import { eq } from "drizzle-orm";
import { portfolioSnapshots } from "@shared/schema";
import { db } from "../db";
import { getPreviousETBusinessDay } from "./market-snapshot";

interface UserPortfolioData {
  userId: string;
  cashBalance: string;
  portfolioValue: number;
  totalNetWorth: number;
}

export function buildDailySnapshotPortfolioData(
  rows: Array<{ userId: string; balance: string; portfolioValue: number }>,
): UserPortfolioData[] {
  return rows.map((user) => ({
    userId: user.userId,
    cashBalance: user.balance,
    portfolioValue: user.portfolioValue,
    totalNetWorth: parseFloat(user.balance) + user.portfolioValue,
  }));
}

function snapshotKeyForDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function dailySnapshot(progressCallback?: ProgressCallback): Promise<JobResult> {
  const targetDate = getPreviousETBusinessDay();
  const snapshotDate = snapshotKeyForDate(targetDate);
  console.log(`[daily_snapshot] Starting portfolio close snapshot for ${targetDate} ET...`);

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: `Starting portfolio close snapshot for ${targetDate} ET`,
  });

  let snapshotsCreated = 0;
  let errorCount = 0;

  try {
    const allUsersData = await storage.getAllUsersForRanking();
    const userPortfolioData = buildDailySnapshotPortfolioData(allUsersData);

    const cashRankMap = new Map<string, number>();
    [...userPortfolioData]
      .sort((a, b) => parseFloat(b.cashBalance) - parseFloat(a.cashBalance))
      .forEach((user, index) => cashRankMap.set(user.userId, index + 1));

    const portfolioRankMap = new Map<string, number>();
    [...userPortfolioData]
      .sort((a, b) => b.portfolioValue - a.portfolioValue)
      .forEach((user, index) => portfolioRankMap.set(user.userId, index + 1));

    const netWorthRankMap = new Map<string, number>();
    [...userPortfolioData]
      .sort((a, b) => b.totalNetWorth - a.totalNetWorth)
      .forEach((user, index) => netWorthRankMap.set(user.userId, index + 1));

    // A rerun for the same completed ET business day replaces that day's close
    // atomically at the day level instead of creating duplicate history rows.
    await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.snapshotDate, snapshotDate));

    const BATCH_SIZE = 500;
    let processedCount = 0;
    for (let i = 0; i < userPortfolioData.length; i += BATCH_SIZE) {
      const batch = userPortfolioData.slice(i, i + BATCH_SIZE);
      try {
        await db.insert(portfolioSnapshots).values(
          batch.map((userData) => ({
            userId: userData.userId,
            snapshotDate,
            cashBalance: userData.cashBalance,
            portfolioValue: userData.portfolioValue.toFixed(2),
            totalNetWorth: userData.totalNetWorth.toFixed(2),
            cashRank: cashRankMap.get(userData.userId) || null,
            portfolioRank: portfolioRankMap.get(userData.userId) || null,
            netWorthRank: netWorthRankMap.get(userData.userId) || null,
          })),
        );
        snapshotsCreated += batch.length;
        processedCount += batch.length;
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Inserted ${processedCount}/${userPortfolioData.length} portfolio snapshots`,
        });
      } catch (error: any) {
        console.error(`[daily_snapshot] Failed batch starting at ${i}:`, error.message);
        errorCount += batch.length;
      }
    }

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Portfolio close snapshot completed for ${targetDate}: ${snapshotsCreated} rows`,
      data: {
        success: errorCount === 0,
        summary: { snapshotsCreated, errors: errorCount },
      },
    });

    return {
      requestCount: 0,
      recordsProcessed: snapshotsCreated,
      errorCount,
    };
  } catch (error: any) {
    console.error("[daily_snapshot] Fatal error:", error);
    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Fatal error: ${error.message}`,
      data: { error: error.message },
    });
    return {
      requestCount: 0,
      recordsProcessed: snapshotsCreated,
      errorCount: errorCount + 1,
    };
  }
}
