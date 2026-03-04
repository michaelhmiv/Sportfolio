/**
 * Seed DEV Database with Diverse Bot Profiles
 * Creates bot personas with varied trading behaviors.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as dotenv from "dotenv";
import * as path from "path";
import * as schema from "../shared/schema";
import { eq } from "drizzle-orm";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Error: DEV_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

interface BotConfig {
  name: string;
  role: string;
  aggressiveness: number;
  spreadPercent: number;
  minOrderSize: number;
  maxOrderSize: number;
  maxDailyOrders: number;
  maxDailyVolume: number;
  targetTiers: number[] | null;
  vestingClaimThreshold: number;
  maxPlayersToVest: number;
  minCooldownMs: number;
  maxCooldownMs: number;
}

const BOT_CONFIGS: BotConfig[] = [
  {
    name: "Whale_Alpha",
    role: "market_maker",
    aggressiveness: 0.9,
    spreadPercent: 1.0,
    minOrderSize: 50,
    maxOrderSize: 200,
    maxDailyOrders: 200,
    maxDailyVolume: 5000,
    targetTiers: [1, 2],
    vestingClaimThreshold: 0.8,
    maxPlayersToVest: 10,
    minCooldownMs: 30000,
    maxCooldownMs: 120000,
  },
  {
    name: "Scout_Beta",
    role: "market_maker",
    aggressiveness: 0.3,
    spreadPercent: 4.0,
    minOrderSize: 5,
    maxOrderSize: 20,
    maxDailyOrders: 300,
    maxDailyVolume: 2000,
    targetTiers: null,
    vestingClaimThreshold: 0.9,
    maxPlayersToVest: 20,
    minCooldownMs: 60000,
    maxCooldownMs: 300000,
  },
  {
    name: "VolatilityTrader",
    role: "trader",
    aggressiveness: 0.85,
    spreadPercent: 2.0,
    minOrderSize: 20,
    maxOrderSize: 80,
    maxDailyOrders: 150,
    maxDailyVolume: 4000,
    targetTiers: [1, 2, 3],
    vestingClaimThreshold: 0.75,
    maxPlayersToVest: 5,
    minCooldownMs: 45000,
    maxCooldownMs: 180000,
  },
  {
    name: "ValueHunter",
    role: "trader",
    aggressiveness: 0.4,
    spreadPercent: 3.5,
    minOrderSize: 10,
    maxOrderSize: 50,
    maxDailyOrders: 100,
    maxDailyVolume: 2500,
    targetTiers: [3, 4, 5],
    vestingClaimThreshold: 0.95,
    maxPlayersToVest: 15,
    minCooldownMs: 120000,
    maxCooldownMs: 600000,
  },
  {
    name: "MomentumBot",
    role: "trader",
    aggressiveness: 0.7,
    spreadPercent: 2.5,
    minOrderSize: 15,
    maxOrderSize: 60,
    maxDailyOrders: 120,
    maxDailyVolume: 3000,
    targetTiers: [1, 2, 3],
    vestingClaimThreshold: 0.85,
    maxPlayersToVest: 8,
    minCooldownMs: 60000,
    maxCooldownMs: 240000,
  },
  {
    name: "ColdMarketSeeder",
    role: "market_maker",
    aggressiveness: 0.5,
    spreadPercent: 5.0,
    minOrderSize: 5,
    maxOrderSize: 25,
    maxDailyOrders: 500,
    maxDailyVolume: 3000,
    targetTiers: null,
    vestingClaimThreshold: 0.9,
    maxPlayersToVest: 25,
    minCooldownMs: 30000,
    maxCooldownMs: 120000,
  },
  {
    name: "CasualTrader",
    role: "casual",
    aggressiveness: 0.25,
    spreadPercent: 5.0,
    minOrderSize: 3,
    maxOrderSize: 15,
    maxDailyOrders: 30,
    maxDailyVolume: 500,
    targetTiers: [1, 2],
    vestingClaimThreshold: 0.95,
    maxPlayersToVest: 3,
    minCooldownMs: 300000,
    maxCooldownMs: 900000,
  },
  {
    name: "SignalHunter",
    role: "trader",
    aggressiveness: 0.6,
    spreadPercent: 3.0,
    minOrderSize: 10,
    maxOrderSize: 40,
    maxDailyOrders: 80,
    maxDailyVolume: 2000,
    targetTiers: [1, 2, 3],
    vestingClaimThreshold: 0.7,
    maxPlayersToVest: 12,
    minCooldownMs: 90000,
    maxCooldownMs: 300000,
  },
];

async function seedBots() {
  console.log("Seeding DEV database with bot profiles...");

  let created = 0;
  let skipped = 0;

  for (const config of BOT_CONFIGS) {
    try {
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, config.name))
        .limit(1);

      if (existingUser.length > 0) {
        console.log(`Skipping existing bot ${config.name}`);
        skipped++;
        continue;
      }

      const [user] = await db
        .insert(schema.users)
        .values({
          username: config.name,
          email: `${config.name.toLowerCase()}@bot.sportfolio.dev`,
          firstName: config.name.split("_")[0],
          lastName: "Bot",
          balance: "50000.00",
          isBot: true,
          isAdmin: false,
          isPremium: false,
          hasSeenOnboarding: true,
        })
        .returning();

      await db.insert(schema.botProfiles).values({
        userId: user.id,
        botName: config.name,
        botRole: config.role,
        isActive: true,
        aggressiveness: config.aggressiveness.toFixed(2),
        spreadPercent: config.spreadPercent.toFixed(2),
        minOrderSize: config.minOrderSize,
        maxOrderSize: config.maxOrderSize,
        maxDailyOrders: config.maxDailyOrders,
        maxDailyVolume: config.maxDailyVolume,
        targetTiers: config.targetTiers,
        vestingClaimThreshold: config.vestingClaimThreshold.toFixed(2),
        maxPlayersToVest: config.maxPlayersToVest,
        minActionCooldownMs: config.minCooldownMs,
        maxActionCooldownMs: config.maxCooldownMs,
        activeHoursStart: 0,
        activeHoursEnd: 23,
        ordersToday: 0,
        volumeToday: 0,
        lastResetDate: new Date(),
      });

      console.log(`Created ${config.name} (${config.role})`);
      created++;
    } catch (error: any) {
      console.error(`Failed to create ${config.name}:`, error.message);
    }
  }

  console.log(`Done. Created ${created} bots, skipped ${skipped}.`);

  const profiles = await db.select().from(schema.botProfiles);
  console.log(`Total bot profiles in database: ${profiles.length}`);

  await pool.end();
}

seedBots().catch(console.error);
