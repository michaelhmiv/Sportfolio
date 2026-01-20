
import { db } from "../db";
import { scoutAssignments, players, users } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { BotProfile, logBotAction } from "./bot-engine";
import { storage } from "../storage";

/**
 * executeScoutStrategy
 * 
 * Logic for bots to manage their scout assignments.
 * 1. Calculate capacity (5 for standard, 10 for pro).
 * 2. Identify "Target" players: High market cap, high volume, or trending.
 * 3. Assign scouts iteratively to targets until capacity is reached.
 * 4. Occasionally rebalance scouts to "chase" users on popular players.
 */
export async function executeScoutStrategy(
    profile: BotProfile & { user: any }
): Promise<void> {
    const userId = profile.userId;
    const isPro = profile.user.isPremium;
    const maxCapacity = isPro ? 10 : 5;

    try {
        // 1. Get current assignments
        const currentAssignments = await storage.getUserScoutAssignments(userId);
        const currentTotal = currentAssignments.reduce((sum, a) => sum + a.scoutCount, 0);

        // 2. Determine if we need to do anything
        // Bots will re-evaluate if they have capacity OR randomly (10% chance) to rebalance
        const hasCapacity = currentTotal < maxCapacity;
        const shouldRebalance = Math.random() < 0.1;

        if (!hasCapacity && !shouldRebalance) {
            return;
        }

        // 3. Identify Target Players
        // We pick top players by market cap/price to simulate "smart" scouting
        const targetPlayers = await db
            .select()
            .from(players)
            .where(eq(players.isActive, true))
            .orderBy(desc(sql`COALESCE(${players.lastTradePrice}, ${players.currentPrice}, '0')::numeric`))
            .limit(20);

        if (targetPlayers.length === 0) return;

        // 4. Deciding how to assign
        // If we have capacity, find a player we aren't scouting or increase count on a high-value one
        if (hasCapacity) {
            const needed = maxCapacity - currentTotal;
            // Pick a random target player
            const target = targetPlayers[Math.floor(Math.random() * targetPlayers.length)];

            // Assign 1-2 scouts at a time to keep it organic
            const toAssign = Math.min(needed, Math.floor(Math.random() * 2) + 1);

            const existing = currentAssignments.find(a => a.playerId === target.id);
            const newCount = (existing?.scoutCount || 0) + toAssign;

            await storage.assignScouts(userId, target.id, newCount);

            await logBotAction(userId, {
                actionType: "scout_assign",
                actionDetails: {
                    playerId: target.id,
                    playerName: `${target.firstName} ${target.lastName}`,
                    count: newCount,
                    isIncrease: !!existing
                },
                triggerReason: "Capacity available or strategic placement",
                success: true
            });

            console.log(`[BotScout] ${profile.botName} assigned ${toAssign} scouts to ${target.firstName} ${target.lastName}`);
        } else if (shouldRebalance && currentAssignments.length > 0) {
            // Rebalance: Remove from one, add to another
            const sourceIdx = Math.floor(Math.random() * currentAssignments.length);
            const source = currentAssignments[sourceIdx];

            // Remove 1 scout from source
            await storage.assignScouts(userId, source.playerId, source.scoutCount - 1);

            // Add to a new random target
            const target = targetPlayers[Math.floor(Math.random() * targetPlayers.length)];
            const existingTarget = currentAssignments.find(a => a.playerId === target.id);
            const newCount = (existingTarget?.scoutCount || 0) + 1;

            await storage.assignScouts(userId, target.id, newCount);

            await logBotAction(userId, {
                actionType: "scout_rebalance",
                actionDetails: {
                    removedFrom: source.playerId,
                    addedTo: target.id,
                    playerName: `${target.firstName} ${target.lastName}`
                },
                triggerReason: "Periodic strategic rebalancing",
                success: true
            });

            console.log(`[BotScout] ${profile.botName} rebalanced 1 scout from ${source.playerId} to ${target.id}`);
        }

    } catch (error: any) {
        console.error(`[BotScout] Error in scout strategy for ${profile.botName}:`, error.message);
        throw error;
    }
}
