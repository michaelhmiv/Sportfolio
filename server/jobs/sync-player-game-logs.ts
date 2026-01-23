/**
 * Player Game Logs Sync Job
 * 
 * TWO MODES:
 * 1. DAILY MODE (default): Fetches only yesterday's games (~5 seconds, used by cron)
 * 2. BACKFILL MODE: Fetches date range for initial setup (~5-10 minutes, admin-triggered)
 * 
 * APPROACH: Date-based iteration (NOT per-player)
 * - Fetches ALL players' games for each date in ONE request  
 * 
 * Stores with pre-calculated fantasy points to eliminate API calls on player views.
 */

import { storage } from "../storage";
import { fetchDailyPlayerGameLogs, calculateFantasyPoints, createNBAPlayerId, getCurrentNBASeasonString, convertToGameStats } from "../balldontlie-nba";
import { balldontlieRateLimiter } from "./rate-limiter";
import type { JobResult } from "./scheduler";
import type { ProgressCallback } from "../lib/admin-stream";

export interface SyncOptions {
  mode?: 'daily' | 'backfill';
  startDate?: Date;
  endDate?: Date;
  progressCallback?: ProgressCallback;
}

export async function syncPlayerGameLogs(options: SyncOptions = {}): Promise<JobResult> {
  const { mode = 'daily', startDate, endDate, progressCallback } = options;

  console.log(`[sync_player_game_logs] Starting in ${mode.toUpperCase()} mode...`);

  progressCallback?.({
    type: 'info',
    timestamp: new Date().toISOString(),
    message: `Starting game logs sync in ${mode.toUpperCase()} mode`,
  });

  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  let skippedDates = 0;
  let datesProcessed = 0;

  try {
    // Calculate date range based on mode
    let rangeStart: Date;
    let rangeEnd: Date;

    if (mode === 'daily') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      rangeStart = yesterday;
      rangeEnd = yesterday;
      console.log(`[sync_player_game_logs] DAILY mode: Fetching ${rangeStart.toDateString()} only`);
      progressCallback?.({
        type: 'info',
        timestamp: new Date().toISOString(),
        message: `DAILY mode: Fetching ${rangeStart.toDateString()} only`,
      });
    } else {
      if (startDate && endDate) {
        rangeStart = startDate;
        rangeEnd = endDate;
      } else {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const seasonStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
        rangeStart = new Date(seasonStartYear, 9, 1); // Oct 1
        rangeEnd = now;
      }

      console.log(`[sync_player_game_logs] BACKFILL mode: Processing dates from ${rangeStart.toDateString()} to ${rangeEnd.toDateString()}`);
      progressCallback?.({
        type: 'info',
        timestamp: new Date().toISOString(),
        message: `BACKFILL mode: Processing dates from ${rangeStart.toDateString()} to ${rangeEnd.toDateString()}`,
        data: { startDate: rangeStart.toISOString(), endDate: rangeEnd.toISOString() },
      });
    }

    const currentDate = new Date(rangeStart);
    const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Iterate through each date in the range
    while (currentDate <= rangeEnd) {
      datesProcessed++;
      const dateStr = currentDate.toISOString().split('T')[0];

      // Progress logging every 5 dates (only in backfill mode)
      if (mode === 'backfill' && datesProcessed % 5 === 0) {
        console.log(`[sync_player_game_logs] Progress: ${datesProcessed}/${totalDays} dates processed`);
        progressCallback?.({
          type: 'progress',
          timestamp: new Date().toISOString(),
          message: `Progress: ${datesProcessed}/${totalDays} dates processed`,
          data: {
            current: datesProcessed,
            total: totalDays,
            percentage: Math.round((datesProcessed / totalDays) * 100),
            stats: {
              datesProcessed,
              skippedDates,
              apiCalls: requestCount,
              gamesCached: recordsProcessed,
              errors: errorCount,
            },
          },
        });
      }

      try {
        // Fetch ALL players' games for this date using BallDontLie stats endpoint
        const dayStats = await balldontlieRateLimiter.executeWithRetry(async () => {
          requestCount++;
          return await fetchDailyPlayerGameLogs(currentDate);
        });

        if (!dayStats || dayStats.length === 0) {
          skippedDates++;
          if (mode === 'daily') {
            console.warn(`[sync_player_game_logs] WARNING: No stats returned for ${dateStr}`);
            progressCallback?.({
              type: 'warning',
              timestamp: new Date().toISOString(),
              message: `No stats returned for ${dateStr} (possible off-day or API issue)`,
            });
          }
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }

        console.log(`[sync_player_game_logs] Found ${dayStats.length} stat lines on ${dateStr}`);
        progressCallback?.({
          type: 'info',
          timestamp: new Date().toISOString(),
          message: `✓ Found ${dayStats.length} stat lines on ${dateStr}`,
        });

        // Process and store each stat line
        for (const stat of dayStats) {
          try {
            if (!stat.game || !stat.player) {
              continue;
            }

            const game = stat.game;
            const player = stat.player;

            // BDL stats are flat
            const points = stat.pts || 0;
            const rebounds = stat.reb || 0;
            const assists = stat.ast || 0;
            const steals = stat.stl || 0;
            const blocks = stat.blk || 0;
            const turnovers = stat.turnover || 0;
            const threePointersMade = stat.fg3m || 0;

            // Calculate fantasy points
            const fantasyPoints = calculateFantasyPoints(convertToGameStats(stat));

            // Calculate double/triple-double
            const categories = [points, rebounds, assists, steals, blocks];
            const doubleDigitCategories = categories.filter(c => c >= 10).length;
            const isDoubleDouble = doubleDigitCategories >= 2;
            const isTripleDouble = doubleDigitCategories >= 3;

            // Determine home/away using game's team IDs
            const isHome = game.home_team_id === stat.team.id;
            const opponentTeamId = isHome ? game.visitor_team_id : game.home_team_id;

            // Store in database
            await storage.upsertPlayerGameStats({
              playerId: createNBAPlayerId(player.id),
              gameId: game.id.toString(),
              sport: "NBA",
              gameDate: new Date(game.date),
              season: getCurrentNBASeasonString(),
              opponentTeam: stat.team.abbreviation === "UNK" ? "UNK" : (isHome ? "AWAY" : "HOME"), // Will be overwritten with actual team abbr if available
              homeAway: isHome ? "home" : "away",
              minutes: stat.min ? parseInt(stat.min) : 0,
              points,
              fieldGoalsMade: stat.fgm || 0,
              fieldGoalsAttempted: stat.fga || 0,
              threePointersMade,
              threePointersAttempted: stat.fg3a || 0,
              freeThrowsMade: stat.ftm || 0,
              freeThrowsAttempted: stat.fta || 0,
              rebounds,
              assists,
              steals,
              blocks,
              turnovers,
              isDoubleDouble,
              isTripleDouble,
              fantasyPoints: fantasyPoints.toFixed(2),
            });

            recordsProcessed++;
          } catch (error: any) {
            console.error(`[sync_player_game_logs] Error storing stat:`, error.message);
            errorCount++;
          }
        }
      } catch (error: any) {
        console.error(`[sync_player_game_logs] Error syncing date ${dateStr}:`, error.message);
        progressCallback?.({
          type: 'error',
          timestamp: new Date().toISOString(),
          message: `Error syncing date ${dateStr}: ${error.message}`,
        });
        errorCount++;
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`[sync_player_game_logs] Completed: ${recordsProcessed} game logs synced`);
    console.log(`[sync_player_game_logs] Dates: ${datesProcessed} total, ${skippedDates} skipped`);
    console.log(`[sync_player_game_logs] API requests: ${requestCount}, Errors: ${errorCount}`);

    const success = errorCount === 0;
    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: success
        ? `✓ Sync completed successfully: ${recordsProcessed} stats cached`
        : `⚠ Sync completed with errors: ${recordsProcessed} stats cached, ${errorCount} errors`,
      data: {
        success,
        summary: {
          recordsProcessed,
          datesProcessed,
          skippedDates,
          requestCount,
          errorCount,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
    console.error("[sync_player_game_logs] Failed:", error.message);

    progressCallback?.({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Fatal error: ${error.message}`,
      data: { error: error.message, stack: error.stack },
    });

    progressCallback?.({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: `Game logs sync failed: ${error.message}`,
      data: {
        success: false,
        summary: {
          error: error.message,
          recordsProcessed: recordsProcessed || 0,
          datesProcessed: datesProcessed || 0,
          errors: errorCount + 1,
          apiCalls: requestCount || 0,
        },
      },
    });

    return { requestCount, recordsProcessed, errorCount: errorCount + 1 };
  }
}
