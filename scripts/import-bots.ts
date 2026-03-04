/**
 * Bot Import Script - Creates bot users and profiles from static config data.
 */

import { Pool } from "pg";
import { randomUUID } from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOT_CONFIGS = [
  {
    username: "hoopsdynasty23",
    botName: "Market Maker Alpha",
    botRole: "market_maker",
    aggressiveness: "0.80",
    spreadPercent: "1.50",
    maxOrderSize: 150,
    minOrderSize: 10,
    vestingClaimThreshold: "0.90",
    maxPlayersToVest: 8,
    minActionCooldownMs: 30000,
    maxActionCooldownMs: 120000,
    targetTiers: [1, 2],
  },
  {
    username: "jayson_trader",
    botName: "Market Maker Beta",
    botRole: "market_maker",
    aggressiveness: "0.50",
    spreadPercent: "2.50",
    maxOrderSize: 200,
    minOrderSize: 20,
    vestingClaimThreshold: "0.85",
    maxPlayersToVest: 6,
    minActionCooldownMs: 60000,
    maxActionCooldownMs: 240000,
    targetTiers: [2, 3],
  },
  {
    username: "ballin_investor",
    botName: "Whale Watch",
    botRole: "trader",
    aggressiveness: "0.15",
    spreadPercent: "5.00",
    maxOrderSize: 500,
    minOrderSize: 50,
    vestingClaimThreshold: "0.95",
    maxPlayersToVest: 3,
    minActionCooldownMs: 600000,
    maxActionCooldownMs: 1800000,
    targetTiers: [2, 4],
  },
  {
    username: "dunk_master_99",
    botName: "Value Trader One",
    botRole: "trader",
    aggressiveness: "0.30",
    spreadPercent: "3.00",
    maxOrderSize: 80,
    minOrderSize: 5,
    vestingClaimThreshold: "0.80",
    maxPlayersToVest: 4,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 600000,
    targetTiers: [1, 3, 5],
  },
  {
    username: "courtside_capital",
    botName: "Steady Eddie",
    botRole: "trader",
    aggressiveness: "0.35",
    spreadPercent: "2.50",
    maxOrderSize: 40,
    minOrderSize: 5,
    vestingClaimThreshold: "0.85",
    maxPlayersToVest: 5,
    minActionCooldownMs: 180000,
    maxActionCooldownMs: 600000,
    targetTiers: null,
  },
  {
    username: "fantasy_baller",
    botName: "Signal Hunter",
    botRole: "trader",
    aggressiveness: "0.60",
    spreadPercent: "2.00",
    maxOrderSize: 50,
    minOrderSize: 5,
    vestingClaimThreshold: "0.75",
    maxPlayersToVest: 10,
    minActionCooldownMs: 60000,
    maxActionCooldownMs: 300000,
    targetTiers: null,
  },
  {
    username: "swish_portfolios",
    botName: "Taker Bot Alpha",
    botRole: "taker",
    aggressiveness: "0.70",
    spreadPercent: "3.00",
    maxOrderSize: 20,
    minOrderSize: 1,
    vestingClaimThreshold: "0.85",
    maxPlayersToVest: 5,
    minActionCooldownMs: 30000,
    maxActionCooldownMs: 60000,
    targetTiers: null,
  },
  {
    username: "triple_double_dave",
    botName: "Momentum Trader",
    botRole: "trader",
    aggressiveness: "0.85",
    spreadPercent: "1.00",
    maxOrderSize: 100,
    minOrderSize: 10,
    vestingClaimThreshold: "0.95",
    maxPlayersToVest: 3,
    minActionCooldownMs: 20000,
    maxActionCooldownMs: 90000,
    targetTiers: [3, 4],
  },
  {
    username: "nba_stonks",
    botName: "Diversify Dan",
    botRole: "vester",
    aggressiveness: "0.45",
    spreadPercent: "2.00",
    maxOrderSize: 60,
    minOrderSize: 5,
    vestingClaimThreshold: "0.80",
    maxPlayersToVest: 10,
    minActionCooldownMs: 90000,
    maxActionCooldownMs: 360000,
    targetTiers: null,
  },
  {
    username: "bucket_hunter",
    botName: "Casual Joe",
    botRole: "casual",
    aggressiveness: "0.20",
    spreadPercent: "4.00",
    maxOrderSize: 30,
    minOrderSize: 2,
    vestingClaimThreshold: "0.70",
    maxPlayersToVest: 3,
    minActionCooldownMs: 300000,
    maxActionCooldownMs: 900000,
    targetTiers: [4, 5],
  },
  {
    username: "fast_break_frank",
    botName: "Rookie Trader",
    botRole: "casual",
    aggressiveness: "0.40",
    spreadPercent: "3.50",
    maxOrderSize: 25,
    minOrderSize: 1,
    vestingClaimThreshold: "0.60",
    maxPlayersToVest: 2,
    minActionCooldownMs: 120000,
    maxActionCooldownMs: 480000,
    targetTiers: null,
  },
];

async function createBots() {
  console.log("Creating bot users and profiles...");

  let created = 0;

  for (const config of BOT_CONFIGS) {
    const userId = randomUUID();
    const profileId = randomUUID();

    try {
      await pool.query(
        `
        INSERT INTO users (
          id, email, username, first_name, last_name, balance,
          is_admin, is_premium, is_bot, has_seen_onboarding,
          total_shares_vested, total_market_orders, total_trades_executed,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, '50000.00',
          false, false, true, true,
          0, 0, 0,
          NOW(), NOW()
        )
      `,
        [
          userId,
          `${config.username}@bot.sportfolio.internal`,
          config.username,
          config.botName.split(" ")[0],
          config.botName.split(" ").slice(1).join(" ") || "Bot",
        ],
      );

      await pool.query(
        `
        INSERT INTO vesting (user_id, shares_accumulated, last_accrued_at, updated_at)
        VALUES ($1, 0, NOW(), NOW())
      `,
        [userId],
      );

      await pool.query(
        `
        INSERT INTO bot_profiles (
          id, user_id, bot_name, bot_role, is_active,
          aggressiveness, spread_percent, max_order_size, min_order_size,
          max_daily_orders, max_daily_volume,
          vesting_claim_threshold, max_players_to_vest,
          min_action_cooldown_ms, max_action_cooldown_ms,
          active_hours_start, active_hours_end,
          orders_today, volume_today,
          last_reset_date, created_at, updated_at, target_tiers
        ) VALUES (
          $1, $2, $3, $4, true,
          $5, $6, $7, $8,
          999999, 999999,
          $9, $10,
          $11, $12,
          0, 24,
          0, 0,
          NOW(), NOW(), NOW(), $13
        )
      `,
        [
          profileId,
          userId,
          config.botName,
          config.botRole,
          config.aggressiveness,
          config.spreadPercent,
          config.maxOrderSize,
          config.minOrderSize,
          config.vestingClaimThreshold,
          config.maxPlayersToVest,
          config.minActionCooldownMs,
          config.maxActionCooldownMs,
          config.targetTiers ? `{${config.targetTiers.join(",")}}` : null,
        ],
      );

      console.log(`Created ${config.username} (${config.botRole})`);
      created++;
    } catch (e: any) {
      console.error(`Failed ${config.username}:`, e.message);
    }
  }

  console.log(`Created ${created}/${BOT_CONFIGS.length} bots`);
  await pool.end();
}

createBots();
