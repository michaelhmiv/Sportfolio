import { botProfiles, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";

interface BotConfig {
  username: string;
  botName: string;
  botRole: "market_maker" | "trader" | "casual" | "contest" | "cold_market";
  balance: string;
  aggressiveness: string;
  spreadPercent: string;
  maxOrderSize: number;
  minOrderSize: number;
  maxDailyOrders: number;
  maxDailyVolume: number;
  minActionCooldownMs: number;
  maxActionCooldownMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
}

const BOT_CONFIGS: BotConfig[] = [
  // ── Market Makers ──
  {
    username: "MarketMaker_Alpha",
    botName: "Market Maker Alpha",
    botRole: "market_maker",
    balance: "10000.00",
    aggressiveness: "0.55",
    spreadPercent: "1.50",
    maxOrderSize: 150,
    minOrderSize: 15,
    maxDailyOrders: 20,
    maxDailyVolume: 50000,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 480000,
    activeHoursStart: 8,
    activeHoursEnd: 23,
  },
  {
    username: "MarketMaker_Beta",
    botName: "Market Maker Beta",
    botRole: "market_maker",
    balance: "10000.00",
    aggressiveness: "0.50",
    spreadPercent: "2.00",
    maxOrderSize: 200,
    minOrderSize: 20,
    maxDailyOrders: 20,
    maxDailyVolume: 50000,
    minActionCooldownMs: 180000,
    maxActionCooldownMs: 600000,
    activeHoursStart: 9,
    activeHoursEnd: 22,
  },
  // ── Traders ──
  {
    username: "MomentumTrader",
    botName: "Momentum Trader",
    botRole: "trader",
    balance: "10000.00",
    aggressiveness: "0.35",
    spreadPercent: "1.00",
    maxOrderSize: 200,
    minOrderSize: 20,
    maxDailyOrders: 15,
    maxDailyVolume: 40000,
    minActionCooldownMs: 180000,
    maxActionCooldownMs: 720000,
    activeHoursStart: 9,
    activeHoursEnd: 23,
  },
  {
    username: "ValueTrader_01",
    botName: "Value Trader One",
    botRole: "trader",
    balance: "10000.00",
    aggressiveness: "0.30",
    spreadPercent: "2.00",
    maxOrderSize: 150,
    minOrderSize: 15,
    maxDailyOrders: 15,
    maxDailyVolume: 35000,
    minActionCooldownMs: 300000,
    maxActionCooldownMs: 900000,
    activeHoursStart: 10,
    activeHoursEnd: 22,
  },
  {
    username: "SteadyEddie",
    botName: "Steady Eddie",
    botRole: "trader",
    balance: "10000.00",
    aggressiveness: "0.25",
    spreadPercent: "2.50",
    maxOrderSize: 100,
    minOrderSize: 10,
    maxDailyOrders: 15,
    maxDailyVolume: 30000,
    minActionCooldownMs: 240000,
    maxActionCooldownMs: 1200000,
    activeHoursStart: 10,
    activeHoursEnd: 21,
  },
  {
    username: "WhaleWatch",
    botName: "Whale Watch",
    botRole: "trader",
    balance: "10000.00",
    aggressiveness: "0.20",
    spreadPercent: "3.00",
    maxOrderSize: 300,
    minOrderSize: 30,
    maxDailyOrders: 15,
    maxDailyVolume: 50000,
    minActionCooldownMs: 360000,
    maxActionCooldownMs: 1800000,
    activeHoursStart: 11,
    activeHoursEnd: 20,
  },
  // ── Casuals ──
  {
    username: "CasualJoe",
    botName: "Casual Joe",
    botRole: "casual",
    balance: "10000.00",
    aggressiveness: "0.15",
    spreadPercent: "4.00",
    maxOrderSize: 60,
    minOrderSize: 10,
    maxDailyOrders: 8,
    maxDailyVolume: 15000,
    minActionCooldownMs: 600000,
    maxActionCooldownMs: 3600000,
    activeHoursStart: 11,
    activeHoursEnd: 22,
  },
  {
    username: "RookieTrader",
    botName: "Rookie Trader",
    botRole: "casual",
    balance: "10000.00",
    aggressiveness: "0.12",
    spreadPercent: "3.50",
    maxOrderSize: 50,
    minOrderSize: 5,
    maxDailyOrders: 8,
    maxDailyVolume: 12000,
    minActionCooldownMs: 600000,
    maxActionCooldownMs: 3600000,
    activeHoursStart: 13,
    activeHoursEnd: 23,
  },
  // ── Contest / Boost Specialists ──
  {
    username: "ContestSpecialist",
    botName: "Contest Specialist",
    botRole: "contest",
    balance: "10000.00",
    aggressiveness: "0.30",
    spreadPercent: "2.00",
    maxOrderSize: 120,
    minOrderSize: 15,
    maxDailyOrders: 12,
    maxDailyVolume: 30000,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 600000,
    activeHoursStart: 10,
    activeHoursEnd: 23,
  },
  {
    username: "ContestKing",
    botName: "Contest King",
    botRole: "contest",
    balance: "10000.00",
    aggressiveness: "0.25",
    spreadPercent: "2.50",
    maxOrderSize: 100,
    minOrderSize: 10,
    maxDailyOrders: 12,
    maxDailyVolume: 25000,
    minActionCooldownMs: 180000,
    maxActionCooldownMs: 900000,
    activeHoursStart: 11,
    activeHoursEnd: 23,
  },
  // ── Cold Market Specialists ──
  {
    username: "ColdMarketAlpha",
    botName: "Cold Market Alpha",
    botRole: "cold_market",
    balance: "10000.00",
    aggressiveness: "0.20",
    spreadPercent: "2.00",
    maxOrderSize: 60,
    minOrderSize: 10,
    maxDailyOrders: 8,
    maxDailyVolume: 15000,
    minActionCooldownMs: 600000,
    maxActionCooldownMs: 3600000,
    activeHoursStart: 8,
    activeHoursEnd: 22,
  },
  {
    username: "ColdMarketBeta",
    botName: "Cold Market Beta",
    botRole: "cold_market",
    balance: "10000.00",
    aggressiveness: "0.18",
    spreadPercent: "2.50",
    maxOrderSize: 50,
    minOrderSize: 10,
    maxDailyOrders: 8,
    maxDailyVolume: 12000,
    minActionCooldownMs: 720000,
    maxActionCooldownMs: 3600000,
    activeHoursStart: 9,
    activeHoursEnd: 22,
  },
];

export async function seedBots(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const config of BOT_CONFIGS) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, config.username))
      .limit(1);

    if (existing.length > 0) {
      console.log(`Bot ${config.username} already exists, skipping`);
      skipped++;
      continue;
    }

    const [newUser] = await db
      .insert(users)
      .values({
        username: config.username,
        balance: config.balance,
        isBot: true,
        isPremium: true,
        hasSeenOnboarding: true,
      })
      .returning();

    await db.insert(botProfiles).values({
      userId: newUser.id,
      botName: config.botName,
      botRole: config.botRole,
      aggressiveness: config.aggressiveness,
      spreadPercent: config.spreadPercent,
      maxOrderSize: config.maxOrderSize,
      minOrderSize: config.minOrderSize,
      maxDailyOrders: config.maxDailyOrders,
      maxDailyVolume: config.maxDailyVolume,
      minActionCooldownMs: config.minActionCooldownMs,
      maxActionCooldownMs: config.maxActionCooldownMs,
      activeHoursStart: config.activeHoursStart,
      activeHoursEnd: config.activeHoursEnd,
    });

    console.log(`Created bot: ${config.username} (${config.botRole}) with $${config.balance}`);
    created++;
  }

  return { created, skipped };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedBots()
    .then((result) => {
      console.log(`\nBot seeding complete: ${result.created} created, ${result.skipped} skipped`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Bot seeding failed:", error);
      process.exit(1);
    });
}
