/**
 * Scout Distribution Job
 * 
 * Runs every hour to distribute shares based on "Scout-Minutes".
 * Uses the `scout_history` table to calculate exact duration of overlapping assignments
 * within the previous hour window.
 * 
 * Also performs cleanup of inactive users (>24h inactive).
 */

import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, lte, inArray } from "drizzle-orm";
import { users, scoutAssignments, scoutHistory } from "@shared/schema";
import { broadcast } from "../websocket";
import type { JobResult } from "./scheduler";

export async function distributeScoutShares(): Promise<JobResult> {
    let recordsProcessed = 0;
    let errorCount = 0;

    const now = new Date();
    // Target Window: The previous full hour (e.g. if now is 14:00, window is 13:00-14:00)
    const hourEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000); // 1 hour before

    console.log(`[scout_distribution] Starting distribution for window: ${hourStart.toISOString()} to ${hourEnd.toISOString()}`);

    try {
        // --- PHASE 1: CLEANUP INACTIVE USERS ---
        // Find users inactive for > 24h who still have active scouts
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const inactiveUsers = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(scoutAssignments, eq(users.id, scoutAssignments.userId))
            .where(lte(users.lastActiveAt, twentyFourHoursAgo))
            .groupBy(users.id);

        if (inactiveUsers.length > 0) {
            const userIds = inactiveUsers.map(u => u.id);
            console.log(`[scout_distribution] Cleaning up ${userIds.length} inactive users...`);

            // 1. Close history records
            await db
                .update(scoutHistory)
                .set({ endedAt: new Date() })
                .where(and(
                    inArray(scoutHistory.userId, userIds),
                    sql`${scoutHistory.endedAt} IS NULL`
                ));

            // 2. Remove active assignments
            await db
                .delete(scoutAssignments)
                .where(inArray(scoutAssignments.userId, userIds));

            console.log(`[scout_distribution] Cleanup complete.`);
        }

        // --- PHASE 1.5: RESTORE GHOST HISTORY (Self-Healing) ---
        // Ensure all active assignments have a corresponding open history record.
        // This fixes legacy data issues where assignments exist but history was lost/not created.
        const activeAssignments = await db.select().from(scoutAssignments);
        const openHistory = await db.select().from(scoutHistory).where(sql`${scoutHistory.endedAt} IS NULL`);

        // Create a map of UserID-PlayerID for existing open history
        const openHistorySet = new Set(openHistory.map(h => `${h.userId}-${h.playerId}`));
        const ghostsToRestore: typeof scoutHistory.$inferInsert[] = [];

        for (const assignment of activeAssignments) {
            if (assignment.scoutCount > 0) {
                const key = `${assignment.userId}-${assignment.playerId}`;
                if (!openHistorySet.has(key)) {
                    console.log(`[scout_distribution] Found ghost assignment for User ${assignment.userId}, Player ${assignment.playerId}. Restoring history...`);
                    ghostsToRestore.push({
                        userId: assignment.userId,
                        playerId: assignment.playerId,
                        scoutCount: assignment.scoutCount,
                        // Use assignment update time, or fallback to start of this window
                        startedAt: assignment.updatedAt ? new Date(assignment.updatedAt) : hourStart,
                        endedAt: null
                    });
                }
            }
        }

        if (ghostsToRestore.length > 0) {
            console.log(`[scout_distribution] Restoring ${ghostsToRestore.length} ghost history records...`);
            // Insert in chunks to be safe
            const chunkSize = 100;
            for (let i = 0; i < ghostsToRestore.length; i += chunkSize) {
                await db.insert(scoutHistory).values(ghostsToRestore.slice(i, i + chunkSize));
            }
        }

        // --- PHASE 2: CALCULATE DISTRIBUTIONS (Time-Weighted) ---
        // We use a CTE to calculate the overlap of each history record with the [hourStart, hourEnd] window.
        // Formula: duration = LEAST(ended_at, hourEnd) - GREATEST(started_at, hourStart)

        const distributions = await db.execute(sql`
            WITH active_users AS (
                SELECT id 
                FROM users 
                WHERE last_active_at > ${hourStart.toISOString()}::timestamp - INTERVAL '24 hours'
            ),
            history_periods AS (
                SELECT
                    sh.user_id,
                    sh.player_id,
                    sh.scout_count,
                    GREATEST(sh.started_at, ${hourStart.toISOString()}::timestamp) as effective_start,
                    LEAST(COALESCE(sh.ended_at, ${hourEnd.toISOString()}::timestamp), ${hourEnd.toISOString()}::timestamp) as effective_end
                FROM scout_history sh
                JOIN active_users u ON sh.user_id = u.id
                WHERE 
                    sh.started_at < ${hourEnd.toISOString()}::timestamp
                    AND (sh.ended_at IS NULL OR sh.ended_at > ${hourStart.toISOString()}::timestamp)
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
                FLOOR((60.0 * ut.user_scout_minutes / pt.global_scout_minutes) * 100) / 100 as "sharesEarned"
            FROM user_totals ut
            JOIN player_totals pt ON ut.player_id = pt.player_id
            WHERE pt.global_scout_minutes > 0
        `);

        // distributions.rows is an array of objects
        const results = distributions.rows as any[];
        console.log(`[scout_distribution] Calculated ${results.length} distributions to process.`);

        if (results.length === 0) {
            return { requestCount: 0, recordsProcessed: 0, errorCount: 0 };
        }

        const ledgerEntries = [];

        for (const row of results) {
            try {
                const sharesEarned = parseFloat(row.sharesEarned);

                if (sharesEarned > 0) {
                    await storage.creditScoutShares(row.userId, row.playerId, sharesEarned);

                    ledgerEntries.push({
                        hourTimestamp: hourEnd, // Timestamp for the ledger is the END of the processed hour
                        playerId: row.playerId,
                        userId: row.userId,
                        userScoutMinutes: Math.round(parseFloat(row.userScoutMinutes)),
                        globalScoutMinutes: Math.round(parseFloat(row.globalScoutMinutes)),
                        sharesEarned: row.sharesEarned.toString(),
                    });

                    recordsProcessed++;
                }
            } catch (err: any) {
                console.error(`[scout_distribution] Error distributing to user ${row.userId} for player ${row.playerId}:`, err.message);
                errorCount++;
            }
        }

        // Bulk insert ledger entries
        if (ledgerEntries.length > 0) {
            const chunkSize = 1000;
            for (let i = 0; i < ledgerEntries.length; i += chunkSize) {
                const chunk = ledgerEntries.slice(i, i + chunkSize);
                await Promise.all(chunk.map(entry => storage.createScoutDistribution(entry)));
            }
        }

        console.log(`[scout_distribution] Completed: ${recordsProcessed} distributions, ${errorCount} errors`);

        // Notify clients to refresh portfolio
        if (recordsProcessed > 0) {
            broadcast({ type: "scout_payout", count: recordsProcessed });
        }

    } catch (err: any) {
        console.error("[scout_distribution] Job failed:", err.message);
        errorCount++;
    }

    return {
        requestCount: 0,
        recordsProcessed,
        errorCount,
    };
}
