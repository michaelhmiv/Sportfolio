/**
 * Contest Settlement Job
 *
 * Automatically settles contests after they end:
 * - First backfills any missing player stats for games in pending contests
 * - Calculates final rankings with proportional scoring
 * - Determines winners (top 50% for 50/50 contests)
 * - Distributes prize pool
 * - Updates user balances
 *
 * OPTIMIZATION: Uses batch queries for game status checks and reduced logging.
 */

import { storage } from "../storage";
import { settleContest } from "../contest-scoring";
import { broadcast } from "../websocket";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";
import { getGameDay, getETDayBoundaries } from "../lib/time";
import { backfillContestStats } from "./backfill-contest-stats";
import { updateContestStatuses } from "./update-contest-statuses";
import { info, warn, createThrottledLogger } from "../lib/log-utility";

// Throttled logger for this job
const log = createThrottledLogger();

export async function settleContests(progressCallback?: ProgressCallback): Promise<JobResult> {
  info("[settle_contests] Starting contest settlement...");

  progressCallback?.({
    type: "info",
    timestamp: new Date().toISOString(),
    message: "Starting contest settlement job",
  });

  let contestsProcessed = 0;
  let errorCount = 0;
  let requestCount = 0;

  try {
    // Step 0: First update contest statuses (open → live) before settling
    info("[settle_contests] Step 0: Updating contest statuses...");
    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: "Updating contest statuses (open → live)...",
    });

    try {
      const statusResult = await updateContestStatuses(progressCallback);
      if (statusResult.recordsProcessed > 0) {
        info(`[settle_contests] Transitioned ${statusResult.recordsProcessed} contests to live`);
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Transitioned ${statusResult.recordsProcessed} contests to live`,
        });
      }
    } catch (statusError: any) {
      warn(`[settle_contests] Status update warning: ${statusError.message}`);
      // Continue with settlement even if status update fails
    }

    // Step 1: First backfill any missing stats for games in live contests
    info("[settle_contests] Step 1: Checking for missing player stats...");
    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: "Checking for missing player stats in pending contests...",
    });

    try {
      const backfillResult = await backfillContestStats(progressCallback);
      requestCount += backfillResult.requestCount;

      if (backfillResult.recordsProcessed > 0) {
        info(`[settle_contests] Backfilled ${backfillResult.recordsProcessed} player stats`);
        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Backfilled ${backfillResult.recordsProcessed} missing player stats`,
        });
      }
    } catch (backfillError: any) {
      warn(`[settle_contests] Stats backfill warning: ${backfillError.message}`);
      // Continue with settlement even if backfill fails - stats may already exist
    }

    info("[settle_contests] Step 2: Finding contests to settle...");
    // Find all "live" contests that might be ready to settle
    const allContests = await storage.getContests("live");
    const now = new Date();

    info(`[settle_contests] Found ${allContests.length} live contests to check`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Found ${allContests.length} live contests to check for settlement`,
      data: { totalContests: allContests.length },
    });

    if (allContests.length === 0) {
      info("[settle_contests] No live contests to check for settlement");
      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "No live contests to settle",
        data: {
          success: true,
          summary: {
            contestsSettled: 0,
            errors: 0,
          },
        },
      });
      return { requestCount: 0, recordsProcessed: 0, errorCount: 0 };
    }

    // OPTIMIZATION: Batch game status queries by date
    // Group contests by their game date to fetch games once per date
    const contestsByDate = new Map<string, typeof allContests>();
    for (const contest of allContests) {
      const dateStr = new Date(contest.gameDate).toISOString().split("T")[0];
      if (!contestsByDate.has(dateStr)) {
        contestsByDate.set(dateStr, []);
      }
      contestsByDate.get(dateStr)!.push(contest);
    }

    // Fetch all games for all contest dates in one batch per date
    const gamesByDate = new Map<string, Awaited<ReturnType<typeof storage.getDailyGames>>>();
    for (const dateStr of contestsByDate.keys()) {
      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const games = await storage.getDailyGames(startOfDay, endOfDay);
      gamesByDate.set(dateStr, games);
    }

    // For each live contest, check if it's ready to settle
    const contestsToSettle = [];
    let contestsChecked = 0;

    for (const contest of allContests) {
      contestsChecked++;

      // Progress update every 10 contests checked (reduced frequency)
      if (contestsChecked % 10 === 0) {
        progressCallback?.({
          type: "progress",
          timestamp: new Date().toISOString(),
          message: `Checked ${contestsChecked}/${allContests.length} contests`,
          data: {
            current: contestsChecked,
            total: allContests.length,
            percentage: Math.round((contestsChecked / allContests.length) * 100),
          },
        });
      }

      // Get games for this contest's date from cache
      const contestDate = new Date(contest.gameDate);
      const dateStr = contestDate.toISOString().split("T")[0];
      const games = gamesByDate.get(dateStr) || [];

      if (games.length === 0) {
        // No games found for this date, cannot settle
        continue;
      }

      // Check if all games are completed (have final scores)
      const incompleteGames = games.filter((g) => g.status !== "completed");

      if (incompleteGames.length > 0) {
        // Games not complete yet, skip this contest
        continue;
      }

      // All games are complete, this contest is ready to settle
      log(`[settle_contests] Contest ${contest.id} is ready to settle!`);
      contestsToSettle.push(contest);
    }

    if (contestsToSettle.length === 0) {
      info("[settle_contests] No contests ready for settlement (waiting for games to complete)");
      progressCallback?.({
        type: "complete",
        timestamp: new Date().toISOString(),
        message: "No contests ready for settlement (waiting for games to complete)",
        data: {
          success: true,
          summary: {
            contestsChecked,
            contestsSettled: 0,
            errors: 0,
          },
        },
      });
      return { requestCount: 0, recordsProcessed: 0, errorCount: 0 };
    }

    info(`[settle_contests] Settling ${contestsToSettle.length} contests...`);

    progressCallback?.({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `Settling ${contestsToSettle.length} contests`,
      data: { contestsToSettle: contestsToSettle.length },
    });

    for (const contest of contestsToSettle) {
      try {
        log(`[settle_contests] Settling contest ${contest.id} (${contest.name})...`);

        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Settling contest: ${contest.name} (${contest.id})`,
          data: { contestId: contest.id, contestName: contest.name },
        });

        await settleContest(contest.id);
        contestsProcessed++;
        log(`[settle_contests] Contest ${contest.id} settled successfully`);

        // Broadcast settlement notification to all connected users
        broadcast({ type: "contestSettled", contestId: contest.id });

        progressCallback?.({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `✓ Settled: ${contest.name}`,
          data: { contestId: contest.id, status: "success" },
        });

        // Progress update
        progressCallback?.({
          type: "progress",
          timestamp: new Date().toISOString(),
          message: `Settled ${contestsProcessed}/${contestsToSettle.length} contests`,
          data: {
            current: contestsProcessed,
            total: contestsToSettle.length,
            percentage: Math.round((contestsProcessed / contestsToSettle.length) * 100),
            stats: { settled: contestsProcessed, errors: errorCount },
          },
        });
      } catch (err: any) {
        warn(`[settle_contests] Failed to settle contest ${contest.id}:`, err.message);
        errorCount++;

        progressCallback?.({
          type: "error",
          timestamp: new Date().toISOString(),
          message: `Failed to settle contest ${contest.name}: ${err.message}`,
          data: { contestId: contest.id, error: err.message },
        });
      }
    }

    info(`[settle_contests] Settled ${contestsProcessed} contests, ${errorCount} errors`);

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message:
        errorCount > 0
          ? `Settlement completed with ${errorCount} errors: ${contestsProcessed}/${contestsToSettle.length} contests settled`
          : `Settlement completed successfully: ${contestsProcessed} contests settled`,
      data: {
        success: errorCount === 0,
        summary: {
          contestsSettled: contestsProcessed,
          errors: errorCount,
          total: contestsToSettle.length,
        },
      },
    });

    return {
      requestCount,
      recordsProcessed: contestsProcessed,
      errorCount,
    };
  } catch (err: any) {
    warn("[settle_contests] Failed:", err.message);

    progressCallback?.({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Contest settlement failed: ${err.message}`,
      data: { error: err.message, stack: err.stack },
    });

    progressCallback?.({
      type: "complete",
      timestamp: new Date().toISOString(),
      message: `Contest settlement failed: ${err.message}`,
      data: {
        success: false,
        summary: {
          error: err.message,
          contestsSettled: contestsProcessed,
          errors: errorCount + 1,
        },
      },
    });

    return { requestCount, recordsProcessed: contestsProcessed, errorCount: errorCount + 1 };
  }
}
