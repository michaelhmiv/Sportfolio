import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  decimal,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (for optional session-backed auth flows)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table - core user account
export const users = pgTable(
  "users",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Auth provider fields
    email: varchar("email").unique(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    profileImageUrl: varchar("profile_image_url"),
    // App-specific fields
    username: text("username").unique(), // Optional username, defaults to email
    balance: decimal("balance", { precision: 20, scale: 2 }).notNull().default("10000.00"), // Starting balance: $10,000
    isAdmin: boolean("is_admin").notNull().default(false), // Admin access to system management
    isPremium: boolean("is_premium").notNull().default(false),
    premiumExpiresAt: timestamp("premium_expires_at"),
    hasSeenOnboarding: boolean("has_seen_onboarding").notNull().default(false), // Track if user completed onboarding
    isBot: boolean("is_bot").notNull().default(false), // True for market maker bot accounts
    // Profile stats
    totalSharesVested: integer("total_shares_vested").notNull().default(0),
    totalMarketOrders: integer("total_market_orders").notNull().default(0),
    totalTradesExecuted: integer("total_trades_executed").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // News Hub fields
    lastNewsViewedAt: timestamp("last_news_viewed_at"), // Track when user last viewed news
    newsNotificationsEnabled: boolean("news_notifications_enabled").notNull().default(true), // Opt-out of news notifications
    // Scout Engine fields
    lastActiveAt: timestamp("last_active_at"), // Scout Engine: activity tracking for 24h kill-switch
  },
  (table) => ({
    lastActiveIdx: index("users_last_active_idx").on(table.lastActiveAt),
  }),
);

export const userApiTokens = pgTable(
  "user_api_tokens",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
    tokenLast4: varchar("token_last4", { length: 4 }).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("user_api_tokens_user_idx").on(table.userId),
    hashIdx: uniqueIndex("user_api_tokens_hash_idx").on(table.tokenHash),
    activeIdx: index("user_api_tokens_active_idx").on(table.userId, table.revokedAt),
  }),
);

export const userPhoneLinks = pgTable(
  "user_phone_links",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    normalizedPhone: varchar("normalized_phone", { length: 20 }).notNull(),
    verifiedAt: timestamp("verified_at"),
    linkedAt: timestamp("linked_at").notNull().defaultNow(),
    lastInboundAt: timestamp("last_inbound_at"),
    lastOutboundAt: timestamp("last_outbound_at"),
    smsEnabled: boolean("sms_enabled").notNull().default(true),
    smsOptInStatus: text("sms_opt_in_status").notNull().default("pending"),
    smsOptInSource: text("sms_opt_in_source"),
    smsOptedOutAt: timestamp("sms_opted_out_at"),
    smsLastStopAt: timestamp("sms_last_stop_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex("user_phone_links_user_idx").on(table.userId),
    phoneIdx: uniqueIndex("user_phone_links_phone_idx").on(table.normalizedPhone),
    statusIdx: index("user_phone_links_status_idx").on(table.smsOptInStatus, table.smsEnabled),
  }),
);

export const userPhoneLinkTokens = pgTable(
  "user_phone_link_tokens",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull().default("signup_or_link"),
    expiresAt: timestamp("expires_at").notNull(),
    claimedByUserId: varchar("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    hashIdx: uniqueIndex("user_phone_link_tokens_hash_idx").on(table.tokenHash),
    phoneIdx: index("user_phone_link_tokens_phone_idx").on(table.phoneE164),
    expiryIdx: index("user_phone_link_tokens_expiry_idx").on(table.expiresAt),
  }),
);

// Players table - players from all sports (NBA, NFL, etc.)
// Player IDs are prefixed with sport: nba_12345, nfl_67890
export const players = pgTable(
  "players",
  {
    id: varchar("id").primaryKey(), // Prefixed player ID (e.g., nba_12345, nfl_67890)
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    team: text("team").notNull(),
    position: text("position").notNull(),
    jerseyNumber: text("jersey_number"),
    isActive: boolean("is_active").notNull().default(true), // On active roster
    isEligibleForVesting: boolean("is_eligible_for_vesting").notNull().default(true),
    currentPrice: decimal("current_price", { precision: 10, scale: 2 }).notNull().default("10.00"), // Placeholder - use lastTradePrice for real market value
    lastTradePrice: decimal("last_trade_price", { precision: 10, scale: 2 }), // Actual market price from last trade, null if no trades
    volume24h: integer("volume_24h").notNull().default(0),
    priceChange24h: decimal("price_change_24h", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    marketCap: decimal("market_cap", { precision: 20, scale: 2 }).notNull().default("0.00"), // Total shares * price, updated on each trade
    totalShares: integer("total_shares").notNull().default(0), // Total shares held by all users, updated on each trade
    lastUpdated: timestamp("last_updated").notNull().defaultNow(),
    // Injury tracking fields
    injuryStatus: text("injury_status"), // "Out", "Doubtful", "Questionable", "Probable", "Day-To-Day", null = healthy
    injuryDescription: text("injury_description"), // Full injury details
    injuryReturnDate: text("injury_return_date"), // Expected return date string
    injuryUpdatedAt: timestamp("injury_updated_at"), // When injury info was last synced
  },
  (table) => ({
    sportIdx: index("player_sport_idx").on(table.sport),
    injuryStatusIdx: index("injury_status_idx").on(table.injuryStatus),
    sportTeamIdx: index("player_sport_team_idx").on(table.sport, table.team),
    sportPositionIdx: index("player_sport_position_idx").on(table.sport, table.position),
    teamIdx: index("team_idx").on(table.team),
    activeIdx: index("active_idx").on(table.isActive),
    positionIdx: index("position_idx").on(table.position),
    nameIdx: index("name_idx").on(table.firstName, table.lastName),
    lastTradePriceIdx: index("last_trade_price_idx").on(table.lastTradePrice),
    volume24hIdx: index("volume_24h_idx").on(table.volume24h),
    priceChange24hIdx: index("price_change_24h_idx").on(table.priceChange24h),
    marketCapIdx: index("market_cap_idx").on(table.marketCap),
  }),
);

// Player market metrics table - precomputed sortable metrics for high-scale player lists
export const playerMarketMetrics = pgTable(
  "player_market_metrics",
  {
    playerId: varchar("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    avgFantasyPoints: decimal("avg_fantasy_points", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    buyPressure: decimal("buy_pressure", { precision: 5, scale: 2 }).notNull().default("50.00"),
    totalOrderVolume24h: integer("total_order_volume_24h").notNull().default(0),
    valueIndex: decimal("value_index", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bestBid: decimal("best_bid", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bestAsk: decimal("best_ask", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bidSize: integer("bid_size").notNull().default(0),
    askSize: integer("ask_size").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    avgFantasyPointsIdx: index("pmm_avg_fantasy_points_idx").on(table.avgFantasyPoints),
    buyPressureIdx: index("pmm_buy_pressure_idx").on(table.buyPressure),
    valueIndexIdx: index("pmm_value_index_idx").on(table.valueIndex),
    bestBidIdx: index("pmm_best_bid_idx").on(table.bestBid),
    bestAskIdx: index("pmm_best_ask_idx").on(table.bestAsk),
    updatedAtIdx: index("pmm_updated_at_idx").on(table.updatedAt),
  }),
);

// Holdings table - user ownership of player shares and premium shares
export const holdings = pgTable(
  "holdings",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetType: text("asset_type").notNull(), // "player" or "premium"
    assetId: text("asset_id").notNull(), // player ID or "premium"
    quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull().default("0"),
    avgCostBasis: decimal("avg_cost_basis", { precision: 10, scale: 4 })
      .notNull()
      .default("0.0000"), // Average cost per share
    totalCostBasis: decimal("total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"), // Total invested
    lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  },
  (table) => ({
    userAssetIdx: uniqueIndex("holdings_user_asset_idx").on(
      table.userId,
      table.assetType,
      table.assetId,
    ),
  }),
);

// Player multipliers table - one non-tradeable stacked-share record per user/player
export const playerMultipliers = pgTable(
  "player_multipliers",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    multiplier: integer("multiplier").notNull(),
    avgCostBasis: decimal("avg_cost_basis", { precision: 10, scale: 4 })
      .notNull()
      .default("0.0000"),
    totalCostBasis: decimal("total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerIdx: uniqueIndex("player_multiplier_user_player_idx").on(
      table.userId,
      table.playerId,
    ),
    playerIdx: index("player_multiplier_player_idx").on(table.playerId),
  }),
);

// Immutable ledger for stacked-share lifecycle changes
export const playerMultiplierEvents = pgTable(
  "player_multiplier_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // stack_shares, boost_burn, migration_backfill
    sharesConsumed: integer("shares_consumed").notNull().default(0),
    effectiveSharesBurned: integer("effective_shares_burned").notNull().default(0),
    multiplierDelta: integer("multiplier_delta").notNull().default(0),
    multiplierAfter: integer("multiplier_after").notNull().default(0),
    consumedTotalCostBasis: decimal("consumed_total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    retainedTotalCostBasis: decimal("retained_total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    boostId: varchar("boost_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerCreatedIdx: index("player_multiplier_event_user_player_created_idx").on(
      table.userId,
      table.playerId,
      table.createdAt,
    ),
    eventTypeIdx: index("player_multiplier_event_type_idx").on(table.eventType),
  }),
);

// Holdings locks table - tracks reserved/locked shares to prevent double-spending
// Available shares = holdings.quantity - SUM(holdings_locks.lockedQuantity)
export const holdingsLocks = pgTable(
  "holdings_locks",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetType: text("asset_type").notNull(), // "player" or "premium"
    assetId: text("asset_id").notNull(), // player ID or "premium"
    lockType: text("lock_type").notNull(), // "order" or "vesting"
    lockReferenceId: varchar("lock_reference_id").notNull(), // order ID or vesting record ID
    lockedQuantity: integer("locked_quantity").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userAssetIdx: index("locks_user_asset_idx").on(table.userId, table.assetType, table.assetId),
    referenceIdx: index("locks_reference_idx").on(table.lockReferenceId),
    lockTypeIdx: index("locks_type_idx").on(table.lockType),
  }),
);

// Balance locks table - tracks reserved cash to prevent double-spending
// Available balance = users.balance - SUM(balance_locks.lockedAmount)
export const balanceLocks = pgTable(
  "balance_locks",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lockType: text("lock_type").notNull(), // "order" (for buy orders)
    lockReferenceId: varchar("lock_reference_id").notNull(), // order ID
    lockedAmount: decimal("locked_amount", { precision: 20, scale: 2 }).notNull().default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("balance_locks_user_idx").on(table.userId),
    referenceIdx: index("balance_locks_reference_idx").on(table.lockReferenceId),
    lockTypeIdx: index("balance_locks_type_idx").on(table.lockType),
  }),
);

// Orders table - limit and market orders on the order book
export const orders = pgTable(
  "orders",
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
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    playerSideIdx: index("player_side_idx").on(table.playerId, table.side, table.status),
    userIdx: index("user_idx").on(table.userId),
  }),
);

// Trades table - executed trade history
export const trades = pgTable(
  "trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => orders.id),
    sellOrderId: varchar("sell_order_id").references(() => orders.id),
    quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    playerIdx: index("player_trade_idx").on(table.playerId),
    executedIdx: index("executed_idx").on(table.executedAt),
    playerExecutedIdx: index("trades_player_executed_at_idx").on(table.playerId, table.executedAt),
  }),
);

// Player Pools table - AMM constant product pools for instant trading
// x * y = k where x=shares, y=play_money (Sportfolio Bucks)
export const playerPools = pgTable(
  "player_pools",
  {
    playerId: varchar("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    shares: decimal("shares", { precision: 12, scale: 2 }).notNull().default("1000"),
    playMoney: decimal("play_money", { precision: 12, scale: 2 }).notNull().default("10000"),
    k: decimal("k", { precision: 24, scale: 2 }).notNull().default("10000000"),
    lpSharesTotal: decimal("lp_shares_total", { precision: 24, scale: 2 })
      .notNull()
      .default("1000"),
    feesAccumulated: decimal("fees_accumulated", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    feeGrowthPerLpShare: decimal("fee_growth_per_lp_share", { precision: 24, scale: 12 })
      .notNull()
      .default("0"),
    totalVolume: decimal("total_volume", { precision: 12, scale: 2 }).notNull().default("0"),
    totalTrades: integer("total_trades").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    updatedIdx: index("player_pools_updated_idx").on(table.updatedAt),
  }),
);

// LP Positions table - Tracks user ownership of liquidity provider tokens
export const lpPositions = pgTable(
  "lp_positions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    lpShares: decimal("lp_shares", { precision: 24, scale: 2 }).notNull().default("0"),
    feeGrowthSnapshot: decimal("fee_growth_snapshot", { precision: 24, scale: 12 })
      .notNull()
      .default("0"),
    feesEarnedTotal: decimal("fees_earned_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerUniqueIdx: uniqueIndex("lp_user_player_unique_idx").on(table.userId, table.playerId),
    userIdx: index("lp_user_idx").on(table.userId),
    playerIdx: index("lp_player_idx").on(table.playerId),
    sharesIdx: index("lp_shares_idx").on(table.lpShares),
  }),
);

// LP Transactions table - Audit trail for liquidity additions/removals
export const lpTransactions = pgTable(
  "lp_transactions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    transactionType: text("transaction_type").notNull(), // 'add' or 'remove'
    lpShares: decimal("lp_shares", { precision: 24, scale: 2 }).notNull(),
    sharesAmount: decimal("shares_amount", { precision: 12, scale: 2 }).notNull(),
    playMoneyAmount: decimal("play_money_amount", { precision: 12, scale: 2 }).notNull(),
    poolSharesBefore: decimal("pool_shares_before", { precision: 12, scale: 2 }).notNull(),
    poolPlayMoneyBefore: decimal("pool_play_money_before", { precision: 12, scale: 2 }).notNull(),
    poolLpSharesTotalBefore: decimal("pool_lp_shares_total_before", {
      precision: 24,
      scale: 2,
    }).notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("lp_tx_user_idx").on(table.userId),
    playerIdx: index("lp_tx_player_idx").on(table.playerId),
    timestampIdx: index("lp_tx_timestamp_idx").on(table.timestamp),
  }),
);

// Insert schemas for AMM/LP tables
export const insertPlayerPoolSchema = createInsertSchema(playerPools).omit({
  k: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLpPositionSchema = createInsertSchema(lpPositions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLpTransactionSchema = createInsertSchema(lpTransactions).omit({
  id: true,
  timestamp: true,
});

// Vesting table - tracks user vesting state
export const vesting = pgTable("vesting", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  playerId: varchar("player_id").references(() => players.id), // null for premium users with split vesting
  sharesAccumulated: integer("shares_accumulated").notNull().default(0),
  residualMs: integer("residual_ms").notNull().default(0), // Fractional time carryover in milliseconds
  lastAccruedAt: timestamp("last_accrued_at").notNull().defaultNow(), // Baseline timestamp for accrual calculation
  lastClaimedAt: timestamp("last_claimed_at"),
  capReachedAt: timestamp("cap_reached_at"), // When they hit their cap
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vesting splits table - for premium users splitting vesting across players
export const vestingSplits = pgTable(
  "vesting_splits",
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
    sharesPerHour: integer("shares_per_hour").notNull(),
  },
  (table) => ({
    userIdx: index("user_split_idx").on(table.userId),
  }),
);

// Vesting claims table - immutable log of individual claim events
export const vestingClaims = pgTable(
  "vesting_claims",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id").references(() => players.id), // null for premium split vesting
    sharesClaimed: integer("shares_claimed").notNull(),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("vesting_claims_user_idx").on(table.userId),
    claimedAtIdx: index("vesting_claims_claimed_at_idx").on(table.claimedAt),
  }),
);

// Vesting presets table - saved player groups for quick redemption
export const vestingPresets = pgTable(
  "vesting_presets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    playerIds: text("player_ids").array().notNull(), // Array of player IDs (max 20)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("vesting_presets_user_idx").on(table.userId),
  }),
);

// Scout Engine: Scout assignments - tracks which players each user is scouting
// Users can stack multiple scouts (up to 5 standard, 10 premium) on players
export const scoutAssignments = pgTable(
  "scout_assignments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    scoutCount: integer("scout_count").notNull().default(1), // Number of scouts stacked on this player
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerUniqueIdx: uniqueIndex("scout_user_player_unique_idx").on(
      table.userId,
      table.playerId,
    ),
    playerIdx: index("scout_player_idx").on(table.playerId),
    userIdx: index("scout_user_idx").on(table.userId),
  }),
);

// Scout Engine: Scout distributions - immutable ledger of hourly share distributions
// Formula: (60 Shares) * (User's Scout-Minutes / Total Global Scout-Minutes)
export const scoutDistributions = pgTable(
  "scout_distributions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    hourTimestamp: timestamp("hour_timestamp").notNull(), // Hour bucket (truncated to hour)
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userScoutMinutes: integer("user_scout_minutes").notNull(), // User's scout-minutes for this hour
    globalScoutMinutes: integer("global_scout_minutes").notNull(), // Total scout-minutes for this player
    sharesEarned: decimal("shares_earned", { precision: 10, scale: 2 }).notNull(), // Rounded to .01
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    hourPlayerIdx: index("scout_dist_hour_player_idx").on(table.hourTimestamp, table.playerId),
    userHourIdx: index("scout_dist_user_hour_idx").on(table.userId, table.hourTimestamp),
  }),
);

// Scout Engine: Scout History - Tracks duration of assignments for minute-level precision
// Used to calculate "Scout-Minutes" when users change scouts mid-hour.
export const scoutHistory = pgTable(
  "scout_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    scoutCount: integer("scout_count").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"), // Null if currently active
  },
  (table) => ({
    userTimeIdx: index("scout_history_user_time_idx").on(
      table.userId,
      table.startedAt,
      table.endedAt,
    ),
    playerTimeIdx: index("scout_history_player_time_idx").on(
      table.playerId,
      table.startedAt,
      table.endedAt,
    ),
  }),
);

// Player game stats table - for all sports
// NBA: uses dedicated columns for backwards compatibility
// NFL: uses statsJson for flexible stat storage
export const playerGameStats = pgTable(
  "player_game_stats",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id").notNull(), // API game ID
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    gameDate: timestamp("game_date").notNull(),
    week: integer("week"), // NFL week number (null for NBA)
    season: text("season").notNull().default("2024-2025-regular"), // Track season for historical data
    opponentTeam: text("opponent_team"), // Opponent abbreviation
    homeAway: text("home_away"), // "home" or "away"
    // Sport-specific stats stored as JSON (used for NFL and future sports)
    statsJson: jsonb("stats_json").notNull().default("{}"),
    // NBA-specific columns (kept for backward compatibility)
    minutes: integer("minutes").notNull().default(0), // Minutes played
    points: integer("points").notNull().default(0),
    fieldGoalsMade: integer("field_goals_made").notNull().default(0),
    fieldGoalsAttempted: integer("field_goals_attempted").notNull().default(0),
    threePointersMade: integer("three_pointers_made").notNull().default(0),
    threePointersAttempted: integer("three_pointers_attempted").notNull().default(0),
    freeThrowsMade: integer("free_throws_made").notNull().default(0),
    freeThrowsAttempted: integer("free_throws_attempted").notNull().default(0),
    rebounds: integer("rebounds").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    steals: integer("steals").notNull().default(0),
    blocks: integer("blocks").notNull().default(0),
    turnovers: integer("turnovers").notNull().default(0),
    isDoubleDouble: boolean("is_double_double").notNull().default(false),
    isTripleDouble: boolean("is_triple_double").notNull().default(false),
    // Common field
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }).notNull().default("0.00"),
    lastFetchedAt: timestamp("last_fetched_at").notNull().defaultNow(), // Track ingestion time
  },
  (table) => ({
    sportIdx: index("game_stats_sport_idx").on(table.sport),
    sportWeekIdx: index("game_stats_sport_week_idx").on(table.sport, table.week),
    sportPlayerIdx: index("game_stats_sport_player_idx").on(table.sport, table.playerId),
    playerGameIdx: index("player_game_idx").on(table.playerId, table.gameId),
  }),
);

// Price history table - for charts
export const priceHistory = pgTable(
  "price_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    volume: integer("volume").notNull().default(0),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => ({
    playerTimeIdx: index("player_time_idx").on(table.playerId, table.timestamp),
  }),
);

// Daily games table - cached game schedules for all sports
export const dailyGames = pgTable(
  "daily_games",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    gameId: text("game_id").notNull().unique(), // API game ID (prefixed for clarity)
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    date: timestamp("date", { withTimezone: true }).notNull(), // Game date
    week: integer("week"), // NFL week number (1-18 for regular season, null for NBA)
    homeTeam: text("home_team").notNull(), // Team abbreviation
    awayTeam: text("away_team").notNull(), // Team abbreviation
    venue: text("venue"),
    status: text("status").notNull().default("scheduled"), // "scheduled", "inprogress", "completed", "postponed"
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    homeScore: integer("home_score"), // null for scheduled games
    awayScore: integer("away_score"), // null for scheduled games
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sportIdx: index("daily_games_sport_idx").on(table.sport),
    sportDateIdx: index("daily_games_sport_date_idx").on(table.sport, table.date),
    sportWeekIdx: index("daily_games_sport_week_idx").on(table.sport, table.week),
    dateIdx: index("daily_games_date_idx").on(table.date),
    statusIdx: index("daily_games_status_idx").on(table.status),
    gameIdDateIdx: index("daily_games_game_date_idx").on(table.gameId, table.date),
  }),
);

// Job execution logs - track sync job runs for monitoring
export const jobExecutionLogs = pgTable(
  "job_execution_logs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(), // e.g., "roster_sync", "schedule_sync", "stats_sync"
    scheduledFor: timestamp("scheduled_for").notNull(), // When job was supposed to run
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    status: text("status").notNull().default("running"), // "running", "success", "failed", "degraded"
    errorMessage: text("error_message"),
    requestCount: integer("request_count").notNull().default(0), // API requests made during job
    recordsProcessed: integer("records_processed").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0), // Number of failed records
  },
  (table) => ({
    jobNameIdx: index("job_name_idx").on(table.jobName),
    scheduledIdx: index("scheduled_idx").on(table.scheduledFor),
  }),
);

// Blog posts table - admin-created content for SEO and user engagement
export const blogPosts = pgTable(
  "blog_posts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(), // URL-friendly version of title
    excerpt: text("excerpt").notNull(), // Brief summary for listing pages
    content: text("content").notNull(), // Full blog post content (can be markdown or HTML)
    authorId: varchar("author_id")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at"), // null = draft, non-null = published
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index("blog_slug_idx").on(table.slug),
    publishedIdx: index("blog_published_idx").on(table.publishedAt),
    authorIdx: index("blog_author_idx").on(table.authorId),
  }),
);

// Portfolio snapshots table - daily snapshots of user portfolio metrics for historical tracking and rank changes
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotDate: timestamp("snapshot_date").notNull(), // Date this snapshot was taken (UTC midnight)
    cashBalance: decimal("cash_balance", { precision: 20, scale: 2 }).notNull(),
    portfolioValue: decimal("portfolio_value", { precision: 20, scale: 2 }).notNull(),
    totalNetWorth: decimal("total_net_worth", { precision: 20, scale: 2 }).notNull(), // cashBalance + portfolioValue
    cashRank: integer("cash_rank"), // User's rank on cash balance leaderboard
    portfolioRank: integer("portfolio_rank"), // User's rank on portfolio value leaderboard
    netWorthRank: integer("net_worth_rank"), // User's rank on total net worth leaderboard
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userDateIdx: index("portfolio_snapshots_user_date_idx").on(table.userId, table.snapshotDate),
    dateIdx: index("portfolio_snapshots_date_idx").on(table.snapshotDate),
  }),
);

// Market snapshots table - daily snapshots of platform-wide market metrics for analytics charts
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    snapshotDate: timestamp("snapshot_date").notNull().unique(), // One row per day (UTC midnight)
    marketCap: decimal("market_cap", { precision: 20, scale: 2 }).notNull(), // Total value of all shares (shares * price)
    transactionsCount: integer("transactions_count").notNull().default(0), // Number of trades that day
    volume: decimal("volume", { precision: 20, scale: 2 }).notNull().default("0"), // Total trading volume that day
    sharesVested: integer("shares_vested").notNull().default(0), // Shares vested that day
    sharesBurned: integer("shares_burned").notNull().default(0), // Shares burned by boost participation that day
    totalShares: integer("total_shares").notNull().default(0), // Total shares in economy (snapshot)
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    dateIdx: index("market_snapshots_date_idx").on(table.snapshotDate),
  }),
);

// Bot profiles table - configuration for market maker bots
export const botProfiles = pgTable(
  "bot_profiles",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    botName: text("bot_name").notNull(), // Human-readable name like "MarketMaker_Alpha"
    botRole: text("bot_role").notNull(), // "market_maker", "trader", "vester", "casual"
    isActive: boolean("is_active").notNull().default(true), // Enable/disable this bot
    // Trading configuration
    aggressiveness: decimal("aggressiveness", { precision: 3, scale: 2 }).notNull().default("0.50"), // 0.0-1.0 scale
    spreadPercent: decimal("spread_percent", { precision: 5, scale: 2 }).notNull().default("2.00"), // Bid/ask spread percentage
    maxOrderSize: integer("max_order_size").notNull().default(100), // Maximum shares per order
    minOrderSize: integer("min_order_size").notNull().default(5), // Minimum shares per order
    maxDailyOrders: integer("max_daily_orders").notNull().default(50), // Daily order cap
    maxDailyVolume: integer("max_daily_volume").notNull().default(1000), // Max shares traded per day
    targetTiers: integer("target_tiers").array(), // Player tiers to target (1-5), null = all tiers
    // Vesting configuration
    vestingClaimThreshold: decimal("vesting_claim_threshold", { precision: 3, scale: 2 })
      .notNull()
      .default("0.85"), // Claim at 85% of cap
    maxPlayersToVest: integer("max_players_to_vest").notNull().default(5), // Max players to split vesting across
    // Timing configuration
    minActionCooldownMs: integer("min_action_cooldown_ms").notNull().default(60000), // 1 minute minimum between actions
    maxActionCooldownMs: integer("max_action_cooldown_ms").notNull().default(300000), // 5 minute max cooldown
    activeHoursStart: integer("active_hours_start").notNull().default(8), // Start hour (0-23 UTC)
    activeHoursEnd: integer("active_hours_end").notNull().default(23), // End hour (0-23 UTC)
    // State tracking
    lastActionAt: timestamp("last_action_at"),
    ordersToday: integer("orders_today").notNull().default(0),
    volumeToday: integer("volume_today").notNull().default(0),
    lastResetDate: timestamp("last_reset_date").notNull().defaultNow(), // Reset daily counters
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    roleIdx: index("bot_role_idx").on(table.botRole),
    activeIdx: index("bot_active_idx").on(table.isActive),
  }),
);

// Bot actions log table - audit trail of all bot actions
export const botActionsLog = pgTable(
  "bot_actions_log",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    botUserId: varchar("bot_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(), // "order_placed", "order_cancelled", "vesting_claim", "vesting_selection"
    actionDetails: jsonb("action_details").notNull(), // JSON with specific details (order ID, player ID, amounts, etc.)
    triggerReason: text("trigger_reason").notNull(), // Why this action was taken
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    botUserIdx: index("bot_actions_user_idx").on(table.botUserId),
    actionTypeIdx: index("bot_actions_type_idx").on(table.actionType),
    createdAtIdx: index("bot_actions_created_idx").on(table.createdAt),
  }),
);

// Premium checkout sessions table - tracks Whop checkout sessions for premium share purchases
export const premiumCheckoutSessions = pgTable(
  "premium_checkout_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    whopSessionId: varchar("whop_session_id").unique(), // Whop's session ID (if using session API)
    planId: text("plan_id").notNull(), // Whop plan ID
    quantity: integer("quantity").notNull().default(1), // Number of premium shares to credit
    amountCents: integer("amount_cents").notNull(), // Amount in cents (500 = $5)
    status: text("status").notNull().default("pending"), // "pending", "completed", "failed"
    receiptId: varchar("receipt_id").unique(), // Whop receipt/payment ID for idempotency
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("premium_checkout_user_idx").on(table.userId),
    statusIdx: index("premium_checkout_status_idx").on(table.status),
    receiptIdx: index("premium_checkout_receipt_idx").on(table.receiptId),
  }),
);

// Premium orders table - limit and market orders for premium share trading
export const premiumOrders = pgTable(
  "premium_orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sideStatusIdx: index("premium_orders_side_status_idx").on(table.side, table.status),
    userIdx: index("premium_orders_user_idx").on(table.userId),
    createdAtIdx: index("premium_orders_created_idx").on(table.createdAt),
  }),
);

// Premium trades table - executed premium share trade history
export const premiumTrades = pgTable(
  "premium_trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => premiumOrders.id),
    sellOrderId: varchar("sell_order_id").references(() => premiumOrders.id),
    quantity: integer("quantity").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    executedIdx: index("premium_trades_executed_idx").on(table.executedAt),
    buyerIdx: index("premium_trades_buyer_idx").on(table.buyerId),
    sellerIdx: index("premium_trades_seller_idx").on(table.sellerId),
  }),
);

// Community checkout sessions table - tracks Whop checkout sessions for community share purchases
// Community shares are used to create community boosts (+1x multiplier for all holders of a player)
export const communityCheckoutSessions = pgTable(
  "community_checkout_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    whopSessionId: varchar("whop_session_id").unique(), // Whop's session ID (if using session API)
    planId: text("plan_id").notNull(), // Whop plan ID (should be WHOP_COMMUNITY_PLAN_ID)
    quantity: integer("quantity").notNull().default(1), // Number of community shares to credit ($1 each)
    amountCents: integer("amount_cents").notNull(), // Amount in cents (100 = $1 per share)
    status: text("status").notNull().default("pending"), // "pending", "completed", "failed"
    receiptId: varchar("receipt_id").unique(), // Whop receipt/payment ID for idempotency
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("community_checkout_user_idx").on(table.userId),
    statusIdx: index("community_checkout_status_idx").on(table.status),
    receiptIdx: index("community_checkout_receipt_idx").on(table.receiptId),
  }),
);

// Community orders table - limit and market orders for community share trading
export const communityOrders = pgTable(
  "community_orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sideStatusIdx: index("community_orders_side_status_idx").on(table.side, table.status),
    userIdx: index("community_orders_user_idx").on(table.userId),
    createdAtIdx: index("community_orders_created_idx").on(table.createdAt),
  }),
);

// Community trades table - executed community share trade history
export const communityTrades = pgTable(
  "community_trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => communityOrders.id),
    sellOrderId: varchar("sell_order_id").references(() => communityOrders.id),
    quantity: integer("quantity").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    executedIdx: index("community_trades_executed_idx").on(table.executedAt),
    buyerIdx: index("community_trades_buyer_idx").on(table.buyerId),
    sellerIdx: index("community_trades_seller_idx").on(table.sellerId),
  }),
);

// Whop payments table - tracks Whop purchases for cross-platform crediting
// Used to sync premium shares between Whop and Sportfolio
export const whopPayments = pgTable(
  "whop_payments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    paymentId: varchar("payment_id").notNull().unique(), // Whop's unique payment ID (primary key for idempotency)
    email: varchar("email").notNull(), // Email from Whop payment (used to match Sportfolio users)
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Sportfolio user who received credit (null if not yet matched)
    quantity: integer("quantity").notNull().default(1), // Number of premium shares purchased
    amountCents: integer("amount_cents").notNull(), // Amount paid in cents
    currency: varchar("currency").notNull().default("usd"),
    whopStatus: text("whop_status").notNull(), // "paid", "refunded", "disputed", etc.
    creditedAt: timestamp("credited_at"), // When shares were credited (null if not yet credited)
    revokedAt: timestamp("revoked_at"), // When shares were revoked due to refund/chargeback
    revokedQuantity: integer("revoked_quantity"), // How many shares were revoked
    liabilityQuantity: integer("liability_quantity").default(0), // Shares owed if user traded them away before revocation
    lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(), // Last time this payment was synced from Whop
    rawPayload: jsonb("raw_payload"), // Full Whop payment object for debugging
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    paymentIdIdx: index("whop_payments_payment_id_idx").on(table.paymentId),
    emailIdx: index("whop_payments_email_idx").on(table.email),
    userIdIdx: index("whop_payments_user_id_idx").on(table.userId),
    statusIdx: index("whop_payments_status_idx").on(table.whopStatus),
    creditedIdx: index("whop_payments_credited_idx").on(table.creditedAt),
  }),
);

// Tweet settings table - stores configuration for automated tweets
export const tweetSettings = pgTable("tweet_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  enabled: boolean("enabled").notNull().default(false),
  promptTemplate: text("prompt_template")
    .notNull()
    .default(
      "Give a brief 1-sentence summary of recent NBA news or game performance for these players: {players}. Focus on their most recent game or any breaking news. Keep each summary under 60 characters.",
    ),
  includeRisers: boolean("include_risers").notNull().default(true),
  includeVolume: boolean("include_volume").notNull().default(true),
  includeMarketCap: boolean("include_market_cap").notNull().default(true),
  maxPlayers: integer("max_players").notNull().default(3),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Agent system settings - singleton config for the platform-managed AI provider
export const agentSystemSettings = pgTable("agent_system_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  managedProvider: text("managed_provider").notNull().default("chutes"),
  managedModel: text("managed_model"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Tweet history table - logs of all tweets sent
export const tweetHistory = pgTable(
  "tweet_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    content: text("content").notNull(),
    tweetId: varchar("tweet_id"), // X's tweet ID if successfully posted
    status: text("status").notNull().default("pending"), // "pending", "success", "failed"
    errorMessage: text("error_message"),
    playerData: jsonb("player_data"), // Snapshot of player stats used
    aiSummary: text("ai_summary"), // Perplexity response
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("tweet_history_status_idx").on(table.status),
    createdAtIdx: index("tweet_history_created_idx").on(table.createdAt),
  }),
);

export const redditPostHistory = pgTable(
  "reddit_post_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    subreddit: text("subreddit").notNull(),
    postType: text("post_type").notNull(), // "morning_recap" | "pregame_preview"
    marketDay: varchar("market_day", { length: 10 }).notNull(), // YYYY-MM-DD in ET
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "posted" | "failed" | "skipped"
    redditPostId: varchar("reddit_post_id"),
    redditPostUrl: text("reddit_post_url"),
    imageUrl: text("image_url"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    postedAt: timestamp("posted_at"),
    lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    subredditSlotIdx: uniqueIndex("reddit_post_history_subreddit_slot_idx").on(
      table.subreddit,
      table.postType,
      table.marketDay,
    ),
    statusIdx: index("reddit_post_history_status_idx").on(table.status),
    createdAtIdx: index("reddit_post_history_created_at_idx").on(table.createdAt),
    lastAttemptIdx: index("reddit_post_history_last_attempt_idx").on(table.lastAttemptAt),
  }),
);

// User agent profiles - one scout copilot configuration per user
export const userAgentProfiles = pgTable(
  "user_agent_profiles",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    displayName: text("display_name").notNull().default("My Scout Agent"),
    providerMode: text("provider_mode").notNull().default("managed"), // "managed" | "byok"
    providerType: text("provider_type").notNull().default("openai_compatible"),
    runtime: text("runtime").notNull().default("hermes"), // "pi" | "hermes"
    model: text("model").notNull().default("managed-default"),
    baseUrl: text("base_url"),
    systemPrompt: text("system_prompt")
      .notNull()
      .default(
        "Operate like a sharp Sportfolio scout strategist. Stay grounded in the provided Sportfolio context, focus on scouting only, surface the strongest opportunity and risk tradeoffs clearly, and never invent players, schedules, or actions outside scout_set_count.",
      ),
    userPromptTemplate: text("user_prompt_template")
      .notNull()
      .default(
        "Act like my scout GM. Give me clear, curated reads on my current scout setup, call out concentration risk and missed opportunities, and when I ask for a move, translate that into the highest-leverage scout reallocation you can support with the current Sportfolio context.",
      ),
    temperature: decimal("temperature", { precision: 3, scale: 2 }).notNull().default("0.20"),
    maxTokens: integer("max_tokens").notNull().default(1200),
    analysisWindowMinutes: integer("analysis_window_minutes").notNull().default(1440),
    defaultSport: text("default_sport"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex("user_agent_profiles_user_idx").on(table.userId),
    providerModeIdx: index("user_agent_profiles_provider_mode_idx").on(table.providerMode),
    runtimeIdx: index("user_agent_profiles_runtime_idx").on(table.runtime),
    updatedAtIdx: index("user_agent_profiles_updated_at_idx").on(table.updatedAt),
  }),
);

// User agent secrets - encrypted BYOK storage
export const userAgentSecrets = pgTable(
  "user_agent_secrets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyAuthTag: text("api_key_auth_tag").notNull(),
    keyLast4: text("key_last4").notNull(),
    encryptionVersion: text("encryption_version").notNull().default("aes-256-gcm:v1"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at"),
  },
  (table) => ({
    userIdx: uniqueIndex("user_agent_secrets_user_idx").on(table.userId),
    updatedAtIdx: index("user_agent_secrets_updated_at_idx").on(table.updatedAt),
  }),
);

// User agent threads - conversation containers across in-app and future external channels
export const userAgentThreads = pgTable(
  "user_agent_threads",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("in_app"), // "in_app" | "sms"
    domain: text("domain").notNull().default("scouting"),
    status: text("status").notNull().default("active"), // "active" | "archived"
    title: text("title"),
    externalThreadKey: text("external_thread_key"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userUpdatedIdx: index("user_agent_threads_user_updated_idx").on(table.userId, table.updatedAt),
    userStatusIdx: index("user_agent_threads_user_status_idx").on(table.userId, table.status),
    channelIdx: index("user_agent_threads_channel_idx").on(table.channel),
  }),
);

// User agent runs - audit log of analysis invocations
export const userAgentRuns = pgTable(
  "user_agent_runs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id").references(() => userAgentThreads.id, { onDelete: "set null" }),
    triggerSource: text("trigger_source").notNull().default("manual"), // "manual" | "scheduled_preview" | "retry"
    status: text("status").notNull().default("pending"), // "pending" | "completed" | "failed" | "rejected"
    providerMode: text("provider_mode").notNull().default("managed"),
    model: text("model").notNull(),
    contextSnapshot: jsonb("context_snapshot").notNull(),
    promptSnapshot: jsonb("prompt_snapshot").notNull(),
    rawResponse: jsonb("raw_response"),
    parsedSummary: text("parsed_summary"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    userCreatedIdx: index("user_agent_runs_user_created_idx").on(table.userId, table.createdAt),
    statusIdx: index("user_agent_runs_status_idx").on(table.status),
    threadCreatedIdx: index("user_agent_runs_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
  }),
);

export const userAgentImprovementCandidates = pgTable(
  "user_agent_improvement_candidates",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    signature: text("signature").notNull(),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    sourceRunId: varchar("source_run_id").references(() => userAgentRuns.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("new"),
    failureClass: text("failure_class").notNull(),
    recommendedChangeType: text("recommended_change_type").notNull(),
    recommendedChange: text("recommended_change").notNull(),
    affectedTools: jsonb("affected_tools")
      .notNull()
      .default(sql`'[]'::jsonb`),
    evidence: jsonb("evidence")
      .notNull()
      .default(sql`'{}'::jsonb`),
    confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.500"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    signatureIdx: uniqueIndex("user_agent_improvement_candidates_signature_idx").on(
      table.signature,
    ),
    statusSeenIdx: index("user_agent_improvement_candidates_status_seen_idx").on(
      table.status,
      table.lastSeenAt,
    ),
    failureSeenIdx: index("user_agent_improvement_candidates_failure_seen_idx").on(
      table.failureClass,
      table.lastSeenAt,
    ),
  }),
);

// User agent proposals - structured scout actions generated by runs
export const userAgentProposals = pgTable(
  "user_agent_proposals",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runId: varchar("run_id")
      .notNull()
      .references(() => userAgentRuns.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull().default("scout_set_count"),
    status: text("status").notNull().default("proposed"), // "proposed" | "approved" | "applied" | "rejected" | "failed" | "expired"
    playerId: varchar("player_id").references(() => players.id),
    targetCount: integer("target_count"),
    currentCount: integer("current_count"),
    reasoning: text("reasoning").notNull(),
    confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.500"),
    evidence: jsonb("evidence").notNull(),
    riskFlags: jsonb("risk_flags").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    approvedAt: timestamp("approved_at"),
    appliedAt: timestamp("applied_at"),
    errorMessage: text("error_message"),
  },
  (table) => ({
    runIdx: index("user_agent_proposals_run_idx").on(table.runId),
    userStatusCreatedIdx: index("user_agent_proposals_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
  }),
);

// User agent action bundles - UI-facing pending/apply state for structured actions
export const userAgentActionBundles = pgTable(
  "user_agent_action_bundles",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    threadId: varchar("thread_id")
      .notNull()
      .references(() => userAgentThreads.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").notNull().default("scouting"),
    runId: varchar("run_id").references(() => userAgentRuns.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending_confirmation"),
    summary: text("summary").notNull(),
    warnings: jsonb("warnings").notNull(),
    actionPayload: jsonb("action_payload").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
    appliedAt: timestamp("applied_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    threadStatusIdx: index("user_agent_action_bundles_thread_status_idx").on(
      table.threadId,
      table.status,
      table.createdAt,
    ),
    userCreatedIdx: index("user_agent_action_bundles_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

// User agent messages - persisted chat transcript across channels
export const userAgentMessages = pgTable(
  "user_agent_messages",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    threadId: varchar("thread_id")
      .notNull()
      .references(() => userAgentThreads.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant" | "system"
    messageType: text("message_type").notNull().default("chat"),
    contentText: text("content_text").notNull(),
    structuredPayload: jsonb("structured_payload"),
    runId: varchar("run_id").references(() => userAgentRuns.id, { onDelete: "set null" }),
    actionBundleId: varchar("action_bundle_id").references(() => userAgentActionBundles.id, {
      onDelete: "set null",
    }),
    externalMessageKey: text("external_message_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    threadCreatedIdx: index("user_agent_messages_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    userCreatedIdx: index("user_agent_messages_user_created_idx").on(table.userId, table.createdAt),
    bundleIdx: index("user_agent_messages_action_bundle_idx").on(table.actionBundleId),
  }),
);

export const smsMessageEvents = pgTable(
  "sms_message_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    direction: text("direction").notNull(), // "inbound" | "outbound"
    provider: text("provider").notNull().default("telnyx"),
    providerEventId: text("provider_event_id"),
    providerMessageId: text("provider_message_id"),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    agentThreadId: varchar("agent_thread_id").references(() => userAgentThreads.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull().default("message"),
    messageText: text("message_text"),
    structuredPayload: jsonb("structured_payload"),
    status: text("status").notNull().default("received"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventIdx: uniqueIndex("sms_message_events_provider_event_idx").on(table.providerEventId),
    phoneCreatedIdx: index("sms_message_events_phone_created_idx").on(
      table.phoneE164,
      table.createdAt,
    ),
    userCreatedIdx: index("sms_message_events_user_created_idx").on(table.userId, table.createdAt),
  }),
);

export const userAgentMemories = pgTable(
  "user_agent_memories",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id").references(() => userAgentThreads.id, { onDelete: "set null" }),
    scope: text("scope").notNull(), // "profile" | "episodic" | "semantic"
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    content: jsonb("content").notNull(),
    confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.500"),
    source: text("source").notNull(),
    embedding: jsonb("embedding"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => ({
    userScopeUpdatedIdx: index("user_agent_memories_user_scope_updated_idx").on(
      table.userId,
      table.scope,
      table.updatedAt,
    ),
    userKindUpdatedIdx: index("user_agent_memories_user_kind_updated_idx").on(
      table.userId,
      table.kind,
      table.updatedAt,
    ),
    threadIdx: index("user_agent_memories_thread_idx").on(table.threadId),
    activeIdx: index("user_agent_memories_active_idx").on(table.userId, table.archivedAt),
  }),
);

export const agentRuntimeSessions = pgTable(
  "agent_runtime_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    threadId: varchar("thread_id").references(() => userAgentThreads.id, { onDelete: "set null" }),
    runtime: text("runtime").notNull(),
    status: text("status").notNull(),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    toolTrace: jsonb("tool_trace"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("agent_runtime_sessions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    threadCreatedIdx: index("agent_runtime_sessions_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    runtimeCreatedIdx: index("agent_runtime_sessions_runtime_created_idx").on(
      table.runtime,
      table.createdAt,
    ),
  }),
);

export const userAgentSchedules = pgTable(
  "user_agent_schedules",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    scheduleCron: text("schedule_cron").notNull(),
    channelTargets: jsonb("channel_targets")
      .notNull()
      .default(sql`'["in_app"]'::jsonb`),
    policy: jsonb("policy")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userJobIdx: uniqueIndex("user_agent_schedules_user_job_idx").on(table.userId, table.jobType),
    dueRunIdx: index("user_agent_schedules_due_run_idx").on(table.enabled, table.nextRunAt),
    userUpdatedIdx: index("user_agent_schedules_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scope: text("scope").notNull(),
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    triggerExamples: jsonb("trigger_examples")
      .notNull()
      .default(sql`'[]'::jsonb`),
    toolSequence: jsonb("tool_sequence")
      .notNull()
      .default(sql`'[]'::jsonb`),
    clarificationStrategy: jsonb("clarification_strategy")
      .notNull()
      .default(sql`'{}'::jsonb`),
    constraints: jsonb("constraints")
      .notNull()
      .default(sql`'{}'::jsonb`),
    confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0.500"),
    status: text("status").notNull(),
    sourceThreadId: varchar("source_thread_id").references(() => userAgentThreads.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => ({
    userStatusUpdatedIdx: index("agent_skills_user_status_updated_idx").on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
    scopeStatusUpdatedIdx: index("agent_skills_scope_status_updated_idx").on(
      table.scope,
      table.status,
      table.updatedAt,
    ),
    statusUpdatedIdx: index("agent_skills_status_updated_idx").on(table.status, table.updatedAt),
  }),
);

export const agentSkillReviews = pgTable(
  "agent_skill_reviews",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    skillId: varchar("skill_id")
      .notNull()
      .references(() => agentSkills.id, { onDelete: "cascade" }),
    reviewedBy: varchar("reviewed_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    skillIdx: index("agent_skill_reviews_skill_idx").on(table.skillId),
    reviewerIdx: index("agent_skill_reviews_reviewer_idx").on(table.reviewedBy, table.createdAt),
  }),
);

// User agent message embeddings - vectorized user prompts for semantic routing and analytics
export const userAgentMessageEmbeddings = pgTable(
  "user_agent_message_embeddings",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    messageId: varchar("message_id")
      .notNull()
      .references(() => userAgentMessages.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id")
      .notNull()
      .references(() => userAgentThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    messageType: text("message_type").notNull().default("chat"),
    normalizedText: text("normalized_text").notNull(),
    semanticRouteHint: text("semantic_route_hint"),
    embeddingProvider: text("embedding_provider").notNull().default("local_hash"),
    embeddingModel: text("embedding_model").notNull().default("sportfolio-hash-384"),
    embeddingVersion: text("embedding_version").notNull().default("2026-03-01"),
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    messageUniqueIdx: uniqueIndex("user_agent_message_embeddings_message_idx").on(table.messageId),
    userCreatedIdx: index("user_agent_message_embeddings_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    threadCreatedIdx: index("user_agent_message_embeddings_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    routeCreatedIdx: index("user_agent_message_embeddings_route_created_idx").on(
      table.semanticRouteHint,
      table.createdAt,
    ),
  }),
);

// Watchlists table - named lists for organizing players
export const watchlists = pgTable(
  "watchlists",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    color: varchar("color", { length: 20 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("watchlists_user_idx").on(table.userId),
  }),
);

// Watch list items table - tracks players in each watchlist
export const watchList = pgTable(
  "watch_list",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    watchlistId: varchar("watchlist_id").references(() => watchlists.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerIdx: index("watch_user_player_idx").on(table.userId, table.playerId),
    watchlistIdx: index("watch_watchlist_idx").on(table.watchlistId),
    userWatchlistPlayerIdx: index("watch_user_watchlist_player_idx").on(
      table.userId,
      table.watchlistId,
      table.playerId,
    ),
  }),
);

// News feed table - AI-generated sports news for the News Hub
export const newsFeed = pgTable(
  "news_feed",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    headline: text("headline").notNull(),
    briefing: text("briefing").notNull(),
    sourceUrl: text("source_url"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(), // SHA-256 hash for deduplication
    sport: text("sport").notNull(), // NBA, NFL
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("news_feed_created_at_idx").on(table.createdAt),
    contentHashIdx: index("news_feed_content_hash_idx").on(table.contentHash),
    sportIdx: index("news_feed_sport_idx").on(table.sport),
  }),
);

// Daily Boosts table - daily multiplier-based payouts
// Users select 4 players from their holdings each day for performance multipliers
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
    sport: text("sport").notNull(), // "NBA" or "NFL"
    slotTier: integer("slot_tier").notNull(), // 2, 3, 4, or 5 (multiplier value)
    boostDate: timestamp("boost_date").notNull(), // The date this boost applies to
    sharesEntered: integer("shares_entered").notNull(), // Shares used for calculation
    shareMultiplier: decimal("share_multiplier", { precision: 10, scale: 2 })
      .notNull()
      .default("1.00"),
    shareSourceType: text("share_source_type").notNull().default("regular"), // regular or stacked
    gameId: text("game_id"), // API game ID for the player's game
    status: text("status").notNull().default("active"), // "active", "locked", "processed", "cancelled"
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }), // Final normalized FP after game
    payout: decimal("payout", { precision: 20, scale: 2 }), // Calculated payout
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"), // When payout was credited
  },
  (table) => ({
    userDateIdx: index("boost_user_date_idx").on(table.userId, table.boostDate),
    userSportDateIdx: index("boost_user_sport_date_idx").on(
      table.userId,
      table.sport,
      table.boostDate,
    ),
    statusIdx: index("boost_status_idx").on(table.status),
    playerIdx: index("boost_player_idx").on(table.playerId),
    gameIdx: index("boost_game_idx").on(table.gameId),
  }),
);

// Boost payouts table - immutable ledger for audit trail
// Records every payout calculation for transparency
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
    sharesUsed: integer("shares_used").notNull(),
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }).notNull(),
    multiplier: integer("multiplier").notNull(), // 2, 3, 4, or 5
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("boost_payout_user_idx").on(table.userId),
    boostIdx: index("boost_payout_boost_idx").on(table.boostId),
    createdAtIdx: index("boost_payout_created_idx").on(table.createdAt),
  }),
);

// Share payouts table - immutable ledger for game-based holder earnings
// Records payouts for user/player/game snapshots settled after game completion
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
    earningUnits: decimal("earning_units", { precision: 12, scale: 2 }).notNull().default("0.00"),
    earningModel: text("earning_model").notNull().default("multiplier_only"),
    baseRate: decimal("base_rate", { precision: 10, scale: 4 }).notNull().default("1.0000"),
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }),
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 2 }),
    status: text("status").notNull().default("pending"), // pending, processed, cancelled, voided
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    userIdx: index("share_payout_user_idx").on(table.userId),
    gameIdx: index("share_payout_game_idx").on(table.gameId),
    statusIdx: index("share_payout_status_idx").on(table.status),
    createdAtIdx: index("share_payout_created_idx").on(table.createdAt),
    userPlayerGameIdx: uniqueIndex("share_payout_user_player_game_idx").on(
      table.userId,
      table.playerId,
      table.gameId,
    ),
  }),
);

// Community Boosts table - global 5x boosts created by premium share redemption
// When a user redeems a premium share, ALL users holding that player benefit from 5x
export const communityBoosts = pgTable(
  "community_boosts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sport: text("sport").notNull(), // "NBA" or "NFL"
    boostDate: timestamp("boost_date").notNull(), // The date this boost applies to
    gameId: text("game_id"), // API game ID for the player's game
    status: text("status").notNull().default("active"), // "active", "locked", "processed", "cancelled"
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }), // Final normalized FP after game
    totalPayout: decimal("total_payout", { precision: 20, scale: 2 }), // Sum of all beneficiary payouts
    beneficiaryCount: integer("beneficiary_count"), // Number of users who benefited
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"), // When payouts were credited
  },
  (table) => ({
    creatorDateIdx: index("community_boost_creator_date_idx").on(table.creatorId, table.boostDate),
    sportDateIdx: index("community_boost_sport_date_idx").on(table.sport, table.boostDate),
    statusIdx: index("community_boost_status_idx").on(table.status),
    playerIdx: index("community_boost_player_idx").on(table.playerId),
    gameIdx: index("community_boost_game_idx").on(table.gameId),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  holdings: many(holdings),
  playerMultipliers: many(playerMultipliers),
  playerMultiplierEvents: many(playerMultiplierEvents),
  orders: many(orders),
  blogPosts: many(blogPosts),
  portfolioSnapshots: many(portfolioSnapshots),
  vestingItems: many(vesting),
  vestingSplits: many(vestingSplits),
  vestingClaims: many(vestingClaims),
  watchlists: many(watchlists),
  watchList: many(watchList),
  dailyBoosts: many(dailyBoosts),
  boostPayouts: many(boostPayouts),
  sharePayouts: many(sharePayouts),
  communityBoosts: many(communityBoosts),
  agentProfiles: many(userAgentProfiles),
  agentSecrets: many(userAgentSecrets),
  agentThreads: many(userAgentThreads),
  agentRuns: many(userAgentRuns),
  agentProposals: many(userAgentProposals),
  agentActionBundles: many(userAgentActionBundles),
  agentMessages: many(userAgentMessages),
  collections: many(userCollections),
  milestones: many(userMilestones),
}));

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  user: one(users, {
    fields: [watchlists.userId],
    references: [users.id],
  }),
  items: many(watchList),
}));

export const watchListRelations = relations(watchList, ({ one }) => ({
  user: one(users, {
    fields: [watchList.userId],
    references: [users.id],
  }),
  watchlist: one(watchlists, {
    fields: [watchList.watchlistId],
    references: [watchlists.id],
  }),
  player: one(players, {
    fields: [watchList.playerId],
    references: [players.id],
  }),
}));

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, {
    fields: [blogPosts.authorId],
    references: [users.id],
  }),
}));

export const portfolioSnapshotsRelations = relations(portfolioSnapshots, ({ one }) => ({
  user: one(users, {
    fields: [portfolioSnapshots.userId],
    references: [users.id],
  }),
}));

export const playersRelations = relations(players, ({ many }) => ({
  holdings: many(holdings),
  playerMultipliers: many(playerMultipliers),
  playerMultiplierEvents: many(playerMultiplierEvents),
  orders: many(orders),
  trades: many(trades),
  gameStats: many(playerGameStats),
  priceHistory: many(priceHistory),
  sharePayouts: many(sharePayouts),
  agentProposals: many(userAgentProposals),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  user: one(users, {
    fields: [holdings.userId],
    references: [users.id],
  }),
}));

export const playerMultipliersRelations = relations(playerMultipliers, ({ one }) => ({
  user: one(users, {
    fields: [playerMultipliers.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [playerMultipliers.playerId],
    references: [players.id],
  }),
}));

export const playerMultiplierEventsRelations = relations(playerMultiplierEvents, ({ one }) => ({
  user: one(users, {
    fields: [playerMultiplierEvents.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [playerMultiplierEvents.playerId],
    references: [players.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [orders.playerId],
    references: [players.id],
  }),
}));

export const dailyBoostsRelations = relations(dailyBoosts, ({ one }) => ({
  user: one(users, {
    fields: [dailyBoosts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [dailyBoosts.playerId],
    references: [players.id],
  }),
}));

export const boostPayoutsRelations = relations(boostPayouts, ({ one }) => ({
  boost: one(dailyBoosts, {
    fields: [boostPayouts.boostId],
    references: [dailyBoosts.id],
  }),
  user: one(users, {
    fields: [boostPayouts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [boostPayouts.playerId],
    references: [players.id],
  }),
}));

export const sharePayoutsRelations = relations(sharePayouts, ({ one }) => ({
  user: one(users, {
    fields: [sharePayouts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [sharePayouts.playerId],
    references: [players.id],
  }),
}));

export const userAgentProfilesRelations = relations(userAgentProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userAgentProfiles.userId],
    references: [users.id],
  }),
}));

export const userAgentSecretsRelations = relations(userAgentSecrets, ({ one }) => ({
  user: one(users, {
    fields: [userAgentSecrets.userId],
    references: [users.id],
  }),
}));

export const userAgentThreadsRelations = relations(userAgentThreads, ({ one, many }) => ({
  user: one(users, {
    fields: [userAgentThreads.userId],
    references: [users.id],
  }),
  runs: many(userAgentRuns),
  actionBundles: many(userAgentActionBundles),
  messages: many(userAgentMessages),
}));

export const userAgentRunsRelations = relations(userAgentRuns, ({ one, many }) => ({
  user: one(users, {
    fields: [userAgentRuns.userId],
    references: [users.id],
  }),
  thread: one(userAgentThreads, {
    fields: [userAgentRuns.threadId],
    references: [userAgentThreads.id],
  }),
  proposals: many(userAgentProposals),
  actionBundles: many(userAgentActionBundles),
  messages: many(userAgentMessages),
}));

export const userAgentProposalsRelations = relations(userAgentProposals, ({ one }) => ({
  run: one(userAgentRuns, {
    fields: [userAgentProposals.runId],
    references: [userAgentRuns.id],
  }),
  user: one(users, {
    fields: [userAgentProposals.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [userAgentProposals.playerId],
    references: [players.id],
  }),
}));

export const userAgentActionBundlesRelations = relations(
  userAgentActionBundles,
  ({ one, many }) => ({
    thread: one(userAgentThreads, {
      fields: [userAgentActionBundles.threadId],
      references: [userAgentThreads.id],
    }),
    user: one(users, {
      fields: [userAgentActionBundles.userId],
      references: [users.id],
    }),
    run: one(userAgentRuns, {
      fields: [userAgentActionBundles.runId],
      references: [userAgentRuns.id],
    }),
    messages: many(userAgentMessages),
  }),
);

export const userAgentMessagesRelations = relations(userAgentMessages, ({ one }) => ({
  thread: one(userAgentThreads, {
    fields: [userAgentMessages.threadId],
    references: [userAgentThreads.id],
  }),
  user: one(users, {
    fields: [userAgentMessages.userId],
    references: [users.id],
  }),
  run: one(userAgentRuns, {
    fields: [userAgentMessages.runId],
    references: [userAgentRuns.id],
  }),
  actionBundle: one(userAgentActionBundles, {
    fields: [userAgentMessages.actionBundleId],
    references: [userAgentActionBundles.id],
  }),
  embedding: one(userAgentMessageEmbeddings, {
    fields: [userAgentMessages.id],
    references: [userAgentMessageEmbeddings.messageId],
  }),
}));

export const userAgentMessageEmbeddingsRelations = relations(
  userAgentMessageEmbeddings,
  ({ one }) => ({
    message: one(userAgentMessages, {
      fields: [userAgentMessageEmbeddings.messageId],
      references: [userAgentMessages.id],
    }),
    thread: one(userAgentThreads, {
      fields: [userAgentMessageEmbeddings.threadId],
      references: [userAgentThreads.id],
    }),
    user: one(users, {
      fields: [userAgentMessageEmbeddings.userId],
      references: [users.id],
    }),
  }),
);

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  lastUpdated: true,
});

export const insertPlayerMarketMetricsSchema = createInsertSchema(playerMarketMetrics).omit({
  updatedAt: true,
});

export const insertHoldingSchema = createInsertSchema(holdings).omit({
  id: true,
  lastUpdated: true,
});

export const insertPlayerMultiplierSchema = createInsertSchema(playerMultipliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlayerMultiplierEventSchema = createInsertSchema(playerMultiplierEvents).omit({
  id: true,
  createdAt: true,
});

export const insertHoldingsLockSchema = createInsertSchema(holdingsLocks).omit({
  id: true,
  createdAt: true,
});

export const insertOrderSchema = createInsertSchema(orders)
  .omit({
    id: true,
    filledQuantity: true,
    status: true,
    createdAt: true,
  })
  .extend({
    quantity: z.number().int().positive(),
    limitPrice: z.string().optional(),
  });

export const insertDailyGameSchema = createInsertSchema(dailyGames).omit({
  id: true,
  lastFetchedAt: true,
});

export const insertJobExecutionLogSchema = createInsertSchema(jobExecutionLogs).omit({
  id: true,
  startedAt: true,
});

export const insertPlayerGameStatsSchema = createInsertSchema(playerGameStats).omit({
  id: true,
  lastFetchedAt: true,
});

export const insertVestingSchema = createInsertSchema(vesting).omit({
  id: true,
  updatedAt: true,
});

export const insertVestingSplitSchema = createInsertSchema(vestingSplits).omit({
  id: true,
});

export const insertVestingClaimSchema = createInsertSchema(vestingClaims).omit({
  id: true,
  claimedAt: true,
});

export const insertVestingPresetSchema = createInsertSchema(vestingPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Scout Engine insert schemas
export const insertScoutAssignmentSchema = createInsertSchema(scoutAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScoutDistributionSchema = createInsertSchema(scoutDistributions).omit({
  id: true,
  createdAt: true,
});

export const insertScoutHistorySchema = createInsertSchema(scoutHistory).omit({
  id: true,
  startedAt: true,
});

// Select types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert; // For auth upsert operation

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export type PlayerMarketMetrics = typeof playerMarketMetrics.$inferSelect;
export type InsertPlayerMarketMetrics = z.infer<typeof insertPlayerMarketMetricsSchema>;

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;

export type PlayerMultiplier = typeof playerMultipliers.$inferSelect;
export type InsertPlayerMultiplier = z.infer<typeof insertPlayerMultiplierSchema>;

export type PlayerMultiplierEvent = typeof playerMultiplierEvents.$inferSelect;
export type InsertPlayerMultiplierEvent = z.infer<typeof insertPlayerMultiplierEventSchema>;

export type HoldingsLock = typeof holdingsLocks.$inferSelect;
export type InsertHoldingsLock = z.infer<typeof insertHoldingsLockSchema>;

export type BalanceLock = typeof balanceLocks.$inferSelect;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type Trade = typeof trades.$inferSelect;

export type Vesting = typeof vesting.$inferSelect;
export type InsertVesting = z.infer<typeof insertVestingSchema>;

export type VestingSplit = typeof vestingSplits.$inferSelect;
export type InsertVestingSplit = z.infer<typeof insertVestingSplitSchema>;

export type VestingClaim = typeof vestingClaims.$inferSelect;
export type InsertVestingClaim = z.infer<typeof insertVestingClaimSchema>;

export type VestingPreset = typeof vestingPresets.$inferSelect;
export type InsertVestingPreset = z.infer<typeof insertVestingPresetSchema>;

// Scout Engine types
export type ScoutAssignment = typeof scoutAssignments.$inferSelect;
export type InsertScoutAssignment = z.infer<typeof insertScoutAssignmentSchema>;

export type ScoutDistribution = typeof scoutDistributions.$inferSelect;
export type InsertScoutDistribution = z.infer<typeof insertScoutDistributionSchema>;

export type ScoutHistory = typeof scoutHistory.$inferSelect;
export type InsertScoutHistory = z.infer<typeof insertScoutHistorySchema>;

export type DailyGame = typeof dailyGames.$inferSelect;
export type InsertDailyGame = z.infer<typeof insertDailyGameSchema>;

export type JobExecutionLog = typeof jobExecutionLogs.$inferSelect;
export type InsertJobExecutionLog = z.infer<typeof insertJobExecutionLogSchema>;

export type PlayerGameStats = typeof playerGameStats.$inferSelect;
export type InsertPlayerGameStats = z.infer<typeof insertPlayerGameStatsSchema>;

export type PriceHistory = typeof priceHistory.$inferSelect;

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;

export const insertPortfolioSnapshotSchema = createInsertSchema(portfolioSnapshots).omit({
  id: true,
  createdAt: true,
});

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type InsertPortfolioSnapshot = z.infer<typeof insertPortfolioSnapshotSchema>;

export const insertMarketSnapshotSchema = createInsertSchema(marketSnapshots).omit({
  id: true,
  createdAt: true,
});

export type MarketSnapshot = typeof marketSnapshots.$inferSelect;
export type InsertMarketSnapshot = z.infer<typeof insertMarketSnapshotSchema>;

// Bot profile schemas and types
export const insertBotProfileSchema = createInsertSchema(botProfiles).omit({
  id: true,
  lastActionAt: true,
  ordersToday: true,
  volumeToday: true,
  lastResetDate: true,
  createdAt: true,
  updatedAt: true,
});

export type BotProfile = typeof botProfiles.$inferSelect;
export type InsertBotProfile = z.infer<typeof insertBotProfileSchema>;

// Bot actions log schemas and types
export const insertBotActionLogSchema = createInsertSchema(botActionsLog).omit({
  id: true,
  createdAt: true,
});

export type BotActionLog = typeof botActionsLog.$inferSelect;
export type InsertBotActionLog = z.infer<typeof insertBotActionLogSchema>;

// Premium checkout session schemas and types
export const insertPremiumCheckoutSessionSchema = createInsertSchema(premiumCheckoutSessions).omit({
  id: true,
  status: true,
  completedAt: true,
  createdAt: true,
});

export type PremiumCheckoutSession = typeof premiumCheckoutSessions.$inferSelect;
export type InsertPremiumCheckoutSession = z.infer<typeof insertPremiumCheckoutSessionSchema>;

// Premium order schemas and types
export const insertPremiumOrderSchema = createInsertSchema(premiumOrders).omit({
  id: true,
  filledQuantity: true,
  status: true,
  createdAt: true,
});

export type PremiumOrder = typeof premiumOrders.$inferSelect;
export type InsertPremiumOrder = z.infer<typeof insertPremiumOrderSchema>;

// Premium trade schemas and types
export const insertPremiumTradeSchema = createInsertSchema(premiumTrades).omit({
  id: true,
  executedAt: true,
});

export type PremiumTrade = typeof premiumTrades.$inferSelect;
export type InsertPremiumTrade = z.infer<typeof insertPremiumTradeSchema>;

// Community checkout session schemas and types
export const insertCommunityCheckoutSessionSchema = createInsertSchema(
  communityCheckoutSessions,
).omit({
  id: true,
  status: true,
  completedAt: true,
  createdAt: true,
});

export type CommunityCheckoutSession = typeof communityCheckoutSessions.$inferSelect;
export type InsertCommunityCheckoutSession = z.infer<typeof insertCommunityCheckoutSessionSchema>;

// Community order schemas and types
export const insertCommunityOrderSchema = createInsertSchema(communityOrders).omit({
  id: true,
  filledQuantity: true,
  status: true,
  createdAt: true,
});

export type CommunityOrder = typeof communityOrders.$inferSelect;
export type InsertCommunityOrder = z.infer<typeof insertCommunityOrderSchema>;

// Community trade schemas and types
export const insertCommunityTradeSchema = createInsertSchema(communityTrades).omit({
  id: true,
  executedAt: true,
});

export type CommunityTrade = typeof communityTrades.$inferSelect;
export type InsertCommunityTrade = z.infer<typeof insertCommunityTradeSchema>;

// Whop payment schemas and types
export const insertWhopPaymentSchema = createInsertSchema(whopPayments).omit({
  id: true,
  creditedAt: true,
  revokedAt: true,
  revokedQuantity: true,
  liabilityQuantity: true,
  createdAt: true,
});

export type WhopPayment = typeof whopPayments.$inferSelect;
export type InsertWhopPayment = z.infer<typeof insertWhopPaymentSchema>;

// Tweet settings schemas and types
export const insertTweetSettingsSchema = createInsertSchema(tweetSettings).omit({
  id: true,
  updatedAt: true,
});

export type TweetSettings = typeof tweetSettings.$inferSelect;
export type InsertTweetSettings = z.infer<typeof insertTweetSettingsSchema>;

export const insertAgentSystemSettingsSchema = createInsertSchema(agentSystemSettings).omit({
  id: true,
  updatedAt: true,
});

// Tweet history schemas and types
export const insertTweetHistorySchema = createInsertSchema(tweetHistory).omit({
  id: true,
  createdAt: true,
});

export const insertRedditPostHistorySchema = createInsertSchema(redditPostHistory).omit({
  id: true,
  postedAt: true,
  lastAttemptAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserAgentProfileSchema = createInsertSchema(userAgentProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserAgentSecretSchema = createInsertSchema(userAgentSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rotatedAt: true,
});

export const insertUserAgentThreadSchema = createInsertSchema(userAgentThreads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});

export const insertUserAgentRunSchema = createInsertSchema(userAgentRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertUserAgentProposalSchema = createInsertSchema(userAgentProposals).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
  appliedAt: true,
});

export const insertUserAgentActionBundleSchema = createInsertSchema(userAgentActionBundles).omit({
  id: true,
  createdAt: true,
  confirmedAt: true,
  appliedAt: true,
  updatedAt: true,
});

export const insertUserAgentMessageSchema = createInsertSchema(userAgentMessages).omit({
  id: true,
  createdAt: true,
});

export const insertUserAgentMemorySchema = createInsertSchema(userAgentMemories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export const insertAgentRuntimeSessionSchema = createInsertSchema(agentRuntimeSessions).omit({
  id: true,
  createdAt: true,
});

export const insertUserAgentScheduleSchema = createInsertSchema(userAgentSchedules).omit({
  id: true,
  lastRunAt: true,
  nextRunAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentSkillSchema = createInsertSchema(agentSkills).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export const insertAgentSkillReviewSchema = createInsertSchema(agentSkillReviews).omit({
  id: true,
  createdAt: true,
});

export const insertUserAgentMessageEmbeddingSchema = createInsertSchema(
  userAgentMessageEmbeddings,
).omit({
  id: true,
  createdAt: true,
});

export const updateUserAgentProfileInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    providerMode: z.enum(["managed", "byok"]).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    systemPrompt: z.string().trim().min(1).max(4000).optional(),
    userPromptTemplate: z.string().trim().min(1).max(4000).optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(200).max(4000).optional(),
    analysisWindowMinutes: z.number().int().min(60).max(10080).optional(),
    defaultSport: z.enum(["NBA", "NFL", "MLB", "NASCAR"]).nullable().optional(),
  })
  .strict();

export const userAgentByokInputSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(500),
    baseUrl: z.string().trim().min(1).max(512),
    model: z.string().trim().min(1).max(120),
  })
  .strict();

export const updateAgentSystemSettingsInputSchema = z
  .object({
    managedProvider: z.enum(["chutes", "minimax", "openrouter"]),
    managedModel: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict();

export type TweetHistory = typeof tweetHistory.$inferSelect;
export type InsertTweetHistory = z.infer<typeof insertTweetHistorySchema>;

export type RedditPostHistory = typeof redditPostHistory.$inferSelect;
export type InsertRedditPostHistory = z.infer<typeof insertRedditPostHistorySchema>;

export type AgentSystemSettings = typeof agentSystemSettings.$inferSelect;
export type InsertAgentSystemSettings = z.infer<typeof insertAgentSystemSettingsSchema>;

export type UserAgentProfile = typeof userAgentProfiles.$inferSelect;
export type InsertUserAgentProfile = z.infer<typeof insertUserAgentProfileSchema>;

export type UserAgentSecret = typeof userAgentSecrets.$inferSelect;
export type InsertUserAgentSecret = z.infer<typeof insertUserAgentSecretSchema>;

export type UserAgentThread = typeof userAgentThreads.$inferSelect;
export type InsertUserAgentThread = z.infer<typeof insertUserAgentThreadSchema>;

export type UserAgentRun = typeof userAgentRuns.$inferSelect;
export type InsertUserAgentRun = z.infer<typeof insertUserAgentRunSchema>;

export type UserAgentProposal = typeof userAgentProposals.$inferSelect;
export type InsertUserAgentProposal = z.infer<typeof insertUserAgentProposalSchema>;

export type UserAgentActionBundle = typeof userAgentActionBundles.$inferSelect;
export type InsertUserAgentActionBundle = z.infer<typeof insertUserAgentActionBundleSchema>;

export type UserAgentMessage = typeof userAgentMessages.$inferSelect;
export type InsertUserAgentMessage = z.infer<typeof insertUserAgentMessageSchema>;

export type UserAgentMemory = typeof userAgentMemories.$inferSelect;
export type InsertUserAgentMemory = z.infer<typeof insertUserAgentMemorySchema>;

export type AgentRuntimeSession = typeof agentRuntimeSessions.$inferSelect;
export type InsertAgentRuntimeSession = z.infer<typeof insertAgentRuntimeSessionSchema>;

export type UserAgentSchedule = typeof userAgentSchedules.$inferSelect;
export type InsertUserAgentSchedule = z.infer<typeof insertUserAgentScheduleSchema>;

export type AgentSkill = typeof agentSkills.$inferSelect;
export type InsertAgentSkill = z.infer<typeof insertAgentSkillSchema>;

export type AgentSkillReview = typeof agentSkillReviews.$inferSelect;
export type InsertAgentSkillReview = z.infer<typeof insertAgentSkillReviewSchema>;

export type UserAgentMessageEmbedding = typeof userAgentMessageEmbeddings.$inferSelect;
export type InsertUserAgentMessageEmbedding = z.infer<typeof insertUserAgentMessageEmbeddingSchema>;

export type UpdateUserAgentProfileInput = z.infer<typeof updateUserAgentProfileInputSchema>;
export type UserAgentByokInput = z.infer<typeof userAgentByokInputSchema>;
export type UpdateAgentSystemSettingsInput = z.infer<typeof updateAgentSystemSettingsInputSchema>;

// News feed types
export type NewsFeed = typeof newsFeed.$inferSelect;

// Daily boosts schemas and types
export const insertDailyBoostSchema = createInsertSchema(dailyBoosts).omit({
  id: true,
  status: true,
  fantasyPoints: true,
  payout: true,
  createdAt: true,
  processedAt: true,
});

export type DailyBoost = typeof dailyBoosts.$inferSelect;
export type InsertDailyBoost = z.infer<typeof insertDailyBoostSchema>;

// Boost payouts schemas and types
export const insertBoostPayoutSchema = createInsertSchema(boostPayouts).omit({
  id: true,
  createdAt: true,
});

export type BoostPayout = typeof boostPayouts.$inferSelect;
export type InsertBoostPayout = z.infer<typeof insertBoostPayoutSchema>;

export const insertSharePayoutSchema = createInsertSchema(sharePayouts).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export type SharePayout = typeof sharePayouts.$inferSelect;
export type InsertSharePayout = z.infer<typeof insertSharePayoutSchema>;

// Community boosts schemas and types
export const insertCommunityBoostSchema = createInsertSchema(communityBoosts).omit({
  id: true,
  status: true,
  fantasyPoints: true,
  totalPayout: true,
  beneficiaryCount: true,
  createdAt: true,
  processedAt: true,
});

export type CommunityBoost = typeof communityBoosts.$inferSelect;
export type InsertCommunityBoost = z.infer<typeof insertCommunityBoostSchema>;

// User Collections table - tracks player collection progress (team, rookie, position, allstar)
export const userCollections = pgTable(
  "user_collections",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionType: varchar("collection_type", { length: 50 }).notNull(), // 'team', 'rookie', 'position', 'allstar'
    targetId: varchar("target_id").notNull(), // team abbreviation, position, etc.
    progress: integer("progress").notNull().default(0),
    total: integer("total").notNull(),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userTypeTargetIdx: uniqueIndex("user_collection_idx").on(
      table.userId,
      table.collectionType,
      table.targetId,
    ),
    userIdx: index("user_collections_user_idx").on(table.userId),
    completedIdx: index("user_collections_completed_idx").on(table.completed),
  }),
);

// User Milestones table - tracks net worth and achievement milestones
export const userMilestones = pgTable(
  "user_milestones",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    milestoneType: varchar("milestone_type", { length: 50 }).notNull(), // 'netWorth', 'portfolioValue', 'totalTrades'
    threshold: decimal("threshold", { precision: 20, scale: 2 }).notNull(),
    achievedAt: timestamp("achieved_at").notNull().defaultNow(),
    celebrated: boolean("celebrated").notNull().default(false),
  },
  (table) => ({
    userTypeThresholdIdx: uniqueIndex("user_milestone_idx").on(
      table.userId,
      table.milestoneType,
      table.threshold,
    ),
    userIdx: index("user_milestones_user_idx").on(table.userId),
    celebratedIdx: index("user_milestones_celebrated_idx").on(table.celebrated),
  }),
);

// Relations for new tables
export const userCollectionsRelations = relations(userCollections, ({ one }) => ({
  user: one(users, {
    fields: [userCollections.userId],
    references: [users.id],
  }),
}));

export const userMilestonesRelations = relations(userMilestones, ({ one }) => ({
  user: one(users, {
    fields: [userMilestones.userId],
    references: [users.id],
  }),
}));

// Insert schemas for new tables
export const insertUserCollectionSchema = createInsertSchema(userCollections).omit({
  id: true,
  completed: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserMilestoneSchema = createInsertSchema(userMilestones).omit({
  id: true,
  achievedAt: true,
  celebrated: true,
});

// Types for new tables
export type UserCollection = typeof userCollections.$inferSelect;
export type InsertUserCollection = z.infer<typeof insertUserCollectionSchema>;

export type UserMilestone = typeof userMilestones.$inferSelect;
export type InsertUserMilestone = z.infer<typeof insertUserMilestoneSchema>;

// AMM Pool types
export type PlayerPool = typeof playerPools.$inferSelect;
export type InsertPlayerPool = z.infer<typeof insertPlayerPoolSchema>;

// LP types
export type LpPosition = typeof lpPositions.$inferSelect;
export type InsertLpPosition = z.infer<typeof insertLpPositionSchema>;

export type LpTransaction = typeof lpTransactions.$inferSelect;
export type InsertLpTransaction = z.infer<typeof insertLpTransactionSchema>;

export const insertUserApiTokenSchema = createInsertSchema(userApiTokens).omit({
  id: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
});

export type UserApiToken = typeof userApiTokens.$inferSelect;
export type InsertUserApiToken = z.infer<typeof insertUserApiTokenSchema>;

export const insertUserPhoneLinkSchema = createInsertSchema(userPhoneLinks).omit({
  id: true,
  verifiedAt: true,
  linkedAt: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  smsOptedOutAt: true,
  smsLastStopAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserPhoneLinkTokenSchema = createInsertSchema(userPhoneLinkTokens).omit({
  id: true,
  consumedAt: true,
  createdAt: true,
});

export const insertSmsMessageEventSchema = createInsertSchema(smsMessageEvents).omit({
  id: true,
  createdAt: true,
});

export type UserPhoneLink = typeof userPhoneLinks.$inferSelect;
export type InsertUserPhoneLink = z.infer<typeof insertUserPhoneLinkSchema>;

export type UserPhoneLinkToken = typeof userPhoneLinkTokens.$inferSelect;
export type InsertUserPhoneLinkToken = z.infer<typeof insertUserPhoneLinkTokenSchema>;

export type SmsMessageEvent = typeof smsMessageEvents.$inferSelect;
export type InsertSmsMessageEvent = z.infer<typeof insertSmsMessageEventSchema>;
