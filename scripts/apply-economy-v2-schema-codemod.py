#!/usr/bin/env python3
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "shared/schema.ts"
text = SCHEMA.read_text()


def remove_between(source: str, start: str, end: str) -> str:
    if start not in source:
        return source
    a = source.index(start)
    b = source.index(end, a)
    return source[:a] + source[b:]


# Delete canonical Stack tables/types from the active Drizzle schema.
text = remove_between(
    text,
    "// Player multipliers table - one non-tradeable stacked-share record per user/player",
    "// Holdings locks table - tracks reserved/locked shares to prevent double-spending",
)

# Replace the old Boost + share-payout schema with Economy V2 tables.
start = "// Daily Boosts table - daily multiplier-based payouts"
end = "// Community Boosts table - global 5x boosts created by premium share redemption"
if start in text:
    a = text.index(start)
    b = text.index(end, a)
    v2 = r'''// Daily Boosts table - direct-share one-game multiplier strategy.
export const dailyBoosts = pgTable(
  "daily_boosts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sport: text("sport").notNull(),
    slotTier: integer("slot_tier").notNull(), // exactly 2, 3, 5, 7, or 10
    boostDate: timestamp("boost_date").notNull(),
    sharesEntered: decimal("shares_entered", { precision: 20, scale: 4 }).notNull(),
    sharesBurned: decimal("shares_burned", { precision: 20, scale: 4 }).notNull().default("0"),
    gameId: text("game_id"),
    status: text("status").notNull().default("active"),
    fantasyPoints: decimal("fantasy_points", { precision: 12, scale: 4 }),
    gameEpsSb: decimal("game_eps_sb", { precision: 24, scale: 8 }),
    baseComponentSb: decimal("base_component_sb", { precision: 20, scale: 4 }),
    boostBonusSb: decimal("boost_bonus_sb", { precision: 20, scale: 4 }),
    totalEconomicEarningsSb: decimal("total_economic_earnings_sb", { precision: 20, scale: 4 }),
    payout: decimal("payout", { precision: 20, scale: 2 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    userDateIdx: index("boost_user_date_idx").on(table.userId, table.boostDate),
    userSportDateIdx: index("boost_user_sport_date_idx").on(table.userId, table.sport, table.boostDate),
    statusIdx: index("boost_status_idx").on(table.status),
    playerIdx: index("boost_player_idx").on(table.playerId),
    gameIdx: index("boost_game_idx").on(table.gameId),
    slotTierCheck: check("daily_boosts_slot_tier_check", sql`${table.slotTier} IN (2,3,5,7,10)`),
    sharesCheck: check("daily_boosts_shares_entered_check", sql`${table.sharesEntered} > 0`),
  }),
);

export const boostPayouts = pgTable(
  "boost_payouts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    boostId: varchar("boost_id")
      .notNull()
      .references(() => dailyBoosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id").notNull(),
    sharesUsed: decimal("shares_used", { precision: 20, scale: 4 }).notNull(),
    fantasyPoints: decimal("fantasy_points", { precision: 12, scale: 4 }).notNull(),
    multiplier: integer("multiplier").notNull(),
    gameEpsSb: decimal("game_eps_sb", { precision: 24, scale: 8 }).notNull(),
    baseComponentSb: decimal("base_component_sb", { precision: 20, scale: 4 }).notNull(),
    boostBonusSb: decimal("boost_bonus_sb", { precision: 20, scale: 4 }).notNull(),
    totalEconomicEarningsSb: decimal("total_economic_earnings_sb", { precision: 20, scale: 4 }).notNull(),
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("boost_payout_user_idx").on(table.userId, table.createdAt),
    playerGameIdx: index("boost_payout_player_game_idx").on(table.playerId, table.gameId),
    boostIdx: uniqueIndex("boost_payout_boost_unique_idx").on(table.boostId),
  }),
);

export const sharePayouts = pgTable(
  "share_payouts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id").notNull(),
    eligibleShares: decimal("eligible_shares", { precision: 20, scale: 4 }).notNull(),
    fantasyPoints: decimal("fantasy_points", { precision: 12, scale: 4 }),
    gameEpsSb: decimal("game_eps_sb", { precision: 24, scale: 8 }),
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 4 }),
    status: text("status").notNull().default("pending"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    userIdx: index("share_payout_user_idx").on(table.userId),
    gameStatusIdx: index("share_payout_game_status_idx").on(table.gameId, table.status),
    playerGameIdx: index("share_payout_player_game_idx").on(table.playerId, table.gameId),
    userPlayerGameIdx: uniqueIndex("share_payout_user_player_game_idx").on(
      table.userId,
      table.playerId,
      table.gameId,
    ),
  }),
);

export const playerGameEarnings = pgTable(
  "player_game_earnings",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameId: text("game_id").notNull(),
    sport: text("sport").notNull(),
    economyVersion: text("economy_version").notNull(),
    seasonPhase: text("season_phase").notNull(),
    economyClass: text("economy_class").notNull(),
    seasonTargetSb: decimal("season_target_sb", { precision: 20, scale: 4 }).notNull(),
    benchmarkFantasyPoints: decimal("benchmark_fantasy_points", { precision: 20, scale: 4 }).notNull(),
    totalEligibleShares: decimal("total_eligible_shares", { precision: 24, scale: 4 }).notNull().default("0"),
    fantasyPoints: decimal("fantasy_points", { precision: 12, scale: 4 }),
    sbPerFantasyPoint: decimal("sb_per_fantasy_point", { precision: 24, scale: 8 }),
    basePoolSb: decimal("base_pool_sb", { precision: 24, scale: 4 }),
    gameEpsSb: decimal("game_eps_sb", { precision: 24, scale: 8 }),
    status: text("status").notNull().default("snapshotted"),
    snapshottedAt: timestamp("snapshotted_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    playerGameIdx: uniqueIndex("player_game_earnings_unique").on(table.playerId, table.gameId),
    gameStatusIdx: index("player_game_earnings_game_status_idx").on(table.gameId, table.status),
    phaseCreatedIdx: index("player_game_earnings_phase_created_idx").on(table.seasonPhase, table.snapshottedAt),
  }),
);

export const economyEvents = pgTable(
  "economy_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    playerId: varchar("player_id").references(() => players.id, { onDelete: "set null" }),
    gameId: text("game_id"),
    sbDelta: decimal("sb_delta", { precision: 24, scale: 4 }).notNull().default("0"),
    sharesDelta: decimal("shares_delta", { precision: 24, scale: 4 }).notNull().default("0"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    typeCreatedIdx: index("economy_events_type_created_idx").on(table.eventType, table.createdAt),
    playerCreatedIdx: index("economy_events_player_created_idx").on(table.playerId, table.createdAt),
    userCreatedIdx: index("economy_events_user_created_idx").on(table.userId, table.createdAt),
  }),
);

'''
    text = text[:a] + v2 + text[b:]

# Remove Stack relations and relation members.
for line in [
    "  playerMultipliers: many(playerMultipliers),\n",
    "  playerMultiplierEvents: many(playerMultiplierEvents),\n",
]:
    text = text.replace(line, "")
text = remove_between(text, "export const playerMultipliersRelations", "export const ordersRelations")

# Remove Stack insert schemas and public types.
text = remove_between(text, "export const insertPlayerMultiplierSchema", "export const insertHoldingsLockSchema")
text = text.replace("export type PlayerMultiplier = typeof playerMultipliers.$inferSelect;\n", "")
text = text.replace("export type InsertPlayerMultiplier = z.infer<typeof insertPlayerMultiplierSchema>;\n\n", "")
text = text.replace("export type PlayerMultiplierEvent = typeof playerMultiplierEvents.$inferSelect;\n", "")
text = text.replace("export type InsertPlayerMultiplierEvent = z.infer<typeof insertPlayerMultiplierEventSchema>;\n\n", "")

# Add Economy V2 insert schemas/types next to the payout types.
needle = '''export type SharePayout = typeof sharePayouts.$inferSelect;
export type InsertSharePayout = z.infer<typeof insertSharePayoutSchema>;
'''
addition = needle + '''
export const insertPlayerGameEarningsSchema = createInsertSchema(playerGameEarnings).omit({
  id: true,
  snapshottedAt: true,
  processedAt: true,
});
export type PlayerGameEarnings = typeof playerGameEarnings.$inferSelect;
export type InsertPlayerGameEarnings = z.infer<typeof insertPlayerGameEarningsSchema>;

export const insertEconomyEventSchema = createInsertSchema(economyEvents).omit({
  id: true,
  createdAt: true,
});
export type EconomyEvent = typeof economyEvents.$inferSelect;
export type InsertEconomyEvent = z.infer<typeof insertEconomyEventSchema>;
'''
if needle in text and "insertPlayerGameEarningsSchema" not in text:
    text = text.replace(needle, addition, 1)

SCHEMA.write_text(text)

# Add canonical operations to package scripts.
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text())
scripts = package.setdefault("scripts", {})
scripts["db:migrate:economy-v2"] = "node scripts/apply-economy-v2-migration.mjs"
scripts["economy:simulate"] = "tsx scripts/simulate-economy-v2.ts"
scripts["economy:calibrate"] = "tsx scripts/calibrate-economy-v2.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n")

# Delete files whose only purpose was the retired Stack feature. Imports/tests elsewhere are allowed
# to fail compilation on this pass; that failure is the inventory used for the next cleanup pass.
for relative in [
    "server/lib/stack-shares-response.ts",
    "server/lib/stack-shares-response.test.ts",
    "server/storage.stack-shares.test.ts",
    "client/src/components/portfolio-stacking-tab.tsx",
    "client/src/pages/portfolio-stack-feedback.ts",
    "client/src/pages/portfolio-stack-feedback.test.ts",
    "client/src/pages/portfolio-stacking-helpers.ts",
    "client/src/pages/portfolio-stacking-helpers.test.ts",
    "scripts/debug-prod-boost-power.ts",
]:
    path = ROOT / relative
    if path.exists():
        path.unlink()

print("Economy V2 destructive schema/Stack cleanup applied")
