import { botProfiles, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";

interface BotConfig {
  username: string;
  botName: string;
  botRole: "market_maker" | "trader" | "casual" | "contest";
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
  {
    username: "MarketMaker_Alpha",
    botName: "Market Maker Alpha",
    botRole: "market_maker",
    balance: "50000.00",
    aggressiveness: "0.80",
    spreadPercent: "1.50",
    maxOrderSize: 150,
    minOrderSize: 10,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 30000,
    maxActionCooldownMs: 120000,
    activeHoursStart: 6,
    activeHoursEnd: 23,
  },
  {
    username: "MarketMaker_Beta",
    botName: "Market Maker Beta",
    botRole: "market_maker",
    balance: "40000.00",
    aggressiveness: "0.50",
    spreadPercent: "2.50",
    maxOrderSize: 200,
    minOrderSize: 20,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 60000,
    maxActionCooldownMs: 240000,
    activeHoursStart: 8,
    activeHoursEnd: 22,
  },
  {
    username: "ValueTrader_01",
    botName: "Value Trader One",
    botRole: "trader",
    balance: "25000.00",
    aggressiveness: "0.30",
    spreadPercent: "3.00",
    maxOrderSize: 80,
    minOrderSize: 5,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 600000,
    activeHoursStart: 9,
    activeHoursEnd: 21,
  },
  {
    username: "MomentumTrader",
    botName: "Momentum Trader",
    botRole: "trader",
    balance: "30000.00",
    aggressiveness: "0.85",
    spreadPercent: "1.00",
    maxOrderSize: 100,
    minOrderSize: 10,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 20000,
    maxActionCooldownMs: 90000,
    activeHoursStart: 7,
    activeHoursEnd: 23,
  },
  {
    username: "SignalHunter",
    botName: "Signal Hunter",
    botRole: "trader",
    balance: "20000.00",
    aggressiveness: "0.60",
    spreadPercent: "2.00",
    maxOrderSize: 50,
    minOrderSize: 5,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 60000,
    maxActionCooldownMs: 300000,
    activeHoursStart: 10,
    activeHoursEnd: 22,
  },
  {
    username: "CasualJoe",
    botName: "Casual Joe",
    botRole: "casual",
    balance: "15000.00",
    aggressiveness: "0.20",
    spreadPercent: "4.00",
    maxOrderSize: 30,
    minOrderSize: 2,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 300000,
    maxActionCooldownMs: 900000,
    activeHoursStart: 12,
    activeHoursEnd: 20,
  },
  {
    username: "SteadyEddie",
    botName: "Steady Eddie",
    botRole: "trader",
    balance: "18000.00",
    aggressiveness: "0.35",
    spreadPercent: "2.50",
    maxOrderSize: 40,
    minOrderSize: 5,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 180000,
    maxActionCooldownMs: 600000,
    activeHoursStart: 9,
    activeHoursEnd: 21,
  },
  {
    username: "WhaleWatch",
    botName: "Whale Watch",
    botRole: "trader",
    balance: "100000.00",
    aggressiveness: "0.15",
    spreadPercent: "5.00",
    maxOrderSize: 500,
    minOrderSize: 50,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 600000,
    maxActionCooldownMs: 1800000,
    activeHoursStart: 10,
    activeHoursEnd: 18,
  },
  {
    username: "RookieTrader",
    botName: "Rookie Trader",
    botRole: "casual",
    balance: "10000.00",
    aggressiveness: "0.40",
    spreadPercent: "3.50",
    maxOrderSize: 25,
    minOrderSize: 1,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 480000,
    activeHoursStart: 14,
    activeHoursEnd: 22,
  },
  {
    username: "ContestSpecialist",
    botName: "Contest Specialist",
    botRole: "contest",
    balance: "22000.00",
    aggressiveness: "0.45",
    spreadPercent: "2.00",
    maxOrderSize: 60,
    minOrderSize: 5,
    maxDailyOrders: 999999,
    maxDailyVolume: 999999,
    minActionCooldownMs: 90000,
    maxActionCooldownMs: 360000,
    activeHoursStart: 8,
    activeHoursEnd: 23,
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
