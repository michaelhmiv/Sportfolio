import { botActionsLog, botProfiles } from "@shared/schema";
import { eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  runDeterministicBotEngineTick,
  getDeterministicEngineStatus,
} from "./deterministic-engine";

export interface BotProfile {
  id: string;
  userId: string;
  botName: string;
  botRole: string;
  isActive: boolean;
  aggressiveness: string;
  spreadPercent: string;
  maxOrderSize: number;
  minOrderSize: number;
  maxDailyOrders: number;
  maxDailyVolume: number;
  strategyPrompt?: string;
  allowedMechanics?: string[];
  objectiveWeights?: Record<string, unknown>;
  researchEnabled?: boolean;
  researchQueryBudget?: number;
  researchTtlMinutes?: number;
  maxActionsPerTick?: number;
  maxPlayerExposurePercent?: string;
  minActionCooldownMs: number;
  maxActionCooldownMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  lastActionAt: Date | null;
  ordersToday: number;
  volumeToday: number;
  lastResetDate: Date;
}

export interface BotAction {
  actionType: string;
  actionDetails: Record<string, unknown>;
  triggerReason: string;
  success: boolean;
  errorMessage?: string;
}

export async function logBotAction(botUserId: string, action: BotAction): Promise<void> {
  await db.insert(botActionsLog).values({
    botUserId,
    actionType: action.actionType,
    actionDetails: action.actionDetails,
    triggerReason: action.triggerReason,
    success: action.success,
    errorMessage: action.errorMessage || null,
  });
}

export async function updateBotCounters(
  profileId: string,
  ordersPlaced: number,
  volumeTraded: number,
): Promise<void> {
  await db
    .update(botProfiles)
    .set({
      ordersToday: sql`${botProfiles.ordersToday} + ${Math.max(0, Math.round(ordersPlaced))}`,
      volumeToday: sql`${botProfiles.volumeToday} + ${Math.max(0, Math.round(volumeTraded))}`,
      updatedAt: new Date(),
    })
    .where(eq(botProfiles.id, profileId));
}

export async function updateBotVolume(profileId: string, volumeAdded: number): Promise<void> {
  await db
    .update(botProfiles)
    .set({
      volumeToday: sql`${botProfiles.volumeToday} + ${Math.max(0, Math.round(volumeAdded))}`,
      updatedAt: new Date(),
    })
    .where(eq(botProfiles.id, profileId));
}

export async function runBotEngineTick(): Promise<{
  botsProcessed: number;
  botsSkipped: number;
  errors: number;
}> {
  return runDeterministicBotEngineTick();
}

export async function getBotStats(): Promise<{
  totalBots: number;
  activeBots: number;
  botsByRole: Record<string, number>;
  totalActionsToday: number;
}> {
  const [allProfiles, engineStatus] = await Promise.all([
    db.select().from(botProfiles),
    getDeterministicEngineStatus(),
  ]);

  const botsByRole: Record<string, number> = {};
  for (const profile of allProfiles) {
    botsByRole[profile.botRole] = (botsByRole[profile.botRole] || 0) + 1;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [actionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(botActionsLog)
    .where(gte(botActionsLog.createdAt, today));

  return {
    totalBots: engineStatus.activeBots,
    activeBots: engineStatus.activeBots,
    botsByRole,
    totalActionsToday: actionCount?.count || 0,
  };
}
