/**
 * Test all NBA sync jobs with BallDontLie API
 */

import "dotenv/config";
import { syncRoster } from "../server/jobs/sync-roster";
import { syncSchedule } from "../server/jobs/sync-schedule";
import { syncStats } from "../server/jobs/sync-stats";
import { syncPlayerGameLogs } from "../server/jobs/sync-player-game-logs";

async function runSyncTests() {
    console.log("=".repeat(60));
    console.log("NBA SYNC JOBS TEST - BallDontLie API");
    console.log("=".repeat(60));

    const results: Record<string, { success: boolean; recordsProcessed: number; errors: number; duration: number }> = {};

    // Test 1: Roster Sync
    console.log("\n[TEST 1/4] roster_sync - Fetching NBA players...");
    const rosterStart = Date.now();
    try {
        const result = await syncRoster();
        results.roster_sync = {
            success: result.errorCount === 0,
            recordsProcessed: result.recordsProcessed,
            errors: result.errorCount,
            duration: Date.now() - rosterStart
        };
        console.log(`✓ roster_sync: ${result.recordsProcessed} players, ${result.errorCount} errors, ${results.roster_sync.duration}ms`);
    } catch (error: any) {
        console.error(`✗ roster_sync FAILED:`, error.message);
        results.roster_sync = { success: false, recordsProcessed: 0, errors: 1, duration: Date.now() - rosterStart };
    }

    // Test 2: Schedule Sync
    console.log("\n[TEST 2/4] schedule_sync - Fetching game schedules...");
    const scheduleStart = Date.now();
    try {
        const result = await syncSchedule();
        results.schedule_sync = {
            success: result.errorCount === 0,
            recordsProcessed: result.recordsProcessed,
            errors: result.errorCount,
            duration: Date.now() - scheduleStart
        };
        console.log(`✓ schedule_sync: ${result.recordsProcessed} games, ${result.errorCount} errors, ${results.schedule_sync.duration}ms`);
    } catch (error: any) {
        console.error(`✗ schedule_sync FAILED:`, error.message);
        results.schedule_sync = { success: false, recordsProcessed: 0, errors: 1, duration: Date.now() - scheduleStart };
    }

    // Test 3: Stats Sync
    console.log("\n[TEST 3/4] stats_sync - Fetching player game stats...");
    const statsStart = Date.now();
    try {
        const result = await syncStats();
        results.stats_sync = {
            success: result.errorCount === 0,
            recordsProcessed: result.recordsProcessed,
            errors: result.errorCount,
            duration: Date.now() - statsStart
        };
        console.log(`✓ stats_sync: ${result.recordsProcessed} stats, ${result.errorCount} errors, ${results.stats_sync.duration}ms`);
    } catch (error: any) {
        console.error(`✗ stats_sync FAILED:`, error.message);
        results.stats_sync = { success: false, recordsProcessed: 0, errors: 1, duration: Date.now() - statsStart };
    }

    // Test 4: Player Game Logs (Daily mode - yesterday only)
    console.log("\n[TEST 4/4] sync_player_game_logs - Fetching yesterday's stats...");
    const logsStart = Date.now();
    try {
        const result = await syncPlayerGameLogs({ mode: 'daily' });
        results.sync_player_game_logs = {
            success: result.errorCount === 0,
            recordsProcessed: result.recordsProcessed,
            errors: result.errorCount,
            duration: Date.now() - logsStart
        };
        console.log(`✓ sync_player_game_logs: ${result.recordsProcessed} stats, ${result.errorCount} errors, ${results.sync_player_game_logs.duration}ms`);
    } catch (error: any) {
        console.error(`✗ sync_player_game_logs FAILED:`, error.message);
        results.sync_player_game_logs = { success: false, recordsProcessed: 0, errors: 1, duration: Date.now() - logsStart };
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("RESULTS SUMMARY");
    console.log("=".repeat(60));

    let allPassed = true;
    for (const [job, result] of Object.entries(results)) {
        const status = result.success ? "✓ PASS" : "✗ FAIL";
        console.log(`${status} | ${job}: ${result.recordsProcessed} records, ${result.errors} errors, ${result.duration}ms`);
        if (!result.success) allPassed = false;
    }

    console.log("\n" + "=".repeat(60));
    console.log(allPassed ? "ALL TESTS PASSED - BallDontLie integration verified!" : "SOME TESTS FAILED - Review errors above");
    console.log("=".repeat(60));

    process.exit(allPassed ? 0 : 1);
}

runSyncTests().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
