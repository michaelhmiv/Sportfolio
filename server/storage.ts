import {
  users,
  players,
  holdings,
  holdingsLocks,
  balanceLocks,
  orders,
  trades,
  vesting,
  vestingSplits,
  vestingClaims,
  vestingPresets,
  scoutAssignments,
  scoutDistributions,
  scoutHistory,
  contests,
  contestEntries,
  contestLineups,
  playerGameStats,
  priceHistory,
  dailyGames,
  jobExecutionLogs,
  blogPosts,
  portfolioSnapshots,
  premiumCheckoutSessions,
  premiumOrders,
  premiumTrades,
  whopPayments,
  watchlists,
  watchList,
  dailyBoosts,
  boostPayouts,
  communityBoosts,
  communityCheckoutSessions,
  type User,
  type InsertUser,
  type UpsertUser,
  type Player,
  type InsertPlayer,
  type Holding,
  type HoldingsLock,
  type InsertHoldingsLock,
  type BalanceLock,
  type Order,
  type Trade,
  type Vesting,
  type VestingSplit,
  type InsertVestingSplit,
  type VestingClaim,
  type InsertVestingClaim,
  type VestingPreset,
  type InsertVestingPreset,
  type ScoutAssignment,
  type InsertScoutAssignment,
  type Contest,
  type InsertContest,
  type ContestEntry,
  type InsertContestEntry,
  type InsertContestLineup,
  type DailyGame,
  type InsertDailyGame,
  type JobExecutionLog,
  type InsertJobExecutionLog,
  type PlayerGameStats,
  type InsertPlayerGameStats,
  type BlogPost,
  type InsertBlogPost,
  type PortfolioSnapshot,
  type InsertPortfolioSnapshot,
  type PriceHistory,
  type PremiumCheckoutSession,
  type PremiumOrder,
  type PremiumTrade,
  type WhopPayment,
  type InsertWhopPayment,
  type DailyBoost,
  type InsertDailyBoost,
  type BoostPayout,
  type InsertBoostPayout,
  type CommunityBoost,
  type InsertCommunityBoost,
  type CommunityCheckoutSession,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, or, gte, lte, isNotNull, count, gt, lt, isNull, ne } from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";
import { getETDayBoundaries, getGameDay } from "./lib/time";

// Season helper: Get current competitive season patterns (regular + playoffs, exclude preseason)
// Returns array of season strings to include in queries
// 
// NBA Calendar:
// - July-September: Offseason (no games, but prepare for upcoming season)
// - October: Preseason begins (new season, but EXCLUDED from competitive stats)
// - October-April: Regular season (INCLUDED in competitive stats)
// - April-June: Playoffs (INCLUDED in competitive stats, combines with regular)
function getCurrentCompetitiveSeasons(): string[] {
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11 (0=Jan, 6=Jul, 9=Oct)
  const currentYear = now.getFullYear();

  // Determine season start year based on NBA calendar:
  // - July-December (months 6-11): Use current year as season start
  // - January-June (months 0-5): Use previous year as season start
  // 
  // Examples:
  // - Nov 2025 → 2025-2026 (current season in progress)
  // - Feb 2025 → 2024-2025 (season started Oct 2024)
  // - Jul 2025 → 2025-2026 (preparing for new season starting Oct 2025)
  // - Jun 2025 → 2024-2025 (playoffs for season that started Oct 2024)
  const seasonStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
  const seasonEndYear = seasonStartYear + 1;

  // Include both regular season and playoffs for rolling competitive average
  // Preseason is explicitly EXCLUDED per user requirements
  // Note: MySportsFeeds uses "playoff" (singular) not "playoffs"
  return [
    `${seasonStartYear}-${seasonEndYear}-regular`,
    `${seasonStartYear}-${seasonEndYear}-playoff`,
    // Explicitly include 2025-2026-regular for NFL compatibility during transition
    "2025-2026-regular",
    // Fallback for data tagged with previous season (e.g. 2024-2025 data extending into 2026)
    "2024-2025-regular",
    "2024-2025-playoff"
  ];
}

export interface PlayerFinancialMetrics {
  peRatio: number;
  valueIndex: number; // 100 = Fair. <100 = Undervalued. >100 = Premium.
  isUndervalued: boolean; // Computed helper (valueIndex < 100)
  sentiment: {
    buyPressure: number; // 0-100
    totalVolume24h: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  heatCheck: {
    l5Avg: number;
    seasonAvg: number;
    status: 'fire' | 'ice' | 'neutral'; // >15% above, >15% below
  };
  marketCapRank: {
    tier: 'blue_chip' | 'mid_cap' | 'moonshot'; // Top 10%, Mid, Bottom 50%
    percentile: number;
  };
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsersForRanking(): Promise<Array<{ userId: string; balance: string; portfolioValue: number }>>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserBalance(userId: string, amount: string): Promise<void>;
  updateUsername(userId: string, username: string): Promise<User | undefined>;
  updateProfileImage(userId: string, imageUrl: string): Promise<User | undefined>;
  incrementTotalSharesVested(userId: string, amount: number): Promise<void>;
  markOnboardingComplete(userId: string): Promise<void>;
  updateUserPremiumStatus(userId: string, isPremium: boolean, premiumExpiresAt: Date | null): Promise<void>;

  // Player methods
  getPlayers(filters?: { search?: string; team?: string; position?: string }): Promise<Player[]>;
  getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'price' | 'volume' | 'change' | 'bid' | 'ask' | 'marketCap' | 'sentiment' | 'undervalued' | 'fantasyPoints' | 'name' | 'team';
    sortOrder?: 'asc' | 'desc';
    hasBuyOrders?: boolean;
    hasSellOrders?: boolean;
    teamsPlayingOnDate?: string[];
    watchlistUserId?: string;
  }): Promise<{ players: Player[]; total: number }>;
  getPlayer(id: string): Promise<Player | undefined>;
  getPlayersByIds(ids: string[]): Promise<Player[]>;
  getPlayersBySport(sport: string): Promise<Player[]>;
  getTopPlayersByVolume(limit: number): Promise<Player[]>;
  upsertPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(playerId: string, updates: Partial<InsertPlayer>): Promise<void>;
  getDistinctTeams(): Promise<string[]>;
  getDistinctTeamsBySport(sport: string): Promise<string[]>;


  // Holdings methods
  getHolding(userId: string, assetType: string, assetId: string): Promise<Holding | undefined>;
  getRegularHolding(userId: string, assetType: string, assetId: string): Promise<Holding | undefined>;
  getUserHoldings(userId: string): Promise<Holding[]>;
  getUserHoldingsWithPlayers(userId: string): Promise<any[]>;
  updateHolding(userId: string, assetType: string, assetId: string, quantity: number, avgCost: string): Promise<void>;
  updateHoldingWithPower(userId: string, assetType: string, assetId: string, power: number, quantity: number, avgCost: string, powerLevel: string): Promise<void>;
  getHoldingsWithPowerBreakdown(userId: string, playerId: string): Promise<{ regular: Holding | null; powered: Holding[] }>;
  getTotalPowerLevel(userId: string, playerId: string): Promise<number>;

  // Batch sentiment logic
  getBatchSentiment(playerIds: string[]): Promise<Map<string, { buyPressure: number; totalVolume24h: number }>>;

  getBatchAllTimeAvgFantasyPoints(playerIds: string[]): Promise<Map<string, number>>;

  // Watch list methods
  getWatchList(userId: string): Promise<string[]>; // Returns array of player IDs (legacy/all lists)
  addToWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void>;
  removeFromWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void>;
  isOnWatchList(userId: string, playerId: string): Promise<boolean>;

  // Multi-watchlist methods
  getWatchlists(userId: string): Promise<{ id: string; name: string; isDefault: boolean; color: string | null; itemCount: number }[]>;
  createWatchlist(userId: string, name: string, isDefault?: boolean, color?: string): Promise<{ id: string; name: string }>;
  updateWatchlist(watchlistId: string, updates: { name?: string; color?: string }): Promise<void>;
  deleteWatchlist(watchlistId: string): Promise<void>;
  ensureDefaultWatchlist(userId: string): Promise<string>; // Returns default watchlist ID
  getWatchlistItems(watchlistId: string): Promise<string[]>; // Returns player IDs
  getPlayerWatchlists(userId: string, playerId: string): Promise<string[]>; // Returns watchlist IDs containing player

  // Holdings lock methods - prevent double-spending of shares
  reserveShares(userId: string, assetType: string, assetId: string, lockType: string, lockReferenceId: string, quantity: number): Promise<HoldingsLock>;
  releaseShares(lockId: string): Promise<void>;
  releaseSharesByReference(lockReferenceId: string): Promise<void>;
  getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number>;
  getLockedShares(userId: string, assetType: string, assetId: string): Promise<HoldingsLock[]>;
  getTotalLockedQuantity(userId: string, assetType: string, assetId: string): Promise<number>;
  adjustLockQuantity(lockReferenceId: string, newQuantity: number): Promise<void>;

  // Balance lock methods - prevent double-spending of cash
  reserveCash(userId: string, lockType: string, lockReferenceId: string, amount: string): Promise<BalanceLock>;
  releaseCash(lockId: string): Promise<void>;
  releaseCashByReference(lockReferenceId: string): Promise<void>;
  getAvailableBalance(userId: string): Promise<number>;
  getTotalLockedBalance(userId: string): Promise<number>;
  adjustLockAmount(lockReferenceId: string, newAmount: string): Promise<void>;

  // Order methods
  createOrder(order: any): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  getUserOrders(userId: string, status?: string): Promise<Order[]>;
  getOrderBook(playerId: string): Promise<{ bids: Order[]; asks: Order[] }>;
  updateOrder(orderId: string, updates: Partial<Order>): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;

  // Trade methods
  createTrade(trade: any): Promise<Trade>;
  getRecentTrades(playerId?: string, limit?: number): Promise<Trade[]>;
  getMarketActivity(filters?: { playerId?: string; userId?: string; limit?: number }): Promise<any[]>;

  // Price history methods
  getPriceHistory(playerId: string, days?: number): Promise<PriceHistory[]>;
  getPrice24hAgo(playerId: string): Promise<number | null>;
  createPriceHistoryRecord(playerId: string, price: string, volume: number): Promise<void>;

  // Market cap methods
  getTotalSharesForPlayer(playerId: string): Promise<number>;

  // Vesting methods
  getVesting(userId: string): Promise<Vesting | undefined>;
  getAllActiveVestingUserIds(): Promise<string[]>;
  updateVesting(userId: string, updates: Partial<Vesting>): Promise<void>;
  getVestingSplits(userId: string): Promise<VestingSplit[]>;
  setVestingSplits(userId: string, splits: InsertVestingSplit[]): Promise<void>;
  createVestingClaim(claim: InsertVestingClaim): Promise<VestingClaim>;

  // Scout Engine methods
  assignScouts(userId: string, playerId: string, count: number): Promise<void>;
  getUserScoutAssignments(userId: string): Promise<(ScoutAssignment & { player: Player | null })[]>;
  getTotalScoutsForUser(userId: string): Promise<number>;
  getActiveScouts(playerId: string): Promise<Array<{ userId: string; scoutCount: number }>>;
  getBatchActiveScoutCounts(playerIds: string[]): Promise<Map<string, number>>;
  updateLastActive(userId: string): Promise<void>;
  // Scout Distribution Engine methods
  getPlayersWithActiveScouts(): Promise<string[]>;
  createScoutDistribution(distribution: {
    hourTimestamp: Date;
    playerId: string;
    userId: string;
    userScoutMinutes: number;
    globalScoutMinutes: number;
    sharesEarned: string;
  }): Promise<void>;
  creditScoutShares(userId: string, playerId: string, shares: number): Promise<void>;
  getScoutRoster(playerId: string): Promise<Array<{ user: { id: string; username: string | null; avatarUrl: string | null } | null; scoutCount: number }>>;

  // Activity methods
  getUserActivity(userId: string, filters?: { types?: string[]; limit?: number; offset?: number }): Promise<any[]>;

  // Contest methods
  getContests(status?: string): Promise<Contest[]>;
  getContest(id: string): Promise<Contest | undefined>;
  createContest(contest: InsertContest): Promise<Contest>;
  updateContest(contestId: string, updates: Partial<Contest>): Promise<void>;
  createContestEntry(entry: InsertContestEntry): Promise<ContestEntry>;
  getContestEntries(contestId: string): Promise<ContestEntry[]>;
  getUserContestEntries(userId: string): Promise<ContestEntry[]>;
  createContestLineup(lineup: InsertContestLineup): Promise<void>;
  getContestLineups(entryId: string): Promise<any[]>;
  updateContestLineup(lineupId: string, updates: any): Promise<void>;
  updateContestEntry(entryId: string, updates: Partial<ContestEntry>): Promise<void>;
  getContestEntryDetail(contestId: string, entryId: string): Promise<any>;

  // Daily games methods
  upsertDailyGame(game: InsertDailyGame): Promise<DailyGame>;
  getDailyGames(startDate: Date, endDate: Date): Promise<DailyGame[]>;
  getDailyGamesBySport(sport: string, startDate: Date, endDate: Date): Promise<DailyGame[]>;
  getDailyGameByGameId(gameId: string): Promise<DailyGame | undefined>;
  createDailyGame(game: InsertDailyGame): Promise<DailyGame>;
  updateDailyGame(id: string, updates: Partial<InsertDailyGame>): Promise<void>;
  updateDailyGameStatus(gameId: string, status: string): Promise<void>;
  updateDailyGameScore(gameId: string, homeScore: number, awayScore: number, status: string): Promise<void>;
  getGamesByTeam(teamAbbreviation: string, startDate: Date, endDate: Date): Promise<DailyGame[]>;

  // Job execution log methods
  createJobLog(log: InsertJobExecutionLog): Promise<JobExecutionLog>;
  updateJobLog(id: string, updates: Partial<JobExecutionLog>): Promise<void>;
  getRecentJobLogs(jobName?: string, limit?: number): Promise<JobExecutionLog[]>;
  getLatestJobLogPerType(jobNames: string[]): Promise<Map<string, JobExecutionLog>>;

  // Player game stats methods
  upsertPlayerGameStats(stats: InsertPlayerGameStats): Promise<PlayerGameStats>;
  getPlayerGameStats(playerId: string, gameId: string): Promise<PlayerGameStats | undefined>;
  getAllPlayerGameStats(playerId: string): Promise<PlayerGameStats[]>;
  getGameStatsByGameId(gameId: string): Promise<PlayerGameStats[]>;
  getPlayerGameStatsByGameAndHomeAway(gameId: string, homeAway: "home" | "away"): Promise<PlayerGameStats[]>;
  getGameLogsCountForDate(dateStr: string, season: string): Promise<number>;
  getPlayerSeasonStatsFromLogs(playerId: string): Promise<{
    gamesPlayed: number;
    avgFantasyPointsPerGame: string;
    pointsPerGame: string;
    reboundsPerGame: string;
    assistsPerGame: string;
    fieldGoalPct: string;
    threePointPct: string;
    freeThrowPct: string;
    steals: number;
    blocks: number;
    minutesPerGame: string;
  } | null>;
  getPlayerRecentGamesFromLogs(playerId: string, limit: number): Promise<any[]>;

  // Blog post methods
  getBlogPosts(options: { limit: number; offset: number; publishedOnly: boolean }): Promise<{ posts: BlogPost[]; total: number }>;
  getBlogPostBySlug(slug: string): Promise<BlogPost | undefined>;
  createBlogPost(post: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: string, updates: Partial<BlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: string): Promise<void>;

  // Portfolio snapshot methods
  getAllUsersForRanking(): Promise<Array<{ userId: string; balance: string; portfolioValue: number }>>;
  getPortfolioSnapshot(userId: string, date: Date): Promise<PortfolioSnapshot | undefined>;
  getLatestSnapshotRanks(): Promise<Map<string, { cashRank: number; portfolioRank: number }>>;
  getPortfolioSnapshotsInRange(userId: string, startDate: Date, endDate: Date): Promise<PortfolioSnapshot[]>;
  createPortfolioSnapshot(snapshot: InsertPortfolioSnapshot): Promise<PortfolioSnapshot>;

  // Analytics methods
  getMarketHealthStats(startDate: Date, endDate: Date): Promise<{
    transactionCount: number;
    totalVolume: number;
    totalMarketCap: number;
    prevTransactionCount: number;
    prevTotalVolume: number;
    prevTotalMarketCap: number;
  }>;
  getMarketHealthTimeSeries(startDate: Date, endDate: Date): Promise<Array<{
    date: string;
    transactions: number;
    volume: number;
    marketCap: number;
  }>>;
  getPlayerSharesOutstanding(playerIds?: string[]): Promise<Map<string, number>>;
  getContestUsageStats(playerIds?: string[]): Promise<Map<string, { timesUsed: number; totalEntries: number; usagePercent: number }>>;
  getPriceHistoryRange(playerIds: string[], startDate: Date, endDate: Date): Promise<Map<string, Array<{ timestamp: Date; price: number }>>>;
  getHotColdPlayers(limit: number): Promise<{ hot: Player[]; cold: Player[] }>;
  getHeatmapData(): Promise<Array<{ team: string; position: string; avgPriceChange: number; playerCount: number; topPlayer: string }>>;
  getPowerRankings(limit?: number): Promise<Array<{
    playerId: string;
    name: string;
    team: string;
    position: string;
    price: number;
    priceChange7d: number;
    volume: number;
    avgFantasyPoints: number;
    compositeScore: number;
  }>>;
  getShareEconomyStats(startDate?: Date, endDate?: Date): Promise<{
    totalSharesVested: number;
    totalSharesBurned: number;
    totalSharesInEconomy: number;
    periodsharesVested: number;
    periodSharesBurned: number;
  }>;
  getShareEconomyTimeSeries(startDate: Date, endDate: Date): Promise<Array<{
    date: string;
    sharesVested: number;
    sharesBurned: number;
  }>>;

  getVestingByReference?(referenceId: string): Promise<Vesting | undefined>;

  // Premium checkout session methods
  createPremiumCheckoutSession(session: { userId: string; planId: string; quantity: number; amountCents: number; whopSessionId?: string }): Promise<PremiumCheckoutSession>;
  getPremiumCheckoutSession(id: string): Promise<PremiumCheckoutSession | undefined>;
  getPremiumCheckoutSessionByReceipt(receiptId: string): Promise<PremiumCheckoutSession | undefined>;
  completePremiumCheckoutSession(id: string, receiptId: string): Promise<PremiumCheckoutSession | undefined>;
  getUserPremiumCheckoutSessions(userId: string): Promise<PremiumCheckoutSession[]>;
  getPendingPremiumCheckoutSessions(): Promise<PremiumCheckoutSession[]>;

  // Community checkout session methods
  createCommunityCheckoutSession(session: { userId: string; planId: string; quantity: number; amountCents: number; whopSessionId?: string }): Promise<CommunityCheckoutSession>;
  getCommunityCheckoutSession(id: string): Promise<CommunityCheckoutSession | undefined>;
  getCommunityCheckoutSessionByReceipt(receiptId: string): Promise<CommunityCheckoutSession | undefined>;
  completeCommunityCheckoutSession(id: string, receiptId: string): Promise<CommunityCheckoutSession | undefined>;
  getUserCommunityCheckoutSessions(userId: string): Promise<CommunityCheckoutSession[]>;
  getPendingCommunityCheckoutSessions(): Promise<CommunityCheckoutSession[]>;

  // Whop payment sync methods
  getWhopPaymentByPaymentId(paymentId: string): Promise<WhopPayment | undefined>;
  getWhopPaymentsByEmail(email: string): Promise<WhopPayment[]>;
  getWhopPaymentsByUserId(userId: string): Promise<WhopPayment[]>;
  getUncreditedWhopPaymentsByEmail(email: string): Promise<WhopPayment[]>;
  upsertWhopPayment(payment: InsertWhopPayment): Promise<WhopPayment>;
  creditWhopPayment(paymentId: string, userId: string): Promise<WhopPayment | undefined>;
  revokeWhopPayment(paymentId: string, revokedQuantity: number, liabilityQuantity?: number): Promise<WhopPayment | undefined>;
  updateWhopPaymentStatus(paymentId: string, whopStatus: string): Promise<WhopPayment | undefined>;

  // Financial Metrics
  getPlayerFinancialMetrics(playerId: string): Promise<PlayerFinancialMetrics>;
  getFinancialMarketScanners(): Promise<{
    undervalued: { player: Player, metrics: PlayerFinancialMetrics }[];
    sentiment: { player: Player, metrics: PlayerFinancialMetrics }[];
    momentum: { player: Player, metrics: PlayerFinancialMetrics }[];
    premium: { player: Player, metrics: PlayerFinancialMetrics }[];
  }>;

  // Daily Boosts methods
  getDailyBoosts(userId: string, sport: string, date: Date): Promise<DailyBoost[]>;
  getDailyBoostsAllSports(userId: string, date: Date): Promise<DailyBoost[]>;
  getDailyBoostsByStatus(status: string): Promise<DailyBoost[]>;
  getEligiblePlayersForBoost(userId: string, sport: string, date: Date): Promise<(Holding & { player: Player; availableShares: number; powerLevel: string; gameId: string | null; gameStartTime: Date | null })[]>;
  getAllHoldingsWithPlayers(userId: string): Promise<(Holding & { player: Player })[]>;
  createDailyBoost(boost: InsertDailyBoost): Promise<DailyBoost>;
  updateDailyBoost(boostId: string, updates: Partial<DailyBoost>): Promise<void>;
  deleteDailyBoost(boostId: string): Promise<void>;
  getBoostPayoutHistory(userId: string, limit?: number): Promise<BoostPayout[]>;
  createBoostPayout(payout: InsertBoostPayout): Promise<BoostPayout>;
  lockBoostShares(boostId: string): Promise<void>;
  unlockBoostShares(boostId: string): Promise<void>;
  ensureHoldingConsistency(holdingId: string): Promise<void>;
  getPlayerGameForDate(playerId: string, sport: string, date: Date): Promise<DailyGame | undefined>;

  // Community Boosts methods
  getCommunityBoostsForDate(sport: string, date: Date): Promise<(CommunityBoost & { creator: User; player: Player })[]>;
  getCommunityBoostsAllSports(date: Date): Promise<(CommunityBoost & { creator: User; player: Player })[]>;
  createCommunityBoost(boost: InsertCommunityBoost): Promise<CommunityBoost>;
  getCommunityBoostBeneficiaries(playerId: string): Promise<(Holding & { user: User })[]>;
  updateCommunityBoost(boostId: string, updates: Partial<CommunityBoost>): Promise<void>;
  getCommunityBoostsByStatus(status: string): Promise<CommunityBoost[]>;
  getScoutStatus(userId: string): Promise<{ earnedMinutes: number; nextDistribution: Date; perPlayer?: Record<string, number> }>;

  // Power Level / Condense methods
  condenseShares(userId: string, playerId: string, rawShareCount: number): Promise<{ newPowerLevel: string; sharesCondensed: number }>;
  getHoldingWithPowerLevel(userId: string, playerId: string): Promise<{ quantity: number; powerLevel: string; availableShares: number } | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Use case-insensitive email matching for consistency with OAuth providers
    const [user] = await db.select().from(users).where(sql`LOWER(${users.email}) = LOWER(${email})`);
    return user || undefined;
  }



  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        balance: "10000.00", // Starting balance
      })
      .returning();

    // Initialize vesting for new user with full bar so they can immediately claim
    // Cap is 2400 for non-premium, 4800 for premium - start at non-premium cap
    await db.insert(vesting).values({
      userId: user.id,
      sharesAccumulated: 2400,
      lastAccruedAt: new Date(),
    });

    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // IDEMPOTENCY GUARD: Check if target user ID already exists
    // This handles duplicate requests/retries where migration already completed
    const [existingTargetUser] = await db.select().from(users).where(eq(users.id, userData.id!));
    if (existingTargetUser) {
      console.log(`[LAZY_MIGRATION] User ${userData.email} already exists with ID ${userData.id}, skipping migration`);
      // Update profile fields if needed and return
      const [updatedUser] = await db
        .update(users)
        .set({
          email: userData.email || existingTargetUser.email,
          firstName: userData.firstName ?? existingTargetUser.firstName,
          lastName: userData.lastName ?? existingTargetUser.lastName,
          profileImageUrl: userData.profileImageUrl ?? existingTargetUser.profileImageUrl,
          username: userData.username || existingTargetUser.username,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userData.id!))
        .returning();
      return updatedUser;
    }

    // Lazy migration: Look up existing user by email first to preserve their data
    // This handles the case where users have existing accounts with different IDs
    // (e.g., migrating from old auth system to Supabase)
    if (userData.email) {
      // Use transaction with FOR UPDATE to prevent race conditions
      const migrationResult = await db.transaction(async (tx) => {
        // Lock the row to prevent concurrent migrations of the same user
        // Use case-insensitive email matching to handle OAuth providers returning different cases
        const [existingUserByEmail] = await tx
          .select()
          .from(users)
          .where(sql`LOWER(${users.email}) = LOWER(${userData.email})`)
          .for('update');

        if (!existingUserByEmail || existingUserByEmail.id === userData.id) {
          // No migration needed - either no user with this email, or same ID
          return null;
        }

        // Found existing user with different ID - update their record with new auth ID
        // This preserves all their holdings, orders, trades, and balances
        console.log(`[LAZY_MIGRATION] Migrating user ${userData.email} from ID ${existingUserByEmail.id} to ${userData.id}`);

        const oldId = existingUserByEmail.id;
        const newId = userData.id;

        // Step 1: Temporarily clear unique constraints on old row to allow new row insert
        // Email and username have unique constraints, so we clear them first
        await tx
          .update(users)
          .set({
            email: null,
            username: `__migrating_${oldId}`
          })
          .where(eq(users.id, oldId));

        // Step 2: Insert a new user row with the new ID, copying all data from old row
        await tx.insert(users).values({
          id: newId,
          email: existingUserByEmail.email,
          username: userData.username || existingUserByEmail.username,
          firstName: userData.firstName ?? existingUserByEmail.firstName,
          lastName: userData.lastName ?? existingUserByEmail.lastName,
          profileImageUrl: userData.profileImageUrl ?? existingUserByEmail.profileImageUrl,
          balance: existingUserByEmail.balance,
          isAdmin: existingUserByEmail.isAdmin,
          isPremium: existingUserByEmail.isPremium,
          premiumExpiresAt: existingUserByEmail.premiumExpiresAt,
          hasSeenOnboarding: existingUserByEmail.hasSeenOnboarding,
          isBot: existingUserByEmail.isBot,
          totalSharesVested: existingUserByEmail.totalSharesVested,
          totalMarketOrders: existingUserByEmail.totalMarketOrders,
          totalTradesExecuted: existingUserByEmail.totalTradesExecuted,
          createdAt: existingUserByEmail.createdAt,
          updatedAt: new Date(),
        });

        // Step 3: Update all FK references to point to the new user ID
        // (New ID now exists, so FK constraints are satisfied)

        // Update vesting records
        await tx
          .update(vesting)
          .set({ userId: newId })
          .where(eq(vesting.userId, oldId));

        // Update holdings
        await tx
          .update(holdings)
          .set({ userId: newId })
          .where(eq(holdings.userId, oldId));

        // Update holdings locks
        await tx
          .update(holdingsLocks)
          .set({ userId: newId })
          .where(eq(holdingsLocks.userId, oldId));

        // Update balance locks
        await tx
          .update(balanceLocks)
          .set({ userId: newId })
          .where(eq(balanceLocks.userId, oldId));

        // Update orders
        await tx
          .update(orders)
          .set({ userId: newId })
          .where(eq(orders.userId, oldId));

        // Update trades (buyer and seller)
        await tx
          .update(trades)
          .set({ buyerId: newId })
          .where(eq(trades.buyerId, oldId));

        await tx
          .update(trades)
          .set({ sellerId: newId })
          .where(eq(trades.sellerId, oldId));

        // Update vesting splits
        await tx
          .update(vestingSplits)
          .set({ userId: newId })
          .where(eq(vestingSplits.userId, oldId));

        // Update vesting claims
        await tx
          .update(vestingClaims)
          .set({ userId: newId })
          .where(eq(vestingClaims.userId, oldId));

        // Update vesting presets
        await tx
          .update(vestingPresets)
          .set({ userId: newId })
          .where(eq(vestingPresets.userId, oldId));

        // Update contest entries
        await tx
          .update(contestEntries)
          .set({ userId: newId })
          .where(eq(contestEntries.userId, oldId));

        // Update portfolio snapshots
        await tx
          .update(portfolioSnapshots)
          .set({ userId: newId })
          .where(eq(portfolioSnapshots.userId, oldId));

        // Update premium checkout sessions
        await tx
          .update(premiumCheckoutSessions)
          .set({ userId: newId })
          .where(eq(premiumCheckoutSessions.userId, oldId));

        // Update premium orders
        await tx
          .update(premiumOrders)
          .set({ userId: newId })
          .where(eq(premiumOrders.userId, oldId));

        // Update premium trades (buyer and seller)
        await tx
          .update(premiumTrades)
          .set({ buyerId: newId })
          .where(eq(premiumTrades.buyerId, oldId));

        await tx
          .update(premiumTrades)
          .set({ sellerId: newId })
          .where(eq(premiumTrades.sellerId, oldId));

        // Update whop payments
        await tx
          .update(whopPayments)
          .set({ userId: newId })
          .where(eq(whopPayments.userId, oldId));

        // Update blog posts (author)
        await tx
          .update(blogPosts)
          .set({ authorId: newId })
          .where(eq(blogPosts.authorId, oldId));

        // Step 4: Delete the old user row (all FKs now point to new row)
        await tx.delete(users).where(eq(users.id, oldId));

        // Return the migrated user
        const [result] = await tx.select().from(users).where(eq(users.id, newId!));
        console.log(`[LAZY_MIGRATION] Successfully migrated user ${userData.email} to new auth ID`);
        return result;
      });

      // If migration happened, return the migrated user
      if (migrationResult) {
        return migrationResult;
      }
    }

    // Standard upsert: either new user or same ID (no migration needed)
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        balance: userData.balance || "10000.00", // Starting balance if new user
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          username: userData.username,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Initialize vesting for new user if it doesn't exist (with lastAccruedAt so vesting job processes them)
    const existingVesting = await db.select().from(vesting).where(eq(vesting.userId, user.id));
    if (existingVesting.length === 0) {
      await db.insert(vesting).values({
        userId: user.id,
        sharesAccumulated: 0,
        lastAccruedAt: new Date(),
      });
    }

    return user;
  }

  async updateUserBalance(userId: string, amount: string): Promise<void> {
    await db
      .update(users)
      .set({ balance: amount })
      .where(eq(users.id, userId));
  }

  async incrementTotalSharesVested(userId: string, amount: number): Promise<void> {
    await db
      .update(users)
      .set({
        totalSharesVested: sql`${users.totalSharesVested} + ${amount}`
      })
      .where(eq(users.id, userId));
  }

  // Vesting methods
  async getVesting(userId: string): Promise<Vesting | undefined> {
    const [userVesting] = await db.select().from(vesting).where(eq(vesting.userId, userId));
    return userVesting || undefined;
  }

  async getAllActiveVestingUserIds(): Promise<string[]> {
    const result = await db.select({ userId: vesting.userId }).from(vesting);
    return result.map(r => r.userId);
  }

  async updateVesting(userId: string, updates: Partial<Vesting>): Promise<void> {
    await db
      .update(vesting)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vesting.userId, userId));
  }

  async getVestingSplits(userId: string): Promise<VestingSplit[]> {
    return await db.select().from(vestingSplits).where(eq(vestingSplits.userId, userId));
  }

  async setVestingSplits(userId: string, splits: InsertVestingSplit[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(vestingSplits).where(eq(vestingSplits.userId, userId));
      if (splits.length > 0) {
        await tx.insert(vestingSplits).values(splits.map(s => ({ ...s, userId })));
      }
    });
  }

  async createVestingClaim(claim: InsertVestingClaim): Promise<VestingClaim> {
    const [created] = await db.insert(vestingClaims).values(claim).returning();
    return created;
  }

  // Scout Engine methods
  async assignScouts(userId: string, playerId: string, count: number): Promise<void> {
    // Use transaction to ensure atomic check-and-update
    await db.transaction(async (tx) => {
      // Get user to check premium status
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user) {
        throw new Error("User not found");
      }

      const maxScouts = user.isPremium ? 10 : 5;

      // Get current total scouts for user (excluding current player if exists)
      const currentAssignments = await tx
        .select({ totalScouts: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)` })
        .from(scoutAssignments)
        .where(and(
          eq(scoutAssignments.userId, userId),
          sql`${scoutAssignments.playerId} != ${playerId}`
        ));

      const currentTotal = Number(currentAssignments[0]?.totalScouts || 0);
      const newTotal = currentTotal + count;

      // Validate scout limit
      if (newTotal > maxScouts) {
        throw new Error(`Scout limit exceeded. Maximum: ${maxScouts}, Current: ${currentTotal}, Requested: ${count}`);
      }

      if (count === 0) {
        // Delete assignment if count is 0
        await tx
          .delete(scoutAssignments)
          .where(and(
            eq(scoutAssignments.userId, userId),
            eq(scoutAssignments.playerId, playerId)
          ));
      } else {
        // Upsert: insert or update
        await tx
          .insert(scoutAssignments)
          .values({
            userId,
            playerId,
            scoutCount: count,
          })
          .onConflictDoUpdate({
            target: [scoutAssignments.userId, scoutAssignments.playerId],
            set: {
              scoutCount: count,
              updatedAt: new Date(),
            },
          });
      }

      // HISTORY LOGGING (Time-Weighted Scouts)
      // 1. Close any currently active history for this user/player
      await tx
        .update(scoutHistory)
        .set({ endedAt: new Date() })
        .where(and(
          eq(scoutHistory.userId, userId),
          eq(scoutHistory.playerId, playerId),
          sql`${scoutHistory.endedAt} IS NULL`
        ));

      // 2. Open new history record if count > 0
      if (count > 0) {
        await tx.insert(scoutHistory).values({
          userId,
          playerId,
          scoutCount: count,
          startedAt: new Date() // Defaults to NOW(), explicit for clarity
        });
      }

      // Update user's lastActiveAt to prevent 24h cleanup kill-switch
      // This ensures users who assign scouts stay eligible for distributions
      await tx
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, userId));
    });
  }

  async getUserScoutAssignments(userId: string): Promise<(ScoutAssignment & { player: Player | null })[]> {
    const results = await db
      .select({
        assignment: scoutAssignments,
        player: players,
      })
      .from(scoutAssignments)
      .leftJoin(players, eq(scoutAssignments.playerId, players.id))
      .where(eq(scoutAssignments.userId, userId));

    return results.map(r => ({
      ...r.assignment,
      player: r.player
    }));
  }

  async getTotalScoutsForUser(userId: string): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)` })
      .from(scoutAssignments)
      .where(eq(scoutAssignments.userId, userId));
    return Number(result[0]?.total || 0);
  }

  async getActiveScouts(playerId: string): Promise<Array<{ userId: string; scoutCount: number }>> {
    // Get scout assignments for this player, filtered by users active within 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await db
      .select({
        userId: scoutAssignments.userId,
        scoutCount: scoutAssignments.scoutCount,
      })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(and(
        eq(scoutAssignments.playerId, playerId),
        gte(users.lastActiveAt, twentyFourHoursAgo)
      ));

    return results.map(r => ({ userId: r.userId, scoutCount: r.scoutCount }));
  }

  async updateLastActive(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  }

  // Scout Distribution Engine methods
  async getPlayersWithActiveScouts(): Promise<string[]> {
    // Get all distinct player IDs that have at least one scout from an active user
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await db
      .selectDistinct({ playerId: scoutAssignments.playerId })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(gte(users.lastActiveAt, twentyFourHoursAgo));

    return results.map(r => r.playerId);
  }

  async createScoutDistribution(distribution: {
    hourTimestamp: Date;
    playerId: string;
    userId: string;
    userScoutMinutes: number;
    globalScoutMinutes: number;
    sharesEarned: string;
  }): Promise<void> {
    await db.insert(scoutDistributions).values({
      hourTimestamp: distribution.hourTimestamp,
      playerId: distribution.playerId,
      userId: distribution.userId,
      userScoutMinutes: distribution.userScoutMinutes,
      globalScoutMinutes: distribution.globalScoutMinutes,
      sharesEarned: distribution.sharesEarned,
    });
  }

  async creditScoutShares(userId: string, playerId: string, shares: number): Promise<void> {
    // Use transaction to prevent race conditions during concurrent distributions
    await db.transaction(async (tx) => {
      // Lock the player row to prevent concurrent totalShares updates
      const [player] = await tx
        .select()
        .from(players)
        .where(eq(players.id, playerId))
        .for('update');

      if (!player) {
        throw new Error(`Player ${playerId} not found`);
      }

      // Credit shares to user's regular holdings (power=1) with $0 cost basis (minted, not purchased)
      const existing = await this.getRegularHolding(userId, 'player', playerId);

      if (existing) {
        // Add to existing regular holding - keep existing cost basis for purchased shares
        // New shares have $0 cost, so weighted average shifts down
        const newQuantity = existing.quantity + shares;
        const existingCost = parseFloat(existing.totalCostBasis || '0');
        // New shares are free, so total cost stays the same
        const newAvgCost = newQuantity > 0 ? (existingCost / newQuantity).toFixed(4) : '0.0000';
        const newPowerLevel = newQuantity; // power=1 means powerLevel = quantity

        await tx
          .update(holdings)
          .set({
            quantity: newQuantity,
            avgCostBasis: newAvgCost,
            powerLevel: newPowerLevel.toFixed(2),
            // totalCostBasis stays the same since new shares are free
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existing.id));
      } else {
        // Create new regular holding with $0 cost basis
        await tx.insert(holdings).values({
          userId,
          assetType: 'player',
          assetId: playerId,
          quantity: shares,
          power: 1,
          powerLevel: shares.toFixed(2),
          avgCostBasis: '0.0000',
          totalCostBasis: '0.00',
          lastUpdated: new Date(),
        });
      }

      // Update player's total shares count (within transaction, with row locked)
      await tx
        .update(players)
        .set({
          totalShares: sql`${players.totalShares} + ${shares}`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));
    });
  }

  async getScoutRoster(playerId: string): Promise<Array<{ user: { id: string; username: string | null; avatarUrl: string | null } | null; scoutCount: number }>> {
    console.log(`[Storage] Fetching scout roster for ${playerId}`);

    // Attempt 1: Full Join (Standard)
    const results = await db
      .select({
        user: {
          id: users.id,
          username: users.username,
          avatarUrl: users.profileImageUrl,
        },
        scoutCount: scoutAssignments.scoutCount,
      })
      .from(scoutAssignments)
      .leftJoin(users, eq(scoutAssignments.userId, users.id))
      .where(and(eq(scoutAssignments.playerId, playerId), gt(scoutAssignments.scoutCount, 0)))
      .orderBy(desc(scoutAssignments.scoutCount))
      .limit(50);

    if (results.length > 0) {
      return results;
    }

    // Attempt 2: Fallback (Raw Assignments) - If Join filtered everything out (unlikely with leftJoin, but possible if RLS on Users table hides rows completely)
    console.log(`[Storage] Join returned 0 rows. Attempting fallback raw fetch for ${playerId}`);
    const rawResults = await db
      .select({
        userId: scoutAssignments.userId,
        scoutCount: scoutAssignments.scoutCount
      })
      .from(scoutAssignments)
      .where(eq(scoutAssignments.playerId, playerId))
      .orderBy(desc(scoutAssignments.scoutCount))
      .limit(50);

    return rawResults.map(r => ({
      user: {
        id: r.userId,
        username: `User ${r.userId.substring(0, 8)}...`, // Anonymized fallback
        avatarUrl: null
      },
      scoutCount: r.scoutCount
    }));
  }

  async addUserBalance(userId: string, delta: number): Promise<User | undefined> {
    // Atomically increment the balance in the database
    // Drizzle handles numeric values correctly when passed directly
    await db
      .update(users)
      .set({
        // PostgreSQL handles the arithmetic atomically with proper precision
        balance: sql`${users.balance} + ${delta}`
      })
      .where(eq(users.id, userId));

    return await this.getUser(userId);
  }

  async updateUsername(userId: string, username: string): Promise<User | undefined> {
    await db
      .update(users)
      .set({ username, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return await this.getUser(userId);
  }

  async updateProfileImage(userId: string, imageUrl: string): Promise<User | undefined> {
    await db
      .update(users)
      .set({ profileImageUrl: imageUrl, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return await this.getUser(userId);
  }

  async markOnboardingComplete(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ hasSeenOnboarding: true })
      .where(eq(users.id, userId));
  }

  async updateUserPremiumStatus(userId: string, isPremium: boolean, premiumExpiresAt: Date | null): Promise<void> {
    await db
      .update(users)
      .set({
        isPremium,
        premiumExpiresAt,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }

  // Helper: Build player query conditions (reused by getPlayers and getPlayersPaginated)
  private buildPlayerQueryConditions(filters?: { search?: string; team?: string; position?: string; sport?: string }) {
    const conditions = [];

    // Sport filter - case-insensitive
    if (filters?.sport && filters.sport.toUpperCase() !== "ALL") {
      conditions.push(sql`UPPER(${players.sport}) = ${filters.sport.toUpperCase()}`);
    }
    if (filters?.team && filters.team !== "all") {
      conditions.push(eq(players.team, filters.team));
    }
    if (filters?.position && filters.position !== "all") {
      conditions.push(eq(players.position, filters.position));
    }
    if (filters?.search) {
      // Use SQL ILIKE for case-insensitive search on first/last name
      const searchTerm = `%${filters.search}%`;
      conditions.push(
        sql`(${players.firstName} ILIKE ${searchTerm} OR ${players.lastName} ILIKE ${searchTerm})`
      );
    }

    return conditions;
  }

  // Player methods - returns full list (legacy API for backward compatibility)
  async getPlayers(filters?: {
    search?: string;
    team?: string;
    position?: string;
  }): Promise<Player[]> {
    const conditions = this.buildPlayerQueryConditions(filters);

    // Build query in one shot to avoid type reassignment issues
    if (conditions.length > 0) {
      return await db.select().from(players).where(and(...conditions));
    }
    return await db.select().from(players);
  }

  // Paginated players - returns subset with total count (new API for performance)
  async getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'price' | 'volume' | 'change' | 'bid' | 'ask' | 'marketCap' | 'sentiment' | 'undervalued' | 'fantasyPoints' | 'name' | 'team';
    sortOrder?: 'asc' | 'desc';
    hasBuyOrders?: boolean;
    hasSellOrders?: boolean;
    teamsPlayingOnDate?: string[];
    watchlistUserId?: string;
  }): Promise<{ players: Player[]; total: number }> {
    const {
      search, team, position, sport,
      limit = 50, offset = 0,
      sortBy = 'volume',
      sortOrder = 'desc',
      hasBuyOrders,
      hasSellOrders,
      teamsPlayingOnDate,
      watchlistUserId
    } = filters || {};

    const baseConditions = this.buildPlayerQueryConditions({ search, team, position, sport });

    // Watchlist filter
    if (watchlistUserId) {
      baseConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${watchList}
          WHERE ${watchList.playerId} = ${players.id}
          AND ${watchList.userId} = ${watchlistUserId}
        )`
      );
    }

    // Add teams playing on date filter
    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {
      baseConditions.push(inArray(players.team, teamsPlayingOnDate));
    }

    // Add order book filters using EXISTS subqueries
    if (hasBuyOrders) {
      baseConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${orders} 
          WHERE ${orders.playerId} = ${players.id} 
          AND ${orders.side} = 'buy' 
          AND ${orders.status} IN ('open', 'partial')
        )`
      );
    }

    if (hasSellOrders) {
      baseConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${orders} 
          WHERE ${orders.playerId} = ${players.id} 
          AND ${orders.side} = 'sell' 
          AND ${orders.status} IN ('open', 'partial')
        )`
      );
    }

    // OPTIMIZATION: When we need metrics for sorting (sentiment, undervalued, etc.), 
    // we use LEFT JOINs to subqueries instead of correlated subqueries in the ORDER BY.
    // This allows Postgres to calculate the aggregations in a single pass.

    // Subquery for Order Metrics (Bid/Ask/Sentiment)
    // Only fetch if sortBy requires it to keep the base query light
    const avgFantasySql = sql`(SELECT AVG(${playerGameStats.fantasyPoints}::numeric) FROM ${playerGameStats} WHERE ${playerGameStats.playerId} = ${players.id})`;
    const bestBidSql = sql`(SELECT MAX(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'buy' AND ${orders.status} IN ('open', 'partial'))`;
    const bestAskSql = sql`(SELECT MIN(${orders.limitPrice}) FROM ${orders} WHERE ${orders.playerId} = ${players.id} AND ${orders.side} = 'sell' AND ${orders.status} IN ('open', 'partial'))`;
    const sentimentSql = sql`(SELECT (SUM(CASE WHEN ${orders.side} = 'buy' AND ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END)::numeric / NULLIF(SUM(CASE WHEN ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END), 0)::numeric) * 100 FROM ${orders} WHERE ${orders.playerId} = ${players.id})`;
    const sentimentVolSql = sql`(SELECT SUM(CASE WHEN ${orders.createdAt} >= NOW() - INTERVAL '24 hours' THEN ${orders.quantity} ELSE 0 END) FROM ${orders} WHERE ${orders.playerId} = ${players.id})`;

    // Build the main data query dynamically
    let dataQuery: any;

    const needsOrders = ['bid', 'ask', 'sentiment', 'undervalued'].includes(sortBy);
    const needsFantasy = ['undervalued', 'fantasyPoints'].includes(sortBy);

    if (needsOrders && needsFantasy) {
      dataQuery = db.select({
        player: players,
        bestBid: bestBidSql,
        bestAsk: bestAskSql,
        sentiment: sentimentSql,
        avg_fantasy: avgFantasySql,
      }).from(players);
    } else if (needsOrders) {
      dataQuery = db.select({
        player: players,
        bestBid: bestBidSql,
        bestAsk: bestAskSql,
        sentiment: sentimentSql,
      }).from(players);
    } else if (needsFantasy) {
      dataQuery = db.select({
        player: players,
        avg_fantasy: avgFantasySql,
      }).from(players);
    } else {
      dataQuery = db.select({
        player: players,
      }).from(players);
    }

    if (baseConditions.length > 0) {
      dataQuery = dataQuery.where(and(...baseConditions)) as any;
    }

    // Additional condition for sentiment sorting (quality filter)
    if (sortBy === 'sentiment') {
      dataQuery = dataQuery.where(sql`${sentimentVolSql} > 10`) as any;
    }

    // Set up ORDER BY
    let orderByClause;
    if (sortBy === 'price') {
      orderByClause = sortOrder === 'asc' ? sql`${players.lastTradePrice} ASC NULLS LAST` : sql`${players.lastTradePrice} DESC NULLS LAST`;
    } else if (sortBy === 'marketCap') {
      orderByClause = sortOrder === 'asc' ? asc(players.marketCap) : desc(players.marketCap);
    } else if (sortBy === 'volume') {
      orderByClause = sortOrder === 'asc' ? asc(players.volume24h) : desc(players.volume24h);
    } else if (sortBy === 'change') {
      orderByClause = sortOrder === 'asc' ? asc(players.priceChange24h) : desc(players.priceChange24h);
    } else if (sortBy === 'bid') {
      orderByClause = sortOrder === 'asc' ? sql`${bestBidSql} ASC NULLS LAST` : sql`${bestBidSql} DESC NULLS LAST`;
    } else if (sortBy === 'ask') {
      orderByClause = sortOrder === 'asc' ? sql`${bestAskSql} ASC NULLS LAST` : sql`${bestAskSql} DESC NULLS LAST`;
    } else if (sortBy === 'sentiment') {
      orderByClause = sortOrder === 'asc'
        ? sql`${sentimentSql} ASC NULLS LAST, ${players.volume24h} ASC`
        : sql`${sentimentSql} DESC NULLS LAST, ${players.volume24h} DESC`;
    } else if (sortBy === 'undervalued') {
      const LEAGUE_AVG_PE = 0.43;
      const peScore = sql`( ( ${players.lastTradePrice}::numeric / NULLIF(${avgFantasySql}, 0) ) / ${LEAGUE_AVG_PE} ) * 100`;
      orderByClause = sortOrder === 'asc'
        ? sql`CASE WHEN ${peScore} > 0 THEN ${peScore} ELSE 999 END ASC`
        : sql`${peScore} DESC NULLS LAST`;
    } else if (sortBy === 'fantasyPoints') {
      orderByClause = sortOrder === 'asc'
        ? sql`${avgFantasySql} ASC NULLS LAST`
        : sql`${avgFantasySql} DESC NULLS LAST`;
    } else if (sortBy === 'name') {
      orderByClause = sortOrder === 'asc'
        ? sql`${players.lastName} ASC, ${players.firstName} ASC`
        : sql`${players.lastName} DESC, ${players.firstName} DESC`;
    } else if (sortBy === 'team') {
      orderByClause = sortOrder === 'asc' ? asc(players.team) : desc(players.team);
    } else {
      orderByClause = desc(players.volume24h);
    }

    // Run count and data fetch in parallel
    // Only apply where clause to count if there are conditions
    const countQuery = baseConditions.length > 0
      ? db.select({ count: sql<number>`COUNT(*)::int` }).from(players).where(and(...baseConditions))
      : db.select({ count: sql<number>`COUNT(*)::int` }).from(players);

    const [countResult, playersDataRaw] = await Promise.all([
      countQuery,
      dataQuery.orderBy(orderByClause).limit(limit).offset(offset)
    ]);

    const total = countResult[0].count;
    // Unwrap the player object from the join result
    const playersData = (playersDataRaw as any[]).map(row => row.player);

    return { players: playersData, total };
  }

  async getPlayer(id: string): Promise<Player | undefined> {
    const [player] = await db.select().from(players).where(eq(players.id, id));
    return player || undefined;
  }

  async getPlayersByIds(ids: string[]): Promise<Player[]> {
    if (ids.length === 0) return [];
    return await db.select().from(players).where(inArray(players.id, ids));
  }

  async getTopPlayersByVolume(limit: number): Promise<Player[]> {
    return await db.select()
      .from(players)
      .orderBy(desc(players.volume24h))
      .limit(limit);
  }

  async upsertPlayer(player: InsertPlayer): Promise<Player> {
    const existing = await this.getPlayer(player.id);

    if (existing) {
      const [updated] = await db
        .update(players)
        .set({ ...player, lastUpdated: new Date() })
        .where(eq(players.id, player.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(players)
        .values(player)
        .returning();
      return created;
    }
  }

  async getDistinctTeams(): Promise<string[]> {
    const result = await db
      .selectDistinct({ team: players.team })
      .from(players)
      .where(eq(players.isActive, true))
      .orderBy(asc(players.team));

    return result.map(r => r.team);
  }

  async getDistinctTeamsBySport(sport: string): Promise<string[]> {
    const result = await db
      .selectDistinct({ team: players.team })
      .from(players)
      .where(and(
        eq(players.isActive, true),
        eq(players.sport, sport)
      ))
      .orderBy(asc(players.team));

    return result.map(r => r.team);
  }

  async getPlayersBySport(sport: string): Promise<Player[]> {
    if (sport.toUpperCase() === 'ALL') {
      return await db.select().from(players);
    }
    return await db.select().from(players).where(sql`UPPER(${players.sport}) = ${sport.toUpperCase()}`);
  }

  async updatePlayer(playerId: string, updates: Partial<InsertPlayer>): Promise<void> {
    await db
      .update(players)
      .set({
        ...updates,
        lastUpdated: new Date(),
      })
      .where(eq(players.id, playerId));
  }

  // Holdings methods
  async getHolding(userId: string, assetType: string, assetId: string): Promise<Holding | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId)
        )
      );
    return holding || undefined;
  }

  // Get regular holding (power=1) for a specific asset
  async getRegularHolding(userId: string, assetType: string, assetId: string): Promise<Holding | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId),
          eq(holdings.power, 1)
        )
      );
    return holding || undefined;
  }

  // Update holding with specific power level
  async updateHoldingWithPower(userId: string, assetType: string, assetId: string, power: number, quantity: number, avgCost: string, powerLevel: string): Promise<void> {
    const existing = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId),
          eq(holdings.power, power)
        )
      );

    if (existing.length > 0) {
      if (quantity <= 0) {
        // Remove holding
        await db
          .delete(holdings)
          .where(eq(holdings.id, existing[0].id));
      } else {
        // Update existing holding
        const avgCostParsed = parseFloat(avgCost);
        const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
        const totalCost = (parseFloat(avgCostNormalized) * quantity).toFixed(2);

        await db
          .update(holdings)
          .set({
            quantity,
            avgCostBasis: avgCostNormalized,
            totalCostBasis: totalCost,
            powerLevel,
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existing[0].id));
      }
    } else if (quantity > 0) {
      // Create new holding
      const avgCostParsed = parseFloat(avgCost);
      const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
      const totalCost = (parseFloat(avgCostNormalized) * quantity).toFixed(2);

      await db
        .insert(holdings)
        .values({
          userId,
          assetType,
          assetId,
          quantity,
          power,
          powerLevel,
          avgCostBasis: avgCostNormalized,
          totalCostBasis: totalCost,
          lastUpdated: new Date(),
        });
    }
  }

  async getUserHoldings(userId: string): Promise<Holding[]> {
    return await db
      .select()
      .from(holdings)
      .where(eq(holdings.userId, userId));
  }

  // Batched version: fetch multiple holdings for specific assets in ONE query
  async getBatchHoldings(userId: string, assetType: string, assetIds: string[]): Promise<Map<string, Holding>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const holdingsArray = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          inArray(holdings.assetId, assetIds)
        )
      );

    const holdingsMap = new Map();
    for (const holding of holdingsArray) {
      holdingsMap.set(holding.assetId, holding);
    }
    return holdingsMap;
  }

  async getUserHoldingsWithPlayers(userId: string): Promise<any[]> {
    const result = await db
      .select({
        holding: holdings,
        player: players,
        totalLocked: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)`,
      })
      .from(holdings)
      .leftJoin(players, and(
        eq(holdings.assetType, "player"),
        eq(holdings.assetId, players.id)
      ))
      .leftJoin(holdingsLocks, and(
        eq(holdingsLocks.userId, holdings.userId),
        eq(holdingsLocks.assetId, holdings.assetId),
        eq(holdingsLocks.assetType, holdings.assetType)
      ))
      .where(eq(holdings.userId, userId))
      .groupBy(holdings.id, players.id);

    return result;
  }

  async updateHolding(userId: string, assetType: string, assetId: string, quantity: number, avgCost: string): Promise<void> {
    const existing = await this.getHolding(userId, assetType, assetId);

    if (existing) {
      if (quantity <= 0) {
        // Remove holding - normalize to zero to avoid NaN
        await db
          .delete(holdings)
          .where(
            and(
              eq(holdings.userId, userId),
              eq(holdings.assetType, assetType),
              eq(holdings.assetId, assetId)
            )
          );
      } else {
        // Update holding - ensure proper rounding and cost basis persistence
        const avgCostParsed = parseFloat(avgCost);
        const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
        const totalCost = (parseFloat(avgCostNormalized) * quantity).toFixed(2);
        // Calculate powerLevel = quantity * power (power stays the same)
        const powerLevel = (quantity * existing.power).toFixed(2);

        await db
          .update(holdings)
          .set({
            quantity,
            powerLevel,
            avgCostBasis: avgCostNormalized,
            totalCostBasis: totalCost,
            lastUpdated: new Date(),
          })
          .where(
            and(
              eq(holdings.userId, userId),
              eq(holdings.assetType, assetType),
              eq(holdings.assetId, assetId)
            )
          );
      }
    } else if (quantity > 0) {
      // Create new holding - ensure proper rounding
      const avgCostParsed = parseFloat(avgCost);
      const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
      const totalCost = (parseFloat(avgCostNormalized) * quantity).toFixed(2);

      await db.insert(holdings).values({
        userId,
        assetType,
        assetId,
        quantity,
        avgCostBasis: avgCostNormalized,
        totalCostBasis: totalCost,
      });
    }
  }

  // Holdings lock methods - prevent double-spending of shares
  async reserveShares(
    userId: string,
    assetType: string,
    assetId: string,
    lockType: string,
    lockReferenceId: string,
    quantity: number
  ): Promise<HoldingsLock> {
    // CRITICAL: Use transaction with row-level lock to prevent race conditions
    return await db.transaction(async (tx) => {
      // Step 1: Lock the holdings row to prevent concurrent modifications
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, assetType),
            eq(holdings.assetId, assetId)
          )
        )
        .for('update'); // SELECT ... FOR UPDATE - prevents concurrent reservations

      if (!holding) {
        throw new Error(`No holdings found for user ${userId}, asset ${assetId}`);
      }

      // Step 2: Calculate currently locked shares within the same transaction
      const lockedResult = await tx
        .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
        .from(holdingsLocks)
        .where(
          and(
            eq(holdingsLocks.userId, userId),
            eq(holdingsLocks.assetType, assetType),
            eq(holdingsLocks.assetId, assetId)
          )
        );

      const totalLocked = Number(lockedResult[0]?.total || 0);
      const available = holding.quantity - totalLocked;

      // Step 3: Check if sufficient shares are available
      if (available < quantity) {
        throw new Error(`Insufficient available shares: have ${available}, need ${quantity}`);
      }

      // Step 4: Create the lock
      const [lock] = await tx
        .insert(holdingsLocks)
        .values({
          userId,
          assetType,
          assetId,
          lockType,
          lockReferenceId,
          lockedQuantity: quantity,
        })
        .returning();

      return lock;
    });
  }

  async releaseShares(lockId: string): Promise<void> {
    await db
      .delete(holdingsLocks)
      .where(eq(holdingsLocks.id, lockId));
  }

  async releaseSharesByReference(lockReferenceId: string): Promise<void> {
    await db
      .delete(holdingsLocks)
      .where(eq(holdingsLocks.lockReferenceId, lockReferenceId));
  }

  async getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number> {
    const holding = await this.getHolding(userId, assetType, assetId);
    if (!holding) return 0;

    const lockedQuantity = await this.getTotalLockedQuantity(userId, assetType, assetId);
    return Math.max(0, holding.quantity - lockedQuantity);
  }

  async getLockedShares(userId: string, assetType: string, assetId: string): Promise<HoldingsLock[]> {
    return await db
      .select()
      .from(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.userId, userId),
          eq(holdingsLocks.assetType, assetType),
          eq(holdingsLocks.assetId, assetId)
        )
      );
  }

  async getTotalLockedQuantity(userId: string, assetType: string, assetId: string): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
      .from(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.userId, userId),
          eq(holdingsLocks.assetType, assetType),
          eq(holdingsLocks.assetId, assetId)
        )
      );

    return Number(result[0]?.total || 0);
  }

  async adjustLockQuantity(lockReferenceId: string, newQuantity: number): Promise<void> {
    if (newQuantity <= 0) {
      await this.releaseSharesByReference(lockReferenceId);
    } else {
      await db
        .update(holdingsLocks)
        .set({ lockedQuantity: newQuantity })
        .where(eq(holdingsLocks.lockReferenceId, lockReferenceId));
    }
  }

  // Cash lock methods - prevent double-spending balance on buy orders
  async reserveCash(
    userId: string,
    lockType: string,
    lockReferenceId: string,
    amount: string
  ): Promise<BalanceLock> {
    // CRITICAL: Use transaction with row-level lock to prevent race conditions
    return await db.transaction(async (tx) => {
      // Step 1: Lock the user row to prevent concurrent modifications
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update'); // SELECT ... FOR UPDATE - prevents concurrent reservations

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Step 2: Calculate available balance (total - locked)
      const totalLocked = await this.getTotalLockedBalance(userId, tx);
      const availableBalance = parseFloat(user.balance) - totalLocked;
      const requestedAmount = parseFloat(amount);

      if (availableBalance < requestedAmount) {
        throw new Error(
          `Insufficient available balance. Available: $${availableBalance.toFixed(2)}, Requested: $${requestedAmount.toFixed(2)}`
        );
      }

      // Step 3: Create the cash lock
      const [lock] = await tx
        .insert(balanceLocks)
        .values({
          userId,
          lockType,
          lockReferenceId,
          lockedAmount: amount,
        })
        .returning();

      return lock;
    });
  }

  async releaseCash(lockId: string): Promise<void> {
    await db
      .delete(balanceLocks)
      .where(eq(balanceLocks.id, lockId));
  }

  async releaseCashByReference(lockReferenceId: string): Promise<void> {
    await db
      .delete(balanceLocks)
      .where(eq(balanceLocks.lockReferenceId, lockReferenceId));
  }

  async getAvailableBalance(userId: string, tx?: any): Promise<number> {
    const dbContext = tx || db;
    const [user] = await dbContext
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) return 0;

    const lockedAmount = await this.getTotalLockedBalance(userId, tx);
    return Math.max(0, parseFloat(user.balance) - lockedAmount);
  }

  async getTotalLockedBalance(userId: string, tx?: any): Promise<number> {
    const dbContext = tx || db;
    const result = await dbContext
      .select({ total: sql<number>`COALESCE(SUM(${balanceLocks.lockedAmount}), 0)` })
      .from(balanceLocks)
      .where(eq(balanceLocks.userId, userId));

    return Number(result[0]?.total || 0);
  }

  async adjustLockAmount(lockReferenceId: string, newAmount: string): Promise<void> {
    const amountNum = parseFloat(newAmount);
    if (amountNum <= 0) {
      await this.releaseCashByReference(lockReferenceId);
    } else {
      await db
        .update(balanceLocks)
        .set({ lockedAmount: newAmount })
        .where(eq(balanceLocks.lockReferenceId, lockReferenceId));
    }
  }

  // Order methods
  async createOrder(order: any): Promise<Order> {
    const [created] = await db
      .insert(orders)
      .values(order)
      .returning();
    return created;
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order || undefined;
  }

  async getUserOrders(userId: string, status?: string): Promise<Order[]> {
    if (status) {
      return await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.status, status)))
        .orderBy(desc(orders.createdAt));
    }
    return await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }

  async getOrderBook(playerId: string): Promise<{ bids: Order[]; asks: Order[] }> {
    const allOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.playerId, playerId), or(eq(orders.status, "open"), eq(orders.status, "partial"))));

    const bids = allOrders
      .filter(o => o.side === "buy" && o.orderType === "limit")
      .sort((a, b) => parseFloat(b.limitPrice || "0") - parseFloat(a.limitPrice || "0"));

    const asks = allOrders
      .filter(o => o.side === "sell" && o.orderType === "limit")
      .sort((a, b) => parseFloat(a.limitPrice || "0") - parseFloat(b.limitPrice || "0"));

    return { bids, asks };
  }

  // Batched version: fetch order books for multiple players in ONE query
  // This eliminates N+1 query problem (50 players = 1 query instead of 50 queries)
  async getBatchOrderBooks(playerIds: string[]): Promise<Map<string, { bids: Order[]; asks: Order[]; bestBid: string | null; bestAsk: string | null; bidSize: number; askSize: number }>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    // Fetch all open and partial orders for ALL players in one query
    const allOrders = await db
      .select()
      .from(orders)
      .where(and(
        inArray(orders.playerId, playerIds),
        or(eq(orders.status, "open"), eq(orders.status, "partial"))
      ));

    // Group orders by player and calculate order book data
    const orderBookMap = new Map();

    for (const playerId of playerIds) {
      const playerOrders = allOrders.filter(o => o.playerId === playerId);

      const bids = playerOrders
        .filter(o => o.side === "buy" && o.orderType === "limit")
        .sort((a, b) => parseFloat(b.limitPrice || "0") - parseFloat(a.limitPrice || "0"));

      const asks = playerOrders
        .filter(o => o.side === "sell" && o.orderType === "limit")
        .sort((a, b) => parseFloat(a.limitPrice || "0") - parseFloat(b.limitPrice || "0"));

      // Calculate best bid, best ask, and sizes (same logic as /api/players endpoint)
      const bestBid = bids.length > 0 && bids[0].limitPrice ? bids[0].limitPrice : null;
      const bestAsk = asks.length > 0 && asks[0].limitPrice ? asks[0].limitPrice : null;

      const bidSize = bids.length > 0 && bids[0].limitPrice
        ? bids.filter(b => b.limitPrice === bids[0].limitPrice)
          .reduce((sum, b) => sum + (b.quantity - b.filledQuantity), 0)
        : 0;

      const askSize = asks.length > 0 && asks[0].limitPrice
        ? asks.filter(a => a.limitPrice === asks[0].limitPrice)
          .reduce((sum, a) => sum + (a.quantity - a.filledQuantity), 0)
        : 0;

      orderBookMap.set(playerId, {
        bids,
        asks,
        bestBid,
        bestAsk,
        bidSize,
        askSize,
      });
    }

    return orderBookMap;
  }

  async getBatchSentiment(playerIds: string[]): Promise<Map<string, { buyPressure: number; totalVolume24h: number }>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    const sentimentStats = await db
      .select({
        playerId: orders.playerId,
        buyVol: sql<number>`SUM(CASE WHEN ${orders.side} = 'buy' THEN ${orders.quantity} ELSE 0 END)`,
        totalVol: sql<number>`SUM(${orders.quantity})`,
      })
      .from(orders)
      .where(and(
        inArray(orders.playerId, playerIds),
        gte(orders.createdAt, sql`NOW() - INTERVAL '24 hours'`)
      ))
      .groupBy(orders.playerId);

    const sentimentMap = new Map();
    for (const s of sentimentStats) {
      const buyPressure = s.totalVol > 0 ? (s.buyVol / s.totalVol) * 100 : 50;
      sentimentMap.set(s.playerId as string, { buyPressure, totalVolume24h: s.totalVol });
    }

    // Ensure all requested IDs have an entry (default to neutral 50)
    for (const id of playerIds) {
      if (!sentimentMap.has(id)) {
        sentimentMap.set(id, { buyPressure: 50, totalVolume24h: 0 });
      }
    }

    return sentimentMap;
  }

  // Batch fetch ALL-TIME average fantasy points for players
  // This matches the calculation used in getFinancialMarketScanners for value index
  async getBatchAllTimeAvgFantasyPoints(playerIds: string[]): Promise<Map<string, number>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    // Same query logic as getFinancialMarketScanners line 3840
    const avgStats = await db
      .select({
        playerId: playerGameStats.playerId,
        avgPoints: sql<string>`AVG(CAST(${playerGameStats.fantasyPoints} AS numeric))`,
      })
      .from(playerGameStats)
      .where(inArray(playerGameStats.playerId, playerIds))
      .groupBy(playerGameStats.playerId);

    const avgMap = new Map<string, number>();
    for (const stat of avgStats) {
      avgMap.set(stat.playerId as string, stat.avgPoints ? parseFloat(stat.avgPoints) : 0);
    }

    // Ensure all requested IDs have an entry (default to 0)
    for (const id of playerIds) {
      if (!avgMap.has(id)) {
        avgMap.set(id, 0);
      }
    }

    return avgMap;
  }

  async updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
    await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, orderId));
  }

  async cancelOrder(orderId: string): Promise<void> {
    await db
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId));

    // Release any locked shares for this order (sell orders)
    await this.releaseSharesByReference(orderId);

    // Release any locked cash for this order (buy orders)
    await this.releaseCashByReference(orderId);
  }

  // Trade methods
  async createTrade(trade: any): Promise<Trade> {
    const [created] = await db
      .insert(trades)
      .values(trade)
      .returning();
    return created;
  }

  async getRecentTrades(playerId?: string, limit: number = 10): Promise<Trade[]> {
    if (playerId) {
      return await db
        .select()
        .from(trades)
        .where(eq(trades.playerId, playerId))
        .orderBy(desc(trades.executedAt))
        .limit(limit);
    }
    return await db
      .select()
      .from(trades)
      .orderBy(desc(trades.executedAt))
      .limit(limit);
  }

  async getMarketActivity(filters?: { playerId?: string; userId?: string; playerSearch?: string; limit?: number; sport?: string }): Promise<any[]> {
    const { playerId, userId, playerSearch, limit = 50, sport } = filters || {};

    const buyer = alias(users, "buyer");
    const seller = alias(users, "seller");
    const ordersUser = alias(users, "orders_user");


    // Unified Market Activity Query using UNION ALL
    // This allows the database to handle sorting and limiting across both trades and orders in one pass.
    const searchPattern = playerSearch ? `%${playerSearch}%` : null;
    const normalizedSport = sport?.toUpperCase() !== "ALL" ? sport?.toUpperCase() : null;

    // --- Trades Subquery ---
    const tradesBase = db
      .select({
        activityType: sql<string>`'trade'`.as('activityType'),
        id: trades.id,
        playerId: trades.playerId,
        playerFirstName: players.firstName,
        playerLastName: players.lastName,
        playerTeam: players.team,
        playerSport: players.sport,
        userId: sql<string>`NULL`.as('userId'),
        userUsername: sql<string>`NULL`.as('userUsername'),
        userAvatar: sql<string | null>`NULL`.as('userAvatar'),
        buyerId: trades.buyerId,
        buyerUsername: sql<string>`${buyer.username}`.as('buyerUsername'),
        sellerId: trades.sellerId,
        sellerUsername: sql<string>`${seller.username}`.as('sellerUsername'),
        side: sql<string>`NULL`.as('side'),
        orderType: sql<string>`NULL`.as('orderType'),
        quantity: trades.quantity,
        price: trades.price,
        limitPrice: sql<string>`NULL`.as('limitPrice'),
        timestamp: sql<Date>`${trades.executedAt}`.as('timestamp'),
      })
      .from(trades)
      .innerJoin(players, eq(trades.playerId, players.id))
      .innerJoin(buyer, eq(trades.buyerId, buyer.id))
      .innerJoin(seller, eq(trades.sellerId, seller.id));

    const tradesConditions = [];
    if (playerId) tradesConditions.push(eq(trades.playerId, playerId));
    if (userId) tradesConditions.push(or(eq(trades.buyerId, userId), eq(trades.sellerId, userId)));
    if (searchPattern) tradesConditions.push(sql`(${players.firstName} ILIKE ${searchPattern} OR ${players.lastName} ILIKE ${searchPattern})`);
    if (normalizedSport) tradesConditions.push(sql`UPPER(${players.sport}) = ${normalizedSport}`);

    const finalTradesQuery = tradesConditions.length > 0 ? tradesBase.where(and(...tradesConditions)) : tradesBase;

    // --- Orders Subquery ---
    const ordersBase = db
      .select({
        activityType: sql<string>`CASE WHEN ${orders.status} = 'cancelled' THEN 'order_cancelled' ELSE 'order_placed' END`.as('activityType'),
        id: orders.id,
        playerId: orders.playerId,
        playerFirstName: players.firstName,
        playerLastName: players.lastName,
        playerTeam: players.team,
        playerSport: players.sport,
        userId: orders.userId,
        userUsername: sql<string>`${ordersUser.username}`.as('userUsername'),
        userAvatar: ordersUser.profileImageUrl,
        buyerId: sql<string>`NULL`.as('buyerId'),
        buyerUsername: sql<string>`NULL`.as('buyerUsername'),
        sellerId: sql<string>`NULL`.as('sellerId'),
        sellerUsername: sql<string>`NULL`.as('sellerUsername'),
        side: orders.side,
        orderType: orders.orderType,
        quantity: orders.quantity,
        price: sql<string>`NULL`.as('price'),
        limitPrice: sql<string>`${orders.limitPrice}`.as('limitPrice'),
        timestamp: sql<Date>`${orders.createdAt}`.as('timestamp'),
      })
      .from(orders)
      .innerJoin(players, eq(orders.playerId, players.id))
      .innerJoin(ordersUser, eq(orders.userId, ordersUser.id));

    const orderConditions = [];
    if (playerId) orderConditions.push(eq(orders.playerId, playerId));
    if (userId) orderConditions.push(eq(orders.userId, userId));
    if (searchPattern) orderConditions.push(sql`(${players.firstName} ILIKE ${searchPattern} OR ${players.lastName} ILIKE ${searchPattern})`);
    if (normalizedSport) orderConditions.push(sql`UPPER(${players.sport}) = ${normalizedSport}`);

    const finalOrdersQuery = orderConditions.length > 0 ? ordersBase.where(and(...orderConditions)) : ordersBase;

    // Combine using UNION ALL and apply global order + limit
    const combinedQuery = db
      .select()
      .from(unionAll(finalTradesQuery, finalOrdersQuery).as('activity'))
      .orderBy(sql`timestamp DESC`)
      .limit(limit);

    return await combinedQuery;


  }

  // Price history methods
  async getPriceHistory(playerId: string, days: number = 30): Promise<PriceHistory[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.playerId, playerId),
          sql`${priceHistory.timestamp} >= ${startDate}`
        )
      )
      .orderBy(priceHistory.timestamp);
  }

  async getPrice24hAgo(playerId: string): Promise<number | null> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Get the closest price record to 24h ago
    const [record] = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.playerId, playerId),
          sql`${priceHistory.timestamp} <= ${twentyFourHoursAgo}`
        )
      )
      .orderBy(desc(priceHistory.timestamp))
      .limit(1);

    return record ? parseFloat(record.price) : null;
  }

  async createPriceHistoryRecord(playerId: string, price: string, volume: number): Promise<void> {
    await db.insert(priceHistory).values({
      playerId,
      price,
      volume,
      timestamp: new Date(),
    });
  }

  // Market cap methods
  async getTotalSharesForPlayer(playerId: string): Promise<number> {
    const [result] = await db
      .select({
        totalShares: sql<string>`COALESCE(SUM(${holdings.quantity}), 0)`,
      })
      .from(holdings)
      .where(
        and(
          eq(holdings.assetType, 'player'),
          eq(holdings.assetId, playerId)
        )
      );

    return parseInt(result?.totalShares || '0', 10);
  }



  // Vesting presets methods
  async getVestingPresets(userId: string): Promise<VestingPreset[]> {
    return await db
      .select()
      .from(vestingPresets)
      .where(eq(vestingPresets.userId, userId))
      .orderBy(asc(vestingPresets.name));
  }

  async getVestingPreset(presetId: string): Promise<VestingPreset | undefined> {
    const [preset] = await db
      .select()
      .from(vestingPresets)
      .where(eq(vestingPresets.id, presetId));
    return preset || undefined;
  }

  async createVestingPreset(preset: InsertVestingPreset): Promise<VestingPreset> {
    const [created] = await db
      .insert(vestingPresets)
      .values(preset)
      .returning();
    return created;
  }

  async updateVestingPreset(presetId: string, updates: Partial<InsertVestingPreset>): Promise<VestingPreset | undefined> {
    const [updated] = await db
      .update(vestingPresets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vestingPresets.id, presetId))
      .returning();
    return updated || undefined;
  }

  async deleteVestingPreset(presetId: string): Promise<boolean> {
    const result = await db
      .delete(vestingPresets)
      .where(eq(vestingPresets.id, presetId))
      .returning();
    return result.length > 0;
  }

  async countVestingPresets(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vestingPresets)
      .where(eq(vestingPresets.userId, userId));
    return result?.count || 0;
  }

  // Activity methods
  async getUserActivity(userId: string, filters?: { types?: string[]; limit?: number; offset?: number }): Promise<any[]> {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    const types = filters?.types || ['vesting', 'market', 'contest', 'scout'];

    const activities: any[] = [];

    // 1. Vesting claims
    if (types.includes('vesting')) {
      const claims = await db
        .select({
          id: vestingClaims.id,
          occurredAt: vestingClaims.claimedAt,
          playerId: vestingClaims.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          sharesClaimed: vestingClaims.sharesClaimed,
        })
        .from(vestingClaims)
        .leftJoin(players, eq(vestingClaims.playerId, players.id))
        .where(eq(vestingClaims.userId, userId))
        .orderBy(desc(vestingClaims.claimedAt))
        .limit(limit);

      claims.forEach(claim => {
        activities.push({
          id: `vesting-${claim.id}`,
          userId,
          occurredAt: claim.occurredAt,
          category: 'vesting',
          subtype: 'claim',
          cashDelta: '0.00',
          sharesDelta: claim.sharesClaimed,
          metadata: {
            playerId: claim.playerId,
            playerName: claim.playerId ? `${claim.playerFirstName} ${claim.playerLastName}` : 'Multiple Players',
            playerTeam: claim.playerTeam,
            sharesClaimed: claim.sharesClaimed,
          },
        });
      });
    }

    // 2. Orders (placed/cancelled)
    if (types.includes('market')) {
      const userOrders = await db
        .select({
          id: orders.id,
          occurredAt: orders.createdAt,
          playerId: orders.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          side: orders.side,
          orderType: orders.orderType,
          quantity: orders.quantity,
          limitPrice: orders.limitPrice,
          status: orders.status,
        })
        .from(orders)
        .innerJoin(players, eq(orders.playerId, players.id))
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(limit);

      userOrders.forEach(order => {
        activities.push({
          id: `order-${order.id}`,
          userId,
          occurredAt: order.occurredAt,
          category: 'market',
          subtype: order.status === 'cancelled' ? 'order_cancelled' : 'order_placed',
          cashDelta: '0.00', // Orders don't change cash until trades execute
          sharesDelta: 0,
          metadata: {
            playerId: order.playerId,
            playerName: `${order.playerFirstName} ${order.playerLastName}`,
            playerTeam: order.playerTeam,
            side: order.side,
            orderType: order.orderType,
            quantity: order.quantity,
            limitPrice: order.limitPrice,
            tradePrice: order.limitPrice, // For frontend display consistency
            status: order.status,
          },
        });
      });

      // 3. Trades (executed)
      const userBuyTrades = await db
        .select({
          id: trades.id,
          occurredAt: trades.executedAt,
          playerId: trades.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          quantity: trades.quantity,
          price: trades.price,
        })
        .from(trades)
        .innerJoin(players, eq(trades.playerId, players.id))
        .where(eq(trades.buyerId, userId))
        .orderBy(desc(trades.executedAt))
        .limit(limit);

      userBuyTrades.forEach(trade => {
        const totalCost = parseFloat(trade.price) * trade.quantity;
        activities.push({
          id: `trade-buy-${trade.id}`,
          userId,
          occurredAt: trade.occurredAt,
          category: 'market',
          subtype: 'trade_buy',
          cashDelta: `-${totalCost.toFixed(2)}`,
          sharesDelta: trade.quantity,
          metadata: {
            playerId: trade.playerId,
            playerName: `${trade.playerFirstName} ${trade.playerLastName}`,
            playerTeam: trade.playerTeam,
            quantity: trade.quantity,
            tradePrice: trade.price,
            side: 'buy',
          },
        });
      });

      const userSellTrades = await db
        .select({
          id: trades.id,
          occurredAt: trades.executedAt,
          playerId: trades.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          quantity: trades.quantity,
          price: trades.price,
        })
        .from(trades)
        .innerJoin(players, eq(trades.playerId, players.id))
        .where(eq(trades.sellerId, userId))
        .orderBy(desc(trades.executedAt))
        .limit(limit);

      userSellTrades.forEach(trade => {
        const totalRevenue = parseFloat(trade.price) * trade.quantity;
        activities.push({
          id: `trade-sell-${trade.id}`,
          userId,
          occurredAt: trade.occurredAt,
          category: 'market',
          subtype: 'trade_sell',
          cashDelta: `${totalRevenue.toFixed(2)}`,
          sharesDelta: -trade.quantity,
          metadata: {
            playerId: trade.playerId,
            playerName: `${trade.playerFirstName} ${trade.playerLastName}`,
            playerTeam: trade.playerTeam,
            quantity: trade.quantity,
            tradePrice: trade.price,
            side: 'sell',
          },
        });
      });
    }

    // 4. Contest entries (entry fee + payout)
    if (types.includes('contest')) {
      const userEntries = await db
        .select({
          id: contestEntries.id,
          contestId: contestEntries.contestId,
          contestName: contests.name,
          contestStatus: contests.status,
          contestEndsAt: contests.endsAt,
          entryFee: contests.entryFee,
          totalSharesEntered: contestEntries.totalSharesEntered,
          totalScore: contestEntries.totalScore,
          rank: contestEntries.rank,
          payout: contestEntries.payout,
          createdAt: contestEntries.createdAt,
        })
        .from(contestEntries)
        .innerJoin(contests, eq(contestEntries.contestId, contests.id))
        .where(eq(contestEntries.userId, userId))
        .orderBy(desc(contestEntries.createdAt))
        .limit(limit);

      userEntries.forEach(entry => {
        // Entry creation (fee charged)
        activities.push({
          id: `contest-entry-${entry.id}`,
          userId,
          occurredAt: entry.createdAt,
          category: 'contest',
          subtype: 'contest_entry',
          cashDelta: '0.00', // Contests use shares, not cash
          sharesDelta: 0,
          metadata: {
            contestId: entry.contestId,
            contestName: entry.contestName,
            entryFee: entry.entryFee,
            totalSharesEntered: entry.totalSharesEntered,
          },
        });

        // Contest completion (payout received) - only if contest is completed and payout > 0
        if (entry.contestStatus === 'completed' && parseFloat(entry.payout) > 0) {
          activities.push({
            id: `contest-payout-${entry.id}`,
            userId,
            occurredAt: entry.contestEndsAt || entry.createdAt, // Use contest end time for payout timestamp
            category: 'contest',
            subtype: 'contest_payout',
            cashDelta: `${entry.payout}`,
            sharesDelta: 0,
            metadata: {
              contestId: entry.contestId,
              contestName: entry.contestName,
              rank: entry.rank,
              payout: entry.payout,
              totalScore: entry.totalScore,
            },
          });
        }
      });
    }

    // 5. Scout distributions (hourly share earnings)
    if (types.includes('scout')) {
      const distributions = await db
        .select({
          id: scoutDistributions.id,
          occurredAt: scoutDistributions.hourTimestamp,
          playerId: scoutDistributions.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          sharesEarned: scoutDistributions.sharesEarned,
        })
        .from(scoutDistributions)
        .leftJoin(players, eq(scoutDistributions.playerId, players.id))
        .where(eq(scoutDistributions.userId, userId))
        .orderBy(desc(scoutDistributions.hourTimestamp))
        .limit(limit);

      distributions.forEach(dist => {
        activities.push({
          id: `scout-dist-${dist.id}`,
          userId,
          occurredAt: dist.occurredAt,
          category: 'scout',
          subtype: 'distribution',
          cashDelta: '0.00',
          sharesDelta: parseFloat(dist.sharesEarned?.toString() || '0'),
          metadata: {
            playerId: dist.playerId,
            playerName: dist.playerId ? `${dist.playerFirstName} ${dist.playerLastName}` : 'Unknown Player',
            playerTeam: dist.playerTeam,
            sharesEarned: dist.sharesEarned,
          },
        });
      });
    }

    // Sort all activities by timestamp (most recent first) and apply pagination
    const sorted = activities.sort((a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );

    // Get current user balance for balance-after calculations
    const user = await this.getUser(userId);
    if (!user) return [];

    let currentBalance = parseFloat(user.balance);

    // Process activities from most recent to oldest, adding descriptions and balance-after
    const enrichedActivities = sorted.slice(offset, offset + limit).map((activity: any) => {
      const cashDelta = activity.cashDelta ? parseFloat(activity.cashDelta) : 0;
      const balanceAfter = currentBalance;

      // Move backwards through history (we're going DESC)
      currentBalance -= cashDelta;

      // Build description
      let description = '';
      const meta = activity.metadata;

      if (activity.category === 'vesting') {
        description = `Claimed ${meta.sharesClaimed} shares${meta.playerName ? ` of ${meta.playerName}` : ''}`;
      } else if (activity.category === 'market') {
        if (activity.subtype === 'trade_buy') {
          description = `Bought ${meta.quantity} shares of ${meta.playerName} @ $${meta.tradePrice}`;
        } else if (activity.subtype === 'trade_sell') {
          description = `Sold ${meta.quantity} shares of ${meta.playerName} @ $${meta.tradePrice}`;
        } else if (activity.subtype === 'order_placed') {
          if (meta.orderType === 'limit') {
            description = `${meta.side === 'buy' ? 'Buy' : 'Sell'} limit order: ${meta.quantity} shares of ${meta.playerName} @ $${meta.limitPrice}`;
          } else {
            description = `${meta.side === 'buy' ? 'Buy' : 'Sell'} market order: ${meta.quantity} shares of ${meta.playerName}`;
          }
        } else if (activity.subtype === 'order_cancelled') {
          description = `Cancelled ${meta.side} order for ${meta.quantity} shares of ${meta.playerName}`;
        }
      } else if (activity.category === 'contest') {
        if (activity.subtype === 'contest_entry') {
          description = `Entered ${meta.contestName}`;
        } else if (activity.subtype === 'contest_payout') {
          description = `${meta.contestName} - Rank ${meta.rank} Payout`;
        }
      } else if (activity.category === 'scout') {
        description = `Scouting reward: ${meta.sharesEarned} shares of ${meta.playerName}`;
      }

      return {
        id: activity.id,
        timestamp: activity.occurredAt,
        category: activity.category,
        type: activity.subtype,
        description,
        cashDelta: cashDelta !== 0 ? activity.cashDelta : undefined,
        shareDelta: activity.sharesDelta || undefined,
        balanceAfter: balanceAfter.toFixed(2),
        metadata: meta,
      };
    });

    return enrichedActivities;
  }

  // Contest methods
  async getContests(status?: string): Promise<Contest[]> {
    if (status) {
      return await db
        .select()
        .from(contests)
        .where(eq(contests.status, status))
        .orderBy(desc(contests.startsAt));
    }
    return await db
      .select()
      .from(contests)
      .orderBy(desc(contests.startsAt));
  }

  async getContest(id: string): Promise<Contest | undefined> {
    const [contest] = await db.select().from(contests).where(eq(contests.id, id));
    return contest || undefined;
  }

  async createContest(contest: InsertContest): Promise<Contest> {
    const [created] = await db
      .insert(contests)
      .values(contest)
      .returning();
    return created;
  }

  async createContestEntry(entry: InsertContestEntry): Promise<ContestEntry> {
    const [created] = await db
      .insert(contestEntries)
      .values(entry)
      .returning();
    return created;
  }

  async getContestEntries(contestId: string): Promise<ContestEntry[]> {
    return await db
      .select()
      .from(contestEntries)
      .where(eq(contestEntries.contestId, contestId))
      .orderBy(asc(contestEntries.rank));
  }

  async getUserContestEntries(userId: string): Promise<ContestEntry[]> {
    return await db
      .select()
      .from(contestEntries)
      .where(eq(contestEntries.userId, userId))
      .orderBy(desc(contestEntries.createdAt));
  }

  async createContestLineup(lineup: InsertContestLineup): Promise<void> {
    await db.insert(contestLineups).values(lineup);
  }

  async updateContestEntry(entryId: string, updates: Partial<ContestEntry>): Promise<void> {
    await db
      .update(contestEntries)
      .set(updates)
      .where(eq(contestEntries.id, entryId));
  }

  async updateContest(contestId: string, updates: Partial<Contest>): Promise<void> {
    await db
      .update(contests)
      .set(updates)
      .where(eq(contests.id, contestId));
  }

  async getContestLineups(entryId: string): Promise<any[]> {
    return await db
      .select()
      .from(contestLineups)
      .where(eq(contestLineups.entryId, entryId));
  }

  async updateContestLineup(lineupId: string, updates: any): Promise<void> {
    await db
      .update(contestLineups)
      .set(updates)
      .where(eq(contestLineups.id, lineupId));
  }

  async updateContestMetrics(contestId: string, totalShares: number, entryFee: string): Promise<void> {
    // Fetch current contest to calculate new values
    const [current] = await db
      .select()
      .from(contests)
      .where(eq(contests.id, contestId));

    if (!current) return;

    // Calculate new values
    const newEntryCount = current.entryCount + 1;
    const newTotalShares = current.totalSharesEntered + totalShares;
    // Prize pool equals total shares (1 share = $1)
    const newPrizePool = newTotalShares;

    // Update with calculated values
    await db
      .update(contests)
      .set({
        entryCount: newEntryCount,
        totalSharesEntered: newTotalShares,
        totalPrizePool: newPrizePool.toFixed(2),
      })
      .where(eq(contests.id, contestId));
  }

  async getContestEntryWithLineup(entryId: string, userId: string): Promise<{ entry: ContestEntry; lineup: any[] } | null> {
    const [entry] = await db
      .select()
      .from(contestEntries)
      .where(and(eq(contestEntries.id, entryId), eq(contestEntries.userId, userId)));

    if (!entry) return null;

    const lineup = await this.getContestLineups(entryId);
    return { entry, lineup };
  }

  async deleteContestLineup(entryId: string): Promise<void> {
    await db.delete(contestLineups).where(eq(contestLineups.entryId, entryId));
  }

  async getContestEntryDetail(contestId: string, entryId: string): Promise<any> {
    // Get the entry with user information
    const [entry] = await db
      .select({
        id: contestEntries.id,
        contestId: contestEntries.contestId,
        userId: contestEntries.userId,
        username: users.username,
        totalSharesEntered: contestEntries.totalSharesEntered,
        totalScore: contestEntries.totalScore,
        rank: contestEntries.rank,
        payout: contestEntries.payout,
        createdAt: contestEntries.createdAt,
      })
      .from(contestEntries)
      .innerJoin(users, eq(contestEntries.userId, users.id))
      .where(and(
        eq(contestEntries.id, entryId),
        eq(contestEntries.contestId, contestId)
      ));

    if (!entry) {
      return null;
    }

    // Get contest details for entry fee
    const contest = await this.getContest(contestId);
    if (!contest) {
      return null;
    }

    // Only show lineups after contest locks (status is "live" or "completed")
    // Before that, return empty lineup to hide other users' entries
    let lineupWithPercentages: any[] = [];

    if (contest.status === "live" || contest.status === "completed") {
      // Get the lineup with player details
      const lineup = await db
        .select({
          id: contestLineups.id,
          playerId: contestLineups.playerId,
          playerFirstName: players.firstName,
          playerLastName: players.lastName,
          playerTeam: players.team,
          playerPosition: players.position,
          sharesEntered: contestLineups.sharesEntered,
          fantasyPoints: contestLineups.fantasyPoints,
          earnedScore: contestLineups.earnedScore,
        })
        .from(contestLineups)
        .innerJoin(players, eq(contestLineups.playerId, players.id))
        .where(eq(contestLineups.entryId, entryId));

      // For each player, calculate percentage of total shares entered for that player in this contest
      lineupWithPercentages = await Promise.all(
        lineup.map(async (lineupItem) => {
          // Sum all shares entered for this player across all entries in the contest
          const [totalSharesResult] = await db
            .select({
              totalShares: sql<number>`CAST(COALESCE(SUM(${contestLineups.sharesEntered}), 0) AS INTEGER)`,
            })
            .from(contestLineups)
            .leftJoin(contestEntries, eq(contestLineups.entryId, contestEntries.id))
            .where(and(
              eq(contestEntries.contestId, contestId),
              eq(contestLineups.playerId, lineupItem.playerId)
            ));

          const totalPlayerShares = totalSharesResult?.totalShares || 0;
          const percentage = totalPlayerShares > 0
            ? ((lineupItem.sharesEntered / totalPlayerShares) * 100).toFixed(2)
            : "0.00";

          return {
            ...lineupItem,
            totalPlayerSharesInContest: totalPlayerShares,
            ownershipPercentage: percentage,
          };
        })
      );
    }

    // Net winnings equals payout (no entry fees in this system)
    const payout = parseFloat(entry.payout);

    return {
      entry: {
        ...entry,
        netWinnings: payout.toFixed(2),
      },
      lineup: lineupWithPercentages,
      contest: {
        id: contest.id,
        name: contest.name,
        status: contest.status,
        totalPrizePool: contest.totalPrizePool,
      },
    };
  }

  // Daily games methods
  async upsertDailyGame(game: InsertDailyGame): Promise<DailyGame> {
    const [existing] = await db
      .select()
      .from(dailyGames)
      .where(eq(dailyGames.gameId, game.gameId));

    if (existing) {
      const [updated] = await db
        .update(dailyGames)
        .set({ ...game, lastFetchedAt: new Date() })
        .where(eq(dailyGames.gameId, game.gameId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(dailyGames)
        .values(game)
        .returning();
      return created;
    }
  }

  async getDailyGames(startDate: Date, endDate: Date, sport?: string): Promise<DailyGame[]> {
    const conditions = [
      sql`${dailyGames.startTime} >= ${startDate}`,
      sql`${dailyGames.startTime} < ${endDate}`
    ];

    if (sport && sport.toUpperCase() !== "ALL") {
      conditions.push(sql`UPPER(${dailyGames.sport}) = ${sport.toUpperCase()}`);
    }

    return await db
      .select()
      .from(dailyGames)
      .where(and(...conditions))
      .orderBy(asc(dailyGames.startTime));
  }

  async updateDailyGameStatus(gameId: string, status: string): Promise<void> {
    await db
      .update(dailyGames)
      .set({ status, lastFetchedAt: new Date() })
      .where(eq(dailyGames.gameId, gameId));
  }

  async updateDailyGameScore(gameId: string, homeScore: number, awayScore: number, status: string): Promise<void> {
    await db
      .update(dailyGames)
      .set({
        homeScore,
        awayScore,
        status,
        lastFetchedAt: new Date()
      })
      .where(eq(dailyGames.gameId, gameId));
  }

  async getGamesByTeam(teamAbbreviation: string, startDate: Date, endDate: Date): Promise<DailyGame[]> {
    return await db
      .select()
      .from(dailyGames)
      .where(
        and(
          sql`${dailyGames.startTime} >= ${startDate}`,
          sql`${dailyGames.startTime} < ${endDate}`,
          sql`(${dailyGames.homeTeam} = ${teamAbbreviation} OR ${dailyGames.awayTeam} = ${teamAbbreviation})`
        )
      )
      .orderBy(asc(dailyGames.startTime));
  }

  async getDailyGamesBySport(sport: string, startDate: Date, endDate: Date): Promise<DailyGame[]> {
    const conditions = [
      sql`${dailyGames.startTime} >= ${startDate}`,
      sql`${dailyGames.startTime} < ${endDate}`
    ];

    // Only filter by sport if not "ALL" (case-insensitive)
    if (sport.toUpperCase() !== "ALL") {
      conditions.push(sql`UPPER(${dailyGames.sport}) = ${sport.toUpperCase()}`);
    }

    // Deduplicate by homeTeam, awayTeam, and startTime (within 5 min tolerance)
    // This handles legacy MySportsFeeds records (gameId starting with 18447) coexisting
    // with BallDontLie records (6-digit gameIds) for the same games
    return await db
      .select()
      .from(dailyGames)
      .where(and(...conditions))
      .orderBy(asc(dailyGames.startTime), asc(dailyGames.gameId)) // Prefer shorter BDL gameIds
      .then(games => {
        const seen = new Map<string, DailyGame>();
        for (const game of games) {
          // Create a dedupe key using teams and startTime rounded to 5-min intervals
          const gameTime = new Date(game.startTime);
          const roundedTime = new Date(Math.round(gameTime.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000));
          const key = `${game.homeTeam}-${game.awayTeam}-${roundedTime.toISOString()}`;
          if (!seen.has(key)) {
            seen.set(key, game);
          }
        }
        return Array.from(seen.values()).sort((a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
      });
  }

  async getDailyGameByGameId(gameId: string): Promise<DailyGame | undefined> {
    const [game] = await db
      .select()
      .from(dailyGames)
      .where(eq(dailyGames.gameId, gameId));
    return game || undefined;
  }

  async createDailyGame(game: InsertDailyGame): Promise<DailyGame> {
    const [created] = await db
      .insert(dailyGames)
      .values(game)
      .returning();
    return created;
  }

  async updateDailyGame(id: string, updates: Partial<InsertDailyGame>): Promise<void> {
    await db
      .update(dailyGames)
      .set({
        ...updates,
        lastFetchedAt: new Date(),
      })
      .where(eq(dailyGames.id, id));
  }

  // Job execution log methods
  async createJobLog(log: InsertJobExecutionLog): Promise<JobExecutionLog> {
    const [created] = await db
      .insert(jobExecutionLogs)
      .values(log)
      .returning();
    return created;
  }

  async updateJobLog(id: string, updates: Partial<JobExecutionLog>): Promise<void> {
    await db
      .update(jobExecutionLogs)
      .set(updates)
      .where(eq(jobExecutionLogs.id, id));
  }

  async getRecentJobLogs(jobName?: string, limit: number = 50): Promise<JobExecutionLog[]> {
    let query = db.select().from(jobExecutionLogs).$dynamic();

    if (jobName) {
      query = query.where(eq(jobExecutionLogs.jobName, jobName));
    }

    return await query
      .orderBy(desc(jobExecutionLogs.scheduledFor))
      .limit(limit);
  }

  async getLatestJobLogPerType(jobNames: string[]): Promise<Map<string, JobExecutionLog>> {
    const result = new Map<string, JobExecutionLog>();

    // Query the latest log for each job type in parallel
    const promises = jobNames.map(async (jobName) => {
      const [log] = await db
        .select()
        .from(jobExecutionLogs)
        .where(eq(jobExecutionLogs.jobName, jobName))
        .orderBy(desc(jobExecutionLogs.scheduledFor))
        .limit(1);
      return { jobName, log };
    });

    const logs = await Promise.all(promises);
    for (const { jobName, log } of logs) {
      if (log) {
        result.set(jobName, log);
      }
    }

    return result;
  }

  // Player game stats methods
  async upsertPlayerGameStats(stats: InsertPlayerGameStats): Promise<PlayerGameStats> {
    const [existing] = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.playerId, stats.playerId),
          eq(playerGameStats.gameId, stats.gameId)
        )
      );

    if (existing) {
      const [updated] = await db
        .update(playerGameStats)
        .set({ ...stats, lastFetchedAt: new Date() })
        .where(eq(playerGameStats.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(playerGameStats)
        .values(stats)
        .returning();
      return created;
    }
  }

  async getPlayerGameStats(playerId: string, gameId: string): Promise<PlayerGameStats | undefined> {
    const [stats] = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.playerId, playerId),
          eq(playerGameStats.gameId, gameId)
        )
      );
    return stats || undefined;
  }

  async getAllPlayerGameStats(playerId: string): Promise<PlayerGameStats[]> {
    return await db
      .select()
      .from(playerGameStats)
      .where(eq(playerGameStats.playerId, playerId))
      .orderBy(desc(playerGameStats.gameDate));
  }

  async getGameStatsByGameId(gameId: string): Promise<PlayerGameStats[]> {
    return await db
      .select()
      .from(playerGameStats)
      .where(eq(playerGameStats.gameId, gameId));
  }

  async getPlayerGameStatsByGameAndHomeAway(
    gameId: string,
    homeAway: "home" | "away"
  ): Promise<PlayerGameStats[]> {
    return await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.gameId, gameId),
          eq(playerGameStats.homeAway, homeAway)
        )
      );
  }

  async getGameLogsCountForDate(dateStr: string, season: string): Promise<number> {
    // Count how many game logs exist for a specific date and season
    const startOfDay = new Date(dateStr);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.season, season),
          gte(playerGameStats.gameDate, startOfDay),
          lte(playerGameStats.gameDate, endOfDay)
        )
      );

    return result[0]?.count || 0;
  }

  async getPlayerSeasonStatsFromLogs(playerId: string): Promise<any | null> {
    // Filter by current competitive season (regular + playoffs combined for rolling average)
    const currentSeasons = getCurrentCompetitiveSeasons();

    const gameLogs = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.playerId, playerId),
          inArray(playerGameStats.season, currentSeasons)
        )
      )
      .orderBy(desc(playerGameStats.gameDate));

    if (gameLogs.length === 0) {
      return null;
    }

    const gamesPlayed = gameLogs.length;

    // Sum all stats
    let totalFantasyPoints = 0;
    let totalPoints = 0;
    let totalRebounds = 0;
    let totalAssists = 0;
    let totalSteals = 0;
    let totalBlocks = 0;
    let totalMinutes = 0;
    let totalFieldGoalsMade = 0;
    let totalFieldGoalsAttempted = 0;
    let totalThreePointersMade = 0;
    let totalThreePointersAttempted = 0;
    let totalFreeThrowsMade = 0;
    let totalFreeThrowsAttempted = 0;

    // Check sport from first log (assuming consistent sport per player)
    const sport = gameLogs[0].sport;

    if (sport === 'NFL') {
      let totalPassingYards = 0;
      let totalPassingTouchdowns = 0;
      let totalPassingInterceptions = 0;
      let totalRushingYards = 0;
      let totalRushingTouchdowns = 0;
      let totalReceivingYards = 0;
      let totalReceivingTouchdowns = 0;
      let totalReceptions = 0;

      for (const log of gameLogs) {
        // NFL stats are stored in statsJson
        const stats = log.statsJson as Record<string, any> || {};
        totalFantasyPoints += parseFloat(log.fantasyPoints);

        totalPassingYards += Number(stats.passing_yards || 0);
        totalPassingTouchdowns += Number(stats.passing_touchdowns || 0);
        totalPassingInterceptions += Number(stats.passing_interceptions || 0);
        totalRushingYards += Number(stats.rushing_yards || 0);
        totalRushingTouchdowns += Number(stats.rushing_touchdowns || 0);
        totalReceivingYards += Number(stats.receiving_yards || 0);
        totalReceivingTouchdowns += Number(stats.receiving_touchdowns || 0);
        totalReceptions += Number(stats.receiving_receptions || 0);
      }

      return {
        sport: 'NFL',
        gamesPlayed,
        avgFantasyPointsPerGame: (totalFantasyPoints / gamesPlayed).toFixed(2),
        passingYards: totalPassingYards,
        passingTouchdowns: totalPassingTouchdowns,
        passingInterceptions: totalPassingInterceptions,
        rushingYards: totalRushingYards,
        rushingTouchdowns: totalRushingTouchdowns,
        receivingYards: totalReceivingYards,
        receivingTouchdowns: totalReceivingTouchdowns,
        receptions: totalReceptions,
      };
    } else {
      // NBA Logic (Existing)
      for (const log of gameLogs) {
        totalFantasyPoints += parseFloat(log.fantasyPoints);
        totalPoints += log.points;
        totalRebounds += log.rebounds;
        totalAssists += log.assists;
        totalSteals += log.steals;
        totalBlocks += log.blocks;
        totalMinutes += log.minutes;
        totalFieldGoalsMade += log.fieldGoalsMade || 0;
        totalFieldGoalsAttempted += log.fieldGoalsAttempted || 0;
        totalThreePointersMade += log.threePointersMade || 0;
        totalThreePointersAttempted += log.threePointersAttempted || 0;
        totalFreeThrowsMade += log.freeThrowsMade || 0;
        totalFreeThrowsAttempted += log.freeThrowsAttempted || 0;
      }

      const fieldGoalPct = totalFieldGoalsAttempted > 0
        ? ((totalFieldGoalsMade / totalFieldGoalsAttempted) * 100).toFixed(1)
        : "0.0";
      const threePointPct = totalThreePointersAttempted > 0
        ? ((totalThreePointersMade / totalThreePointersAttempted) * 100).toFixed(1)
        : "0.0";
      const freeThrowPct = totalFreeThrowsAttempted > 0
        ? ((totalFreeThrowsMade / totalFreeThrowsAttempted) * 100).toFixed(1)
        : "0.0";

      return {
        sport: 'NBA',
        gamesPlayed,
        avgFantasyPointsPerGame: (totalFantasyPoints / gamesPlayed).toFixed(2),
        pointsPerGame: (totalPoints / gamesPlayed).toFixed(1),
        reboundsPerGame: (totalRebounds / gamesPlayed).toFixed(1),
        assistsPerGame: (totalAssists / gamesPlayed).toFixed(1),
        fieldGoalPct,
        threePointPct,
        freeThrowPct,
        steals: totalSteals,
        blocks: totalBlocks,
        minutesPerGame: (totalMinutes / gamesPlayed).toFixed(1),
      };
    }
  }

  // Batched version: fetch season stats for multiple players in ONE query
  // This eliminates N+1 query problem (50 players = 1 query instead of 50 queries)
  async getBatchPlayerSeasonStatsFromLogs(playerIds: string[]): Promise<Map<string, {
    gamesPlayed: number;
    avgFantasyPointsPerGame: string;
  }>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    const currentSeasons = getCurrentCompetitiveSeasons();

    // Fetch game logs for ALL players in one query
    const allGameLogs = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          inArray(playerGameStats.playerId, playerIds),
          inArray(playerGameStats.season, currentSeasons)
        )
      );

    // Group logs by player and compute stats
    const statsMap = new Map();

    for (const playerId of playerIds) {
      const playerLogs = allGameLogs.filter(log => log.playerId === playerId);

      if (playerLogs.length === 0) {
        statsMap.set(playerId, {
          gamesPlayed: 0,
          avgFantasyPointsPerGame: "0.0",
        });
        continue;
      }

      const gamesPlayed = playerLogs.length;
      let totalFantasyPoints = 0;

      for (const log of playerLogs) {
        totalFantasyPoints += parseFloat(log.fantasyPoints);
      }

      statsMap.set(playerId, {
        gamesPlayed,
        avgFantasyPointsPerGame: (totalFantasyPoints / gamesPlayed).toFixed(2),
      });
    }

    return statsMap;
  }

  async getPlayerRecentGamesFromLogs(playerId: string, limit: number = 10): Promise<any[]> {
    const gameLogs = await db
      .select()
      .from(playerGameStats)
      .where(eq(playerGameStats.playerId, playerId))
      .orderBy(desc(playerGameStats.gameDate))
      .limit(limit);

    return gameLogs.map(log => ({
      game: {
        id: parseInt(log.gameId),
        date: log.gameDate.toISOString(),
        opponent: log.opponentTeam || "UNK",
        isHome: log.homeAway === "home",
      },
      stats: log.sport === 'NFL' ? {
        // NFL Stats
        passingYards: (log.statsJson as any)?.passing_yards || 0,
        passingTouchdowns: (log.statsJson as any)?.passing_touchdowns || 0,
        rushingYards: (log.statsJson as any)?.rushing_yards || 0,
        rushingTouchdowns: (log.statsJson as any)?.rushing_touchdowns || 0,
        receivingYards: (log.statsJson as any)?.receiving_yards || 0,
        receivingTouchdowns: (log.statsJson as any)?.receiving_touchdowns || 0,
        fantasyPoints: parseFloat(log.fantasyPoints),
      } : {
        // NBA Stats
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
        threePointersMade: log.threePointersMade,
        minutes: log.minutes,
        fantasyPoints: parseFloat(log.fantasyPoints),
      },
      sport: log.sport,
    }));
  }

  // Blog post methods
  async getBlogPosts(options: { limit: number; offset: number; publishedOnly: boolean }): Promise<{ posts: BlogPost[]; total: number }> {
    const { limit, offset, publishedOnly } = options;

    const posts = await db
      .select()
      .from(blogPosts)
      .where(publishedOnly ? isNotNull(blogPosts.publishedAt) : undefined)
      .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count: total }] = await db
      .select({ count: count() })
      .from(blogPosts)
      .where(publishedOnly ? isNotNull(blogPosts.publishedAt) : undefined);

    return { posts, total };
  }

  async getPublishedBlogCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(blogPosts)
      .where(isNotNull(blogPosts.publishedAt));
    return result?.count || 0;
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | undefined> {
    const [post] = await db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.slug, slug));
    return post || undefined;
  }

  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const [created] = await db
      .insert(blogPosts)
      .values(post)
      .returning();
    return created;
  }

  async updateBlogPost(id: string, updates: Partial<BlogPost>): Promise<BlogPost | undefined> {
    const [updated] = await db
      .update(blogPosts)
      .set(updates)
      .where(eq(blogPosts.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteBlogPost(id: string): Promise<void> {
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
  }

  // Portfolio snapshot methods
  async getAllUsersForRanking(): Promise<Array<{ userId: string; balance: string; portfolioValue: number }>> {
    // Optimized: Single SQL query with JOIN and aggregation instead of N+1 queries
    const result = await db
      .select({
        userId: users.id,
        balance: users.balance,
        portfolioValue: sql<string>`
          COALESCE(
            SUM(
              CASE 
                WHEN ${holdings.assetType} = 'player' AND ${players.lastTradePrice} IS NOT NULL
                THEN COALESCE(${holdings.quantity}, 0) * COALESCE(${players.lastTradePrice}, 0)
                ELSE 0
              END
            ),
            0
          )
        `.as('portfolio_value')
      })
      .from(users)
      .leftJoin(holdings, eq(users.id, holdings.userId))
      .leftJoin(
        players,
        and(
          eq(holdings.assetType, sql`'player'`),
          eq(holdings.assetId, players.id)
        )
      )
      .groupBy(users.id, users.balance);

    return result.map(row => ({
      userId: row.userId,
      balance: row.balance,
      portfolioValue: parseFloat(row.portfolioValue || "0"),
    }));
  }

  async getPortfolioSnapshot(userId: string, date: Date): Promise<PortfolioSnapshot | undefined> {
    // Normalize to start of day to handle timezone differences
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

    const [snapshot] = await db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.userId, userId),
          gte(portfolioSnapshots.snapshotDate, startOfDay),
          lte(portfolioSnapshots.snapshotDate, endOfDay)
        )
      )
      .orderBy(desc(portfolioSnapshots.snapshotDate))
      .limit(1);
    return snapshot || undefined;
  }

  async getLatestSnapshotRanks(): Promise<Map<string, { cashRank: number; portfolioRank: number }>> {
    // Get the most recent snapshot date
    const [latestSnapshot] = await db
      .select({ date: portfolioSnapshots.snapshotDate })
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.snapshotDate))
      .limit(1);

    if (!latestSnapshot) {
      return new Map();
    }

    // Get all snapshots from that date
    const snapshots = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.snapshotDate, latestSnapshot.date));

    const rankMap = new Map();
    for (const snapshot of snapshots) {
      rankMap.set(snapshot.userId, {
        cashRank: snapshot.cashRank,
        portfolioRank: snapshot.portfolioRank,
      });
    }

    return rankMap;
  }

  async getPortfolioSnapshotsInRange(userId: string, startDate: Date, endDate: Date): Promise<PortfolioSnapshot[]> {
    const snapshots = await db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.userId, userId),
          gte(portfolioSnapshots.snapshotDate, startDate),
          lte(portfolioSnapshots.snapshotDate, endDate)
        )
      )
      .orderBy(asc(portfolioSnapshots.snapshotDate));
    return snapshots;
  }

  async createPortfolioSnapshot(snapshot: InsertPortfolioSnapshot): Promise<PortfolioSnapshot> {
    const [created] = await db
      .insert(portfolioSnapshots)
      .values(snapshot)
      .returning();
    return created;
  }

  // Analytics methods
  async getMarketHealthStats(startDate: Date, endDate: Date): Promise<{
    transactionCount: number;
    totalVolume: number;
    totalMarketCap: number;
    prevTransactionCount: number;
    prevTotalVolume: number;
    prevTotalMarketCap: number;
  }> {
    // Calculate the previous period (same length as current period)
    const periodMs = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodMs);
    const prevEndDate = startDate;

    // Current period trades
    const currentTrades = await db
      .select({
        count: count(),
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as('volume'),
      })
      .from(trades)
      .where(and(
        gte(trades.executedAt, startDate),
        lte(trades.executedAt, endDate)
      ));

    // Previous period trades
    const prevTrades = await db
      .select({
        count: count(),
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as('volume'),
      })
      .from(trades)
      .where(and(
        gte(trades.executedAt, prevStartDate),
        lte(trades.executedAt, prevEndDate)
      ));

    // Total market cap = sum of (all shares held * last trade price)
    const marketCapResult = await db
      .select({
        marketCap: sql<string>`COALESCE(SUM(${holdings.quantity} * COALESCE(${players.lastTradePrice}, ${players.currentPrice})), 0)`.as('market_cap'),
      })
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(eq(holdings.assetType, 'player'));

    return {
      transactionCount: currentTrades[0]?.count || 0,
      totalVolume: parseFloat(currentTrades[0]?.volume || "0"),
      totalMarketCap: parseFloat(marketCapResult[0]?.marketCap || "0"),
      prevTransactionCount: prevTrades[0]?.count || 0,
      prevTotalVolume: parseFloat(prevTrades[0]?.volume || "0"),
      prevTotalMarketCap: parseFloat(marketCapResult[0]?.marketCap || "0"), // Same as current (no historical tracking)
    };
  }

  async getMarketHealthTimeSeries(startDate: Date, endDate: Date): Promise<Array<{
    date: string;
    transactions: number;
    volume: number;
    marketCap: number;
  }>> {
    // Group trades by day
    const dailyStats = await db
      .select({
        date: sql<string>`DATE(${trades.executedAt})`.as('date'),
        transactions: count(),
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as('volume'),
      })
      .from(trades)
      .where(and(
        gte(trades.executedAt, startDate),
        lte(trades.executedAt, endDate)
      ))
      .groupBy(sql`DATE(${trades.executedAt})`)
      .orderBy(sql`DATE(${trades.executedAt})`);

    // Get current market cap (we don't have historical snapshots yet)
    const marketCapResult = await db
      .select({
        marketCap: sql<string>`COALESCE(SUM(${holdings.quantity} * COALESCE(${players.lastTradePrice}, ${players.currentPrice})), 0)`.as('market_cap'),
      })
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(eq(holdings.assetType, 'player'));

    const currentMarketCap = parseFloat(marketCapResult[0]?.marketCap || "0");

    return dailyStats.map(row => ({
      date: row.date,
      transactions: row.transactions,
      volume: parseFloat(row.volume || "0"),
      marketCap: currentMarketCap, // Same for all days (no historical tracking)
    }));
  }

  async getPlayerSharesOutstanding(playerIds?: string[]): Promise<Map<string, number>> {
    let query = db
      .select({
        playerId: holdings.assetId,
        totalShares: sql<string>`COALESCE(SUM(${holdings.quantity}), 0)`.as('total_shares'),
      })
      .from(holdings)
      .where(eq(holdings.assetType, 'player'))
      .groupBy(holdings.assetId);

    if (playerIds && playerIds.length > 0) {
      query = db
        .select({
          playerId: holdings.assetId,
          totalShares: sql<string>`COALESCE(SUM(${holdings.quantity}), 0)`.as('total_shares'),
        })
        .from(holdings)
        .where(and(
          eq(holdings.assetType, 'player'),
          inArray(holdings.assetId, playerIds)
        ))
        .groupBy(holdings.assetId);
    }

    const results = await query;
    const sharesMap = new Map<string, number>();
    for (const row of results) {
      sharesMap.set(row.playerId, parseInt(row.totalShares) || 0);
    }
    return sharesMap;
  }

  async getContestUsageStats(playerIds?: string[]): Promise<Map<string, { timesUsed: number; totalEntries: number; usagePercent: number }>> {
    // Get total contest entries
    const totalEntriesResult = await db
      .select({ count: count() })
      .from(contestEntries);
    const totalEntries = totalEntriesResult[0]?.count || 0;

    // Get player usage counts
    const usageQuery = playerIds && playerIds.length > 0
      ? db
        .select({
          playerId: contestLineups.playerId,
          timesUsed: count(),
        })
        .from(contestLineups)
        .where(inArray(contestLineups.playerId, playerIds))
        .groupBy(contestLineups.playerId)
      : db
        .select({
          playerId: contestLineups.playerId,
          timesUsed: count(),
        })
        .from(contestLineups)
        .groupBy(contestLineups.playerId);

    const usageResults = await usageQuery;
    const usageMap = new Map<string, { timesUsed: number; totalEntries: number; usagePercent: number }>();

    for (const row of usageResults) {
      const usagePercent = totalEntries > 0 ? (row.timesUsed / totalEntries) * 100 : 0;
      usageMap.set(row.playerId, {
        timesUsed: row.timesUsed,
        totalEntries,
        usagePercent,
      });
    }

    return usageMap;
  }

  async getPriceHistoryRange(playerIds: string[], startDate: Date, endDate: Date): Promise<Map<string, Array<{ timestamp: Date; price: number }>>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    const history = await db
      .select({
        playerId: priceHistory.playerId,
        timestamp: priceHistory.timestamp,
        price: priceHistory.price,
      })
      .from(priceHistory)
      .where(and(
        inArray(priceHistory.playerId, playerIds),
        gte(priceHistory.timestamp, startDate),
        lte(priceHistory.timestamp, endDate)
      ))
      .orderBy(priceHistory.playerId, priceHistory.timestamp);

    const historyMap = new Map<string, Array<{ timestamp: Date; price: number }>>();

    for (const row of history) {
      if (!historyMap.has(row.playerId)) {
        historyMap.set(row.playerId, []);
      }
      historyMap.get(row.playerId)!.push({
        timestamp: row.timestamp,
        price: parseFloat(row.price),
      });
    }

    return historyMap;
  }

  async getHotColdPlayers(limit: number): Promise<{ hot: Player[]; cold: Player[] }> {
    // Hot players: biggest positive price change
    const hotPlayers = await db
      .select()
      .from(players)
      .where(and(
        eq(players.isActive, true),
        sql`${players.priceChange24h} > 0`
      ))
      .orderBy(desc(players.priceChange24h))
      .limit(limit);

    // Cold players: biggest negative price change
    const coldPlayers = await db
      .select()
      .from(players)
      .where(and(
        eq(players.isActive, true),
        sql`${players.priceChange24h} < 0`
      ))
      .orderBy(asc(players.priceChange24h))
      .limit(limit);

    return { hot: hotPlayers, cold: coldPlayers };
  }

  async getHeatmapData(): Promise<Array<{ team: string; position: string; avgPriceChange: number; playerCount: number; topPlayer: string }>> {
    // Aggregate price changes by team and position
    const heatmapData = await db
      .select({
        team: players.team,
        position: players.position,
        avgPriceChange: sql<string>`AVG(${players.priceChange24h})`.as('avg_price_change'),
        playerCount: count(),
        topPlayer: sql<string>`(
          SELECT CONCAT(p2.first_name, ' ', p2.last_name)
          FROM players p2
          WHERE p2.team = ${players.team} AND p2.position = ${players.position} AND p2.is_active = true
          ORDER BY p2.price_change_24h DESC
          LIMIT 1
        )`.as('top_player'),
      })
      .from(players)
      .where(eq(players.isActive, true))
      .groupBy(players.team, players.position)
      .orderBy(players.team, players.position);

    return heatmapData.map(row => ({
      team: row.team,
      position: row.position,
      avgPriceChange: parseFloat(row.avgPriceChange || "0"),
      playerCount: row.playerCount,
      topPlayer: row.topPlayer || "N/A",
    }));
  }

  async getPowerRankings(limit: number = 50): Promise<Array<{
    playerId: string;
    name: string;
    team: string;
    position: string;
    price: number;
    priceChange7d: number;
    volume: number;
    avgFantasyPoints: number;
    compositeScore: number;
  }>> {
    // Get active players with their stats
    const activePlayers = await db
      .select()
      .from(players)
      .where(eq(players.isActive, true));

    // Get fantasy points averages for each player
    const fantasyStats = await db
      .select({
        playerId: playerGameStats.playerId,
        avgFantasyPoints: sql<string>`AVG(${playerGameStats.fantasyPoints})`.as('avg_fantasy'),
        gamesPlayed: count(),
      })
      .from(playerGameStats)
      .groupBy(playerGameStats.playerId);

    const fantasyMap = new Map<string, { avgFantasy: number; gamesPlayed: number }>();
    for (const stat of fantasyStats) {
      fantasyMap.set(stat.playerId, {
        avgFantasy: parseFloat(stat.avgFantasyPoints || "0"),
        gamesPlayed: stat.gamesPlayed,
      });
    }

    // Calculate composite scores
    // Weights: 40% price momentum, 30% volume, 30% fantasy points
    const rankings = activePlayers.map(player => {
      const fantasyData = fantasyMap.get(player.id) || { avgFantasy: 0, gamesPlayed: 0 };

      // Normalize values (0-100 scale)
      const priceChange = parseFloat(player.priceChange24h || "0");
      const volume = player.volume24h || 0;
      const avgFantasy = fantasyData.avgFantasy;

      // Simple normalization (can be improved with z-scores)
      const priceMomentumScore = Math.min(Math.max((priceChange + 20) / 40 * 100, 0), 100); // -20% to +20% mapped to 0-100
      const volumeScore = Math.min(volume / 100 * 100, 100); // 0-100+ shares mapped to 0-100
      const fantasyScore = Math.min(avgFantasy / 50 * 100, 100); // 0-50 fantasy pts mapped to 0-100

      const compositeScore = (priceMomentumScore * 0.4) + (volumeScore * 0.3) + (fantasyScore * 0.3);

      return {
        playerId: player.id,
        name: `${player.firstName} ${player.lastName}`,
        team: player.team,
        position: player.position,
        price: parseFloat(player.lastTradePrice || player.currentPrice || "0"),
        priceChange7d: priceChange, // Using 24h as proxy for now
        volume,
        avgFantasyPoints: avgFantasy,
        compositeScore,
      };
    });

    // Sort by composite score and return top N
    return rankings
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, limit);
  }

  async getShareEconomyStats(startDate?: Date, endDate?: Date): Promise<{
    totalSharesVested: number;
    totalSharesBurned: number;
    totalSharesInEconomy: number;
    periodsharesVested: number;
    periodSharesBurned: number;
  }> {
    // Total shares vested all time
    const totalVestedResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as('total'),
      })
      .from(vestingClaims);
    const totalSharesVested = parseInt(totalVestedResult[0]?.total || "0");

    // Total shares in economy (all holdings)
    const totalHoldingsResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${holdings.quantity}), 0)`.as('total'),
      })
      .from(holdings)
      .where(eq(holdings.assetType, 'player'));
    const totalSharesInEconomy = parseInt(totalHoldingsResult[0]?.total || "0");

    // Total shares burned = shares used in contest entries where contest has started (live or completed)
    // Shares are only "burned" when the contest actually begins, not when entered
    const totalBurnedResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${contestEntries.totalSharesEntered}), 0)`.as('total'),
      })
      .from(contestEntries)
      .innerJoin(contests, eq(contestEntries.contestId, contests.id))
      .where(sql`${contests.status} IN ('live', 'completed')`);
    const totalSharesBurned = parseInt(totalBurnedResult[0]?.total || "0");

    // Period stats (if dates provided)
    let periodsharesVested = 0;
    let periodSharesBurned = 0;

    if (startDate && endDate) {
      const periodVestedResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as('total'),
        })
        .from(vestingClaims)
        .where(and(
          gte(vestingClaims.claimedAt, startDate),
          lte(vestingClaims.claimedAt, endDate)
        ));
      periodsharesVested = parseInt(periodVestedResult[0]?.total || "0");

      const periodBurnedResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${contestEntries.totalSharesEntered}), 0)`.as('total'),
        })
        .from(contestEntries)
        .innerJoin(contests, eq(contestEntries.contestId, contests.id))
        .where(and(
          gte(contests.startsAt, startDate),
          lte(contests.startsAt, endDate)
        ));
      periodSharesBurned = parseInt(periodBurnedResult[0]?.total || "0");
    }

    return {
      totalSharesVested,
      totalSharesBurned,
      totalSharesInEconomy,
      periodsharesVested,
      periodSharesBurned,
    };
  }

  async getShareEconomyTimeSeries(startDate: Date, endDate: Date): Promise<{
    date: string;
    sharesVested: number;
    sharesBurned: number;
  }[]> {
    // Get shares vested by date
    const vestedByDate = await db
      .select({
        date: sql<string>`DATE(${vestingClaims.claimedAt})`.as('date'),
        shares: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as('shares'),
      })
      .from(vestingClaims)
      .where(and(
        gte(vestingClaims.claimedAt, startDate),
        lte(vestingClaims.claimedAt, endDate)
      ))
      .groupBy(sql`DATE(${vestingClaims.claimedAt})`)
      .orderBy(sql`DATE(${vestingClaims.claimedAt})`);

    // Get shares burned by contest game_date (shares are burned when contest starts, not when entry created)
    // Only count entries from contests that have started (live or completed status)
    const burnedByDate = await db
      .select({
        date: sql<string>`DATE(${contests.gameDate})`.as('date'),
        shares: sql<string>`COALESCE(SUM(${contestEntries.totalSharesEntered}), 0)`.as('shares'),
      })
      .from(contestEntries)
      .innerJoin(contests, eq(contestEntries.contestId, contests.id))
      .where(and(
        gte(contests.gameDate, startDate),
        lte(contests.gameDate, endDate),
        sql`${contests.status} IN ('live', 'completed')`
      ))
      .groupBy(sql`DATE(${contests.gameDate})`)
      .orderBy(sql`DATE(${contests.gameDate})`);

    // Add all vested dates
    const dateMap = new Map<string, { sharesVested: number; sharesBurned: number }>();
    for (const row of vestedByDate) {
      const dateStr = row.date;
      dateMap.set(dateStr, {
        sharesVested: parseInt(row.shares || "0"),
        sharesBurned: 0,
      });
    }

    // Add/merge burned dates
    for (const row of burnedByDate) {
      const dateStr = row.date;
      const existing = dateMap.get(dateStr) || { sharesVested: 0, sharesBurned: 0 };
      existing.sharesBurned = parseInt(row.shares || "0");
      dateMap.set(dateStr, existing);
    }

    // Sort by date and convert to array
    const sortedDates = Array.from(dateMap.keys()).sort();
    return sortedDates.map(date => ({
      date,
      sharesVested: dateMap.get(date)?.sharesVested || 0,
      sharesBurned: dateMap.get(date)?.sharesBurned || 0,
    }));
  }

  // Premium checkout session methods
  async createPremiumCheckoutSession(session: { userId: string; planId: string; quantity: number; amountCents: number; whopSessionId?: string }): Promise<PremiumCheckoutSession> {
    const [created] = await db
      .insert(premiumCheckoutSessions)
      .values({
        userId: session.userId,
        planId: session.planId,
        quantity: session.quantity,
        amountCents: session.amountCents,
        whopSessionId: session.whopSessionId,
      })
      .returning();
    return created;
  }

  async getPremiumCheckoutSession(id: string): Promise<PremiumCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(premiumCheckoutSessions)
      .where(eq(premiumCheckoutSessions.id, id));
    return session || undefined;
  }

  async getPremiumCheckoutSessionByReceipt(receiptId: string): Promise<PremiumCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(premiumCheckoutSessions)
      .where(eq(premiumCheckoutSessions.receiptId, receiptId));
    return session || undefined;
  }

  async completePremiumCheckoutSession(id: string, receiptId: string): Promise<PremiumCheckoutSession | undefined> {
    const [updated] = await db
      .update(premiumCheckoutSessions)
      .set({
        status: "completed",
        receiptId,
        completedAt: new Date(),
      })
      .where(eq(premiumCheckoutSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async getUserPremiumCheckoutSessions(userId: string): Promise<PremiumCheckoutSession[]> {
    return await db
      .select()
      .from(premiumCheckoutSessions)
      .where(eq(premiumCheckoutSessions.userId, userId))
      .orderBy(desc(premiumCheckoutSessions.createdAt));
  }

  async getPendingPremiumCheckoutSessions(): Promise<PremiumCheckoutSession[]> {
    return await db
      .select()
      .from(premiumCheckoutSessions)
      .where(eq(premiumCheckoutSessions.status, "pending"))
      .orderBy(desc(premiumCheckoutSessions.createdAt));
  }

  // Community checkout session methods
  async createCommunityCheckoutSession(session: { userId: string; planId: string; quantity: number; amountCents: number; whopSessionId?: string }): Promise<CommunityCheckoutSession> {
    const [created] = await db
      .insert(communityCheckoutSessions)
      .values({
        userId: session.userId,
        planId: session.planId,
        quantity: session.quantity,
        amountCents: session.amountCents,
        whopSessionId: session.whopSessionId,
      })
      .returning();
    return created;
  }

  async getCommunityCheckoutSession(id: string): Promise<CommunityCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(communityCheckoutSessions)
      .where(eq(communityCheckoutSessions.id, id));
    return session || undefined;
  }

  async getCommunityCheckoutSessionByReceipt(receiptId: string): Promise<CommunityCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(communityCheckoutSessions)
      .where(eq(communityCheckoutSessions.receiptId, receiptId));
    return session || undefined;
  }

  async completeCommunityCheckoutSession(id: string, receiptId: string): Promise<CommunityCheckoutSession | undefined> {
    const [updated] = await db
      .update(communityCheckoutSessions)
      .set({
        status: "completed",
        receiptId,
        completedAt: new Date(),
      })
      .where(eq(communityCheckoutSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async getUserCommunityCheckoutSessions(userId: string): Promise<CommunityCheckoutSession[]> {
    return await db
      .select()
      .from(communityCheckoutSessions)
      .where(eq(communityCheckoutSessions.userId, userId))
      .orderBy(desc(communityCheckoutSessions.createdAt));
  }

  async getPendingCommunityCheckoutSessions(): Promise<CommunityCheckoutSession[]> {
    return await db
      .select()
      .from(communityCheckoutSessions)
      .where(eq(communityCheckoutSessions.status, "pending"))
      .orderBy(desc(communityCheckoutSessions.createdAt));
  }

  // Premium trading methods - database-backed for persistence
  async getPremiumOrderBook(): Promise<{
    bids: { price: string; quantity: number; userId: string; orderId: string }[];
    asks: { price: string; quantity: number; userId: string; orderId: string }[];
  }> {
    // Get all open or partial orders from database
    const openOrders = await db
      .select()
      .from(premiumOrders)
      .where(or(eq(premiumOrders.status, "open"), eq(premiumOrders.status, "partial")));

    const bids: { price: string; quantity: number; userId: string; orderId: string }[] = [];
    const asks: { price: string; quantity: number; userId: string; orderId: string }[] = [];

    for (const order of openOrders) {
      // Calculate remaining quantity
      const remainingQty = order.quantity - (order.filledQuantity || 0);
      if (remainingQty <= 0) continue;

      const orderData = {
        price: order.limitPrice || "5.00",
        quantity: remainingQty,
        userId: order.userId,
        orderId: order.id,
      };

      if (order.side === "buy") {
        bids.push(orderData);
      } else {
        asks.push(orderData);
      }
    }

    // Sort bids high to low, asks low to high
    bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return { bids, asks };
  }

  async getRecentPremiumTrades(limit: number): Promise<Array<{
    buyerId: string;
    sellerId: string;
    quantity: number;
    price: string;
    executedAt: Date;
    buyer: { username: string } | null;
    seller: { username: string } | null;
  }>> {
    const recentTrades = await db
      .select()
      .from(premiumTrades)
      .orderBy(desc(premiumTrades.executedAt))
      .limit(limit);

    // Enrich with usernames
    const enriched = await Promise.all(recentTrades.map(async (trade) => {
      const buyer = await this.getUser(trade.buyerId);
      const seller = await this.getUser(trade.sellerId);
      return {
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        quantity: trade.quantity,
        price: trade.price,
        executedAt: trade.executedAt,
        buyer: buyer ? { username: buyer.username || "Unknown" } : null,
        seller: seller ? { username: seller.username || "Unknown" } : null,
      };
    }));

    return enriched;
  }

  async getPremiumTradesInRange(startDate: Date, endDate: Date): Promise<Array<{
    buyerId: string;
    sellerId: string;
    quantity: number;
    price: string;
    executedAt: Date;
  }>> {
    const trades = await db
      .select()
      .from(premiumTrades)
      .where(and(
        gte(premiumTrades.executedAt, startDate),
        lte(premiumTrades.executedAt, endDate)
      ))
      .orderBy(desc(premiumTrades.executedAt));

    return trades;
  }

  async getTotalPremiumCirculation(): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(quantity), 0)` })
      .from(holdings)
      .where(eq(holdings.assetType, "premium"));

    return result[0]?.total || 0;
  }

  async createPremiumOrder(order: {
    userId: string;
    side: "buy" | "sell";
    quantity: number;
    price: string;
    orderType: string;
    status: string;
  }): Promise<PremiumOrder> {
    const [createdOrder] = await db
      .insert(premiumOrders)
      .values({
        userId: order.userId,
        side: order.side,
        quantity: order.quantity,
        limitPrice: order.price,
        orderType: order.orderType,
        status: order.status,
      })
      .returning();

    return createdOrder;
  }

  async getPremiumOrder(orderId: string): Promise<PremiumOrder | undefined> {
    const [order] = await db
      .select()
      .from(premiumOrders)
      .where(eq(premiumOrders.id, orderId));
    return order || undefined;
  }

  async updatePremiumOrderQuantity(orderId: string, remainingQuantity: number): Promise<void> {
    // remainingQuantity = how many shares are left unfilled in this order
    // Called after a match: newRemainingQty = oldRemainingQty - matchQuantity
    const order = await this.getPremiumOrder(orderId);
    if (!order) return;

    // Calculate how many have been filled: original - remaining
    const newFilledQuantity = order.quantity - remainingQuantity;

    if (remainingQuantity <= 0) {
      // Order is fully filled
      await db
        .update(premiumOrders)
        .set({
          filledQuantity: order.quantity,
          status: "filled"
        })
        .where(eq(premiumOrders.id, orderId));
    } else if (newFilledQuantity > 0) {
      // Order is partially filled
      await db
        .update(premiumOrders)
        .set({
          filledQuantity: newFilledQuantity,
          status: "partial"
        })
        .where(eq(premiumOrders.id, orderId));
    }
  }

  async createPremiumTrade(trade: {
    buyerId: string;
    sellerId: string;
    buyOrderId?: string;
    sellOrderId?: string;
    quantity: number;
    price: string;
  }): Promise<PremiumTrade> {
    const [createdTrade] = await db
      .insert(premiumTrades)
      .values({
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        buyOrderId: trade.buyOrderId,
        sellOrderId: trade.sellOrderId,
        quantity: trade.quantity,
        price: trade.price,
      })
      .returning();

    return createdTrade;
  }

  async getUserPremiumOrders(userId: string): Promise<PremiumOrder[]> {
    return await db
      .select()
      .from(premiumOrders)
      .where(eq(premiumOrders.userId, userId))
      .orderBy(desc(premiumOrders.createdAt));
  }

  async cancelPremiumOrder(orderId: string): Promise<void> {
    await db
      .update(premiumOrders)
      .set({ status: "cancelled" })
      .where(eq(premiumOrders.id, orderId));
  }

  // Whop payment sync methods
  async getWhopPaymentByPaymentId(paymentId: string): Promise<WhopPayment | undefined> {
    const [payment] = await db
      .select()
      .from(whopPayments)
      .where(eq(whopPayments.paymentId, paymentId));
    return payment || undefined;
  }

  async getWhopPaymentsByEmail(email: string): Promise<WhopPayment[]> {
    return await db
      .select()
      .from(whopPayments)
      .where(eq(whopPayments.email, email.toLowerCase()))
      .orderBy(desc(whopPayments.createdAt));
  }

  async getWhopPaymentsByUserId(userId: string): Promise<WhopPayment[]> {
    return await db
      .select()
      .from(whopPayments)
      .where(eq(whopPayments.userId, userId))
      .orderBy(desc(whopPayments.createdAt));
  }

  async getUncreditedWhopPaymentsByEmail(email: string): Promise<WhopPayment[]> {
    return await db
      .select()
      .from(whopPayments)
      .where(and(
        eq(whopPayments.email, email.toLowerCase()),
        eq(whopPayments.whopStatus, "paid"),
        sql`${whopPayments.creditedAt} IS NULL`
      ))
      .orderBy(desc(whopPayments.createdAt));
  }

  async upsertWhopPayment(payment: InsertWhopPayment): Promise<WhopPayment> {
    const [result] = await db
      .insert(whopPayments)
      .values({
        ...payment,
        email: payment.email.toLowerCase(),
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: whopPayments.paymentId,
        set: {
          whopStatus: payment.whopStatus,
          lastSyncedAt: new Date(),
          rawPayload: payment.rawPayload,
        },
      })
      .returning();
    return result;
  }

  async creditWhopPayment(paymentId: string, userId: string): Promise<WhopPayment | undefined> {
    const [updated] = await db
      .update(whopPayments)
      .set({
        userId,
        creditedAt: new Date(),
      })
      .where(and(
        eq(whopPayments.paymentId, paymentId),
        sql`${whopPayments.creditedAt} IS NULL`
      ))
      .returning();
    return updated || undefined;
  }

  async revokeWhopPayment(paymentId: string, revokedQuantity: number, liabilityQuantity?: number): Promise<WhopPayment | undefined> {
    const [updated] = await db
      .update(whopPayments)
      .set({
        revokedAt: new Date(),
        revokedQuantity,
        liabilityQuantity: liabilityQuantity || 0,
      })
      .where(eq(whopPayments.paymentId, paymentId))
      .returning();
    return updated || undefined;
  }

  async updateWhopPaymentStatus(paymentId: string, whopStatus: string): Promise<WhopPayment | undefined> {
    const [updated] = await db
      .update(whopPayments)
      .set({
        whopStatus,
        lastSyncedAt: new Date(),
      })
      .where(eq(whopPayments.paymentId, paymentId))
      .returning();
    return updated || undefined;
  }

  async getPlayerFinancialMetrics(playerId: string): Promise<PlayerFinancialMetrics> {
    // 1. Fetch Player and Average Stats
    const player = await this.getPlayer(playerId);
    if (!player) throw new Error("Player not found");

    const seasonStats = await this.getPlayerSeasonStatsFromLogs(playerId);
    const avgFantasyPoints = seasonStats ? Number(seasonStats.avgFantasyPointsPerGame) : 0;
    const currentPrice = player.lastTradePrice ? Number(player.lastTradePrice) : 0;

    // --- P/E INDEX CALCULATION ---
    // 1. Calculate Player P/E
    // Avoid division by zero: if avg points is 0, P/E is effectively infinite (or 0 for safety)
    const peRatio = avgFantasyPoints > 0 ? currentPrice / avgFantasyPoints : 0;

    // 2. League Average P/E
    // HARDCODED Snapshot from "analyze-market-multipliers.ts" (Median)
    // TODO: Calculate this dynamically by caching a daily league-wide aggregation
    const LEAGUE_AVG_PE = 0.43;

    // 3. Value Index (100 = Fair)
    // If P/E is 0 (no stats), Index is 0 (N/A)
    const valueIndex = LEAGUE_AVG_PE > 0 ? (peRatio / LEAGUE_AVG_PE) * 100 : 0;

    const isUndervalued = valueIndex > 0 && valueIndex < 100;

    // --- SENTIMENT (BUY PRESSURE) ---
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Aggregation of buy vs sell orders in last 24h
    // Note: We use the 'orders' table. Ideally we check 'trades' for actual volume, 
    // but 'orders' shows intent/sentiment even if not filled.
    const recentOrders = await db
      .select({
        side: orders.side,
        quantity: orders.quantity,
      })
      .from(orders)
      .where(and(
        eq(orders.playerId, playerId),
        gte(orders.createdAt, twentyFourHoursAgo)
      ));

    let buyVol = 0;
    let sellVol = 0;

    for (const o of recentOrders) {
      if (o.side === 'buy') buyVol += o.quantity;
      if (o.side === 'sell') sellVol += o.quantity;
    }

    const totalVol = buyVol + sellVol;
    const buyPressure = totalVol > 0 ? (buyVol / totalVol) * 100 : 50; // Default to neutral 50

    let sentimentTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (buyPressure >= 60) sentimentTrend = 'bullish';
    else if (buyPressure <= 40) sentimentTrend = 'bearish';

    // --- HEAT CHECK ---
    const recentGames = await this.getPlayerRecentGamesFromLogs(playerId, 5);
    let l5Avg = 0;
    if (recentGames.length > 0) {
      const sum = recentGames.reduce((acc, g) => acc + Number(g.fantasyPoints), 0);
      l5Avg = sum / recentGames.length;
    }

    let heatStatus: 'fire' | 'ice' | 'neutral' = 'neutral';
    if (avgFantasyPoints > 0) {
      const diff = (l5Avg - avgFantasyPoints) / avgFantasyPoints;
      if (diff >= 0.15) heatStatus = 'fire'; // 15% better than season avg
      else if (diff <= -0.15) heatStatus = 'ice'; // 15% worse
    }

    // --- MARKET CAP RANK ---
    // Simple heuristic for now until we have global rank query
    // Top tier > $100k cap (assuming lots of shares * price)
    // This is a placeholder logic that should eventually be a percentile query
    const totalShares = await this.getTotalSharesForPlayer(playerId);
    const mktCap = totalShares * currentPrice;

    let tier: 'blue_chip' | 'mid_cap' | 'moonshot' = 'mid_cap';
    if (mktCap > 50000) tier = 'blue_chip';
    else if (mktCap < 5000) tier = 'moonshot';

    // Mock percentile for now
    const percentile = 50;

    return {
      peRatio,
      valueIndex,
      isUndervalued,
      sentiment: {
        buyPressure,
        totalVolume24h: totalVol,
        trend: sentimentTrend
      },
      heatCheck: {
        l5Avg,
        seasonAvg: avgFantasyPoints,
        status: heatStatus
      },
      marketCapRank: {
        tier,
        percentile
      }
    };
  }

  async getBatchActiveScoutCounts(playerIds: string[]): Promise<Map<string, number>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    // Only count scouts from users active in the last 24h (matching distribution logic)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await db
      .select({
        playerId: scoutAssignments.playerId,
        count: sql<string>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)`.as('total_scouts'),
      })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(and(
        inArray(scoutAssignments.playerId, playerIds),
        gte(users.lastActiveAt, twentyFourHoursAgo)
      ))
      .groupBy(scoutAssignments.playerId);

    const counts = new Map<string, number>();
    for (const row of results) {
      counts.set(row.playerId, parseInt(row.count) || 0);
    }
    return counts;
  }

  // --- Financial Market Scanners (P/E, Value Index) ---
  // Calculates metrics for active players and returns sorted lists
  async getFinancialMarketScanners(sport: string = "ALL") {
    // 1. Bulk Fetch Player Stats for P/E Calculation
    // If sport is specific, filter by it. If "ALL", fetch all.
    const normalizedSport = sport.toUpperCase();
    const whereClause = normalizedSport === "ALL"
      ? and(isNotNull(players.lastTradePrice), gt(players.lastTradePrice, "0"))
      : and(
        isNotNull(players.lastTradePrice),
        gt(players.lastTradePrice, "0"),
        sql`UPPER(${players.sport}) = ${normalizedSport}`
      );

    const activePlayers = await db
      .select({
        id: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        position: players.position,
        sport: players.sport,
        currentPrice: players.currentPrice,
        lastTradePrice: players.lastTradePrice,
        volume24h: players.volume24h,
        priceChange24h: players.priceChange24h,
        marketCap: players.marketCap,
        avgPoints: sql<string>`AVG(CAST(${playerGameStats.fantasyPoints} AS numeric))`,
      })
      .from(players)
      .leftJoin(playerGameStats, eq(players.id, playerGameStats.playerId))
      .where(whereClause)
      .groupBy(players.id);

    // 2. Bulk Fetch Sentiment (using Postgres-native interval for consistency with getPlayersPaginated)
    const sentimentStats = await db
      .select({
        playerId: orders.playerId,
        buyVol: sql<number>`SUM(CASE WHEN ${orders.side} = 'buy' THEN ${orders.quantity} ELSE 0 END)`,
        totalVol: sql<number>`SUM(${orders.quantity})`,
      })
      .from(orders)
      .where(gte(orders.createdAt, sql`NOW() - INTERVAL '24 hours'`))
      .groupBy(orders.playerId);

    const sentimentMap = new Map(sentimentStats.map(s => [s.playerId, s]));

    // 3. Process Metrics
    const LEAGUE_AVG_PE = 0.43;
    const processed = activePlayers.map(p => {
      const price = parseFloat(p.lastTradePrice as string);
      const avgFP = p.avgPoints ? parseFloat(p.avgPoints) : 0;
      const peRatio = avgFP > 0 ? price / avgFP : 0;
      const valueIndex = LEAGUE_AVG_PE > 0 ? (peRatio / LEAGUE_AVG_PE) * 100 : 0;

      const sent = sentimentMap.get(p.id);
      const buyPressure = sent && sent.totalVol > 0 ? (sent.buyVol / sent.totalVol) * 100 : 50;

      return {
        player: {
          ...p,
          status: "active",
          totalSharesOutstanding: 0,
          totalHolders: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Player,
        metrics: {
          peRatio,
          valueIndex,
          isUndervalued: valueIndex > 0 && valueIndex < 100,
          sentiment: {
            buyPressure,
            totalVolume24h: sent?.totalVol || 0,
            trend: buyPressure >= 60 ? 'bullish' : buyPressure <= 40 ? 'bearish' : 'neutral',
          } as any,
          heatCheck: { status: 'neutral' } as any,
          marketCapRank: { tier: 'mid_cap' } as any
        }
      };
    });

    // 4. Sort and Slice
    const undervalued = processed
      .filter(x => x.metrics.valueIndex > 0 && x.metrics.valueIndex < 100)
      .sort((a, b) => a.metrics.valueIndex - b.metrics.valueIndex)
      .slice(0, 10);

    const premium = processed
      .filter(x => x.metrics.valueIndex > 100)
      .sort((a, b) => b.metrics.valueIndex - a.metrics.valueIndex)
      .slice(0, 10);

    const sentiment = processed
      .filter(x => x.metrics.sentiment.totalVolume24h > 10)
      .sort((a, b) => b.metrics.sentiment.buyPressure - a.metrics.sentiment.buyPressure)
      .slice(0, 10);

    const momentum = processed
      .sort((a, b) => parseFloat(b.player.priceChange24h) - parseFloat(a.player.priceChange24h))
      .slice(0, 10);

    return { undervalued, premium, sentiment, momentum };
  }
  async getTradeHistory(userId: string): Promise<Trade[]> {
    return await db.select().from(trades).where(or(eq(trades.buyerId, userId), eq(trades.sellerId, userId))).orderBy(desc(trades.executedAt)).limit(100);
  }

  async getWatchList(userId: string): Promise<string[]> {
    // Returns all player IDs across all watchlists for the user
    const results = await db.select({ playerId: watchList.playerId }).from(watchList).where(eq(watchList.userId, userId));
    return results.map(r => r.playerId);
  }

  async addToWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void> {
    // If no watchlistId provided, use the default "Favorites" watchlist
    let targetWatchlistId = watchlistId;
    if (!targetWatchlistId) {
      targetWatchlistId = await this.ensureDefaultWatchlist(userId);
    }

    // Check if already in this watchlist to avoid duplicates
    const [exists] = await db.select().from(watchList).where(
      and(eq(watchList.userId, userId), eq(watchList.playerId, playerId), eq(watchList.watchlistId, targetWatchlistId))
    ).limit(1);
    if (exists) return;

    await db.insert(watchList).values({ userId, playerId, watchlistId: targetWatchlistId });
  }

  async removeFromWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void> {
    if (watchlistId) {
      // Remove from specific watchlist
      await db.delete(watchList).where(
        and(eq(watchList.userId, userId), eq(watchList.playerId, playerId), eq(watchList.watchlistId, watchlistId))
      );
    } else {
      // Remove from all watchlists
      await db.delete(watchList).where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId)));
    }
  }

  async isOnWatchList(userId: string, playerId: string): Promise<boolean> {
    const [result] = await db.select().from(watchList).where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId))).limit(1);
    return !!result;
  }

  async getWatchlists(userId: string): Promise<{ id: string; name: string; isDefault: boolean; color: string | null; itemCount: number }[]> {
    const results = await db.select({
      id: watchlists.id,
      name: watchlists.name,
      isDefault: watchlists.isDefault,
      color: watchlists.color,
      itemCount: sql<number>`(SELECT COUNT(*) FROM watch_list WHERE watchlist_id = watchlists.id)`.as('item_count'),
    }).from(watchlists).where(eq(watchlists.userId, userId)).orderBy(desc(watchlists.isDefault), watchlists.name);

    return results;
  }

  async createWatchlist(userId: string, name: string, isDefault?: boolean, color?: string): Promise<{ id: string; name: string }> {
    const [result] = await db.insert(watchlists).values({
      userId,
      name,
      isDefault: isDefault || false,
      color,
    }).returning({ id: watchlists.id, name: watchlists.name });
    return result;
  }

  async updateWatchlist(watchlistId: string, updates: { name?: string; color?: string }): Promise<void> {
    await db.update(watchlists).set(updates).where(eq(watchlists.id, watchlistId));
  }

  async deleteWatchlist(watchlistId: string): Promise<void> {
    // Items will cascade delete due to FK constraint
    await db.delete(watchlists).where(eq(watchlists.id, watchlistId));
  }

  async ensureDefaultWatchlist(userId: string): Promise<string> {
    // Check if user has a default watchlist
    const [existing] = await db.select({ id: watchlists.id }).from(watchlists)
      .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true))).limit(1);

    if (existing) return existing.id;

    // Create default "Favorites" watchlist
    const [created] = await db.insert(watchlists).values({
      userId,
      name: 'Favorites',
      isDefault: true,
    }).returning({ id: watchlists.id });

    return created.id;
  }

  async getWatchlistItems(watchlistId: string): Promise<string[]> {
    const results = await db.select({ playerId: watchList.playerId }).from(watchList)
      .where(eq(watchList.watchlistId, watchlistId));
    return results.map(r => r.playerId);
  }

  async getPlayerWatchlists(userId: string, playerId: string): Promise<string[]> {
    const results = await db.select({ watchlistId: watchList.watchlistId }).from(watchList)
      .where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId)));
    return results.map(r => r.watchlistId).filter((id): id is string => id !== null);
  }

  // Daily Boosts methods
  async getDailyBoosts(userId: string, sport: string, date: Date): Promise<DailyBoost[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db.select().from(dailyBoosts)
      .where(and(
        eq(dailyBoosts.userId, userId),
        eq(dailyBoosts.sport, sport),
        gte(dailyBoosts.boostDate, startOfDay),
        lte(dailyBoosts.boostDate, endOfDay)
      ))
      .orderBy(desc(dailyBoosts.slotTier));
  }

  async getDailyBoostsAllSports(userId: string, date: Date): Promise<DailyBoost[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db.select().from(dailyBoosts)
      .where(and(
        eq(dailyBoosts.userId, userId),
        gte(dailyBoosts.boostDate, startOfDay),
        lte(dailyBoosts.boostDate, endOfDay)
      ))
      .orderBy(desc(dailyBoosts.slotTier));
  }

  async getDailyBoostsByStatus(status: string): Promise<DailyBoost[]> {
    return await db.select().from(dailyBoosts)
      .where(eq(dailyBoosts.status, status));
  }

  async getAllHoldingsWithPlayers(userId: string): Promise<(Holding & { player: Player })[]> {
    // Get all player holdings for user with player info
    const userHoldings = await db.select()
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(and(
        eq(holdings.userId, userId),
        eq(holdings.assetType, "player")
      ));

    return userHoldings.map(h => ({
      ...h.holdings,
      player: h.players,
    }));
  }

  async getEligiblePlayersForBoost(userId: string, sport: string, date: Date): Promise<(Holding & { player: Player; availableShares: number; powerLevel: string; gameId: string | null; gameStartTime: Date | null })[]> {
    // Get holdings for players in the specified sport with games today
    // Use Eastern Time boundaries for consistent game day matching (same as dashboard)
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    // Get user's player holdings with player info
    const userHoldings = await db.select()
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(and(
        eq(holdings.userId, userId),
        eq(holdings.assetType, "player"),
        eq(players.sport, sport)
      ));

    // Get games today for this sport using startTime (consistent with dashboard)
    // The date field stores midnight UTC of the ET game day, but startTime is the
    // authoritative field for all queries (see sync-schedule.ts comment)
    const todaysGames = await db.select()
      .from(dailyGames)
      .where(and(
        eq(dailyGames.sport, sport),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay)
      ));

    // Build a map of team -> game info
    const teamGameMap = new Map<string, { gameId: string; startTime: Date }>();
    for (const game of todaysGames) {
      teamGameMap.set(game.homeTeam, { gameId: game.gameId, startTime: new Date(game.startTime) });
      teamGameMap.set(game.awayTeam, { gameId: game.gameId, startTime: new Date(game.startTime) });
    }

    // For each holding, check if player's team has a game today and calculate available shares
    const result: (Holding & { player: Player; availableShares: number; powerLevel: string; gameId: string | null; gameStartTime: Date | null })[] = [];


    // Get active boosts for this user/sport/date to ensure they show up even if shares are 0
    // Get active boosts for this user/sport/date to ensure they show up even if shares are 0
    const currentBoosts = await this.getDailyBoosts(userId, sport, date);

    const boostedPlayerIds = new Set(currentBoosts.map(b => b.playerId));

    for (const h of userHoldings) {
      const holding = h.holdings;
      const player = h.players;
      const teamGame = teamGameMap.get(player.team);

      if (!teamGame) continue; // Player's team doesn't have a game today

      // Calculate available shares (total - locked)
      const totalLocked = await this.getTotalLockedQuantity(userId, "player", player.id);
      const availableShares = holding.quantity - totalLocked;

      // Get Power Level for this holding (Power Level shares are eligible for boosts)
      const powerLevel = holding.powerLevel || "0.00";

      // Check if player is already boosted today
      const isBoosted = boostedPlayerIds.has(player.id);

      // Player is eligible if they have either:
      // 1. Available raw shares
      // 2. Power Level
      // 3. An active boost for today (so we can show the "Boosted" / "Game Started" status)
      const hasPowerLevel = parseFloat(powerLevel) > 0;

      if (availableShares <= 0 && !hasPowerLevel && !isBoosted) continue;

      result.push({
        ...holding,
        player,
        availableShares,
        powerLevel,
        gameId: teamGame.gameId,
        gameStartTime: teamGame.startTime,
      });
    }

    return result;
  }

  async createDailyBoost(boost: InsertDailyBoost): Promise<DailyBoost> {
    const [created] = await db.insert(dailyBoosts).values(boost).returning();
    return created;
  }

  async updateDailyBoost(boostId: string, updates: Partial<DailyBoost>): Promise<void> {
    await db.update(dailyBoosts)
      .set(updates)
      .where(eq(dailyBoosts.id, boostId));
  }

  async deleteDailyBoost(boostId: string): Promise<void> {
    // First release any locked shares
    await this.unlockBoostShares(boostId);
    // Then delete the boost
    await db.delete(dailyBoosts).where(eq(dailyBoosts.id, boostId));
  }

  async getBoostPayoutHistory(userId: string, limit: number = 50): Promise<BoostPayout[]> {
    return await db.select().from(boostPayouts)
      .where(eq(boostPayouts.userId, userId))
      .orderBy(desc(boostPayouts.createdAt))
      .limit(limit);
  }

  async createBoostPayout(payout: InsertBoostPayout): Promise<BoostPayout> {
    const [created] = await db.insert(boostPayouts).values(payout).returning();
    return created;
  }

  async lockBoostShares(boostId: string): Promise<void> {
    // Get the boost
    const [boost] = await db.select().from(dailyBoosts).where(eq(dailyBoosts.id, boostId));
    if (!boost) throw new Error(`Boost ${boostId} not found`);

    // BURN the shares from user's holdings (not just lock them)
    // This is a core mechanic: boosted shares are consumed for the chance at multiplied payouts
    const holding = await this.getHolding(boost.userId, "player", boost.playerId);
    if (!holding) throw new Error(`No holding found for user ${boost.userId} player ${boost.playerId}`);

    const newQuantity = holding.quantity - boost.sharesEntered;
    if (newQuantity < 0) throw new Error(`Cannot burn ${boost.sharesEntered} shares - only ${holding.quantity} available`);

    // Reduce the holding quantity (burn the shares)
    // Also reduce powerLevel proportionally since power is tied to shares
    const avgCostParsed = parseFloat(holding.avgCostBasis);
    const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
    const totalCost = (parseFloat(avgCostNormalized) * newQuantity).toFixed(2);

    // Calculate power level reduction proportionally
    // powerLevel = quantity * power (per-share power), so reduce both
    const currentPowerLevel = parseFloat(holding.powerLevel || "0");
    const powerPerShare = holding.quantity > 0 ? currentPowerLevel / holding.quantity : 0;
    const newPowerLevel = powerPerShare * newQuantity;

    if (newQuantity <= 0) {
      // Remove holding completely if no shares left
      await db
        .delete(holdings)
        .where(
          and(
            eq(holdings.userId, boost.userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, boost.playerId)
          )
        );
    } else {
      // Update holding with reduced quantity and powerLevel
      await db
        .update(holdings)
        .set({
          quantity: newQuantity,
          powerLevel: newPowerLevel.toFixed(2),
          avgCostBasis: avgCostNormalized,
          totalCostBasis: totalCost,
          lastUpdated: new Date(),
        })
        .where(
          and(
            eq(holdings.userId, boost.userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, boost.playerId)
          )
        );
    }

    console.log(`[BOOST] Burned ${boost.sharesEntered} shares of player ${boost.playerId} from user ${boost.userId} (${holding.quantity} -> ${newQuantity}, powerLevel: ${holding.powerLevel} -> ${newPowerLevel.toFixed(2)})`);

    // Update boost status to locked
    await this.updateDailyBoost(boostId, { status: "locked" });
  }

  async unlockBoostShares(boostId: string): Promise<void> {
    // Release the lock by reference ID
    await this.releaseSharesByReference(boostId);
  }

  /**
   * Ensures a holding has consistent powerLevel = quantity * power.
   * This prevents data drift from operations that modify quantity without updating powerLevel.
   * Also cleans up junk holdings (0 shares but non-zero powerLevel).
   */
  async ensureHoldingConsistency(holdingId: string): Promise<void> {
    const [holding] = await db.select().from(holdings).where(eq(holdings.id, holdingId));
    if (!holding) return;

    // Calculate expected powerLevel
    const expectedPowerLevel = (holding.quantity * holding.power).toFixed(2);
    const actualPowerLevel = parseFloat(holding.powerLevel || "0").toFixed(2);

    // If holding has 0 shares but non-zero powerLevel, remove it (junk data)
    if (holding.quantity === 0 && parseFloat(actualPowerLevel) !== 0) {
      await db.delete(holdings).where(eq(holdings.id, holdingId));
      console.log(`[CONSISTENCY] Removed junk holding ${holdingId} (0 shares, powerLevel: ${actualPowerLevel})`);
      return;
    }

    // If inconsistent and holding has shares, fix it
    if (expectedPowerLevel !== actualPowerLevel && holding.quantity > 0) {
      await db.update(holdings).set({
        powerLevel: expectedPowerLevel,
        lastUpdated: new Date(),
      }).where(eq(holdings.id, holdingId));
      console.log(`[CONSISTENCY] Fixed holding ${holdingId}: ${actualPowerLevel} -> ${expectedPowerLevel} (qty: ${holding.quantity}, power: ${holding.power})`);
    }
  }

  async getPlayerGameForDate(playerId: string, sport: string, date: Date): Promise<DailyGame | undefined> {
    // Get the player's team
    const [player] = await db.select().from(players).where(eq(players.id, playerId));
    if (!player) return undefined;

    // Use ET boundaries for consistent game day matching (same as getEligiblePlayersForBoost)
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    // Find game where player's team is home or away, matching the ET game date
    const [game] = await db.select().from(dailyGames)
      .where(and(
        eq(dailyGames.sport, sport),
        gte(dailyGames.date, startOfDay),
        lt(dailyGames.date, endOfDay),
        or(
          eq(dailyGames.homeTeam, player.team),
          eq(dailyGames.awayTeam, player.team)
        )
      ));

    return game;
  }
  async getCommunityBoostsForDate(sport: string, date: Date): Promise<(CommunityBoost & { creator: User; player: Player })[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const boosts = await db.select({
      boost: communityBoosts,
      creator: users,
      player: players
    })
      .from(communityBoosts)
      .innerJoin(users, eq(communityBoosts.creatorId, users.id))
      .innerJoin(players, eq(communityBoosts.playerId, players.id))
      .where(and(
        eq(communityBoosts.sport, sport),
        gte(communityBoosts.boostDate, startOfDay),
        lte(communityBoosts.boostDate, endOfDay),
        ne(communityBoosts.status, "cancelled")
      ));

    return boosts.map(b => ({
      ...b.boost,
      creator: b.creator,
      player: b.player
    }));
  }

  async getCommunityBoostsAllSports(date: Date): Promise<(CommunityBoost & { creator: User; player: Player })[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const boosts = await db.select({
      boost: communityBoosts,
      creator: users,
      player: players
    })
      .from(communityBoosts)
      .innerJoin(users, eq(communityBoosts.creatorId, users.id))
      .innerJoin(players, eq(communityBoosts.playerId, players.id))
      .where(and(
        gte(communityBoosts.boostDate, startOfDay),
        lte(communityBoosts.boostDate, endOfDay),
        ne(communityBoosts.status, "cancelled")
      ));

    return boosts.map(b => ({
      ...b.boost,
      creator: b.creator,
      player: b.player
    }));
  }

  async createCommunityBoost(boost: InsertCommunityBoost): Promise<CommunityBoost> {
    // 1. Get user's community holdings
    const [communityHolding] = await db.select()
      .from(holdings)
      .where(and(
        eq(holdings.userId, boost.creatorId),
        eq(holdings.assetType, "community")
      ));

    if (!communityHolding || communityHolding.quantity < 1) {
      throw new Error("Insufficient community shares to create community boost");
    }

    // 2. Transact: Deduct share and create boost
    return await db.transaction(async (tx) => {
      // Deduct 1 community share
      await tx.update(holdings)
        .set({
          quantity: sql`${holdings.quantity} - 1`,
          lastUpdated: new Date()
        })
        .where(
          and(
            eq(holdings.userId, boost.creatorId),
            eq(holdings.assetType, "community")
          )
        );

      // Create boost
      const [newBoost] = await tx.insert(communityBoosts)
        .values(boost)
        .returning();

      return newBoost;
    });
  }

  async getCommunityBoostBeneficiaries(playerId: string): Promise<(Holding & { user: User })[]> {
    // Find all users who hold shares of this player (including power-only holders)
    const beneficiaries = await db.select({
      holding: holdings,
      user: users
    })
      .from(holdings)
      .innerJoin(users, eq(holdings.userId, users.id))
      .where(and(
        eq(holdings.assetType, "player"),
        eq(holdings.assetId, playerId),
        or(
          gt(holdings.quantity, 0),
          gt(holdings.powerLevel, "0")
        )
      ));

    return beneficiaries.map(b => ({
      ...b.holding,
      user: b.user
    }));
  }

  async updateCommunityBoost(boostId: string, updates: Partial<CommunityBoost>): Promise<void> {
    await db.update(communityBoosts)
      .set(updates)
      .where(eq(communityBoosts.id, boostId));
  }

  async getCommunityBoostsByStatus(status: string): Promise<CommunityBoost[]> {
    return await db.select()
      .from(communityBoosts)
      .where(eq(communityBoosts.status, status));
  }
  // Scout Status
  async getScoutStatus(userId: string): Promise<{ earnedMinutes: number; nextDistribution: Date; perPlayer: Record<string, number> }> {
    const now = new Date();
    // Calculate last distribution time (Top of Hour XX:00)
    let lastDist = new Date(now);
    lastDist.setMinutes(0);
    lastDist.setSeconds(0);
    lastDist.setMilliseconds(0);

    const nextDistribution = new Date(lastDist);
    nextDistribution.setHours(nextDistribution.getHours() + 1);

    console.log(`[getScoutStatus] User: ${userId}, Window: ${lastDist.toISOString()} to ${now.toISOString()}`);

    try {
      // Calculate earned minutes since last distribution, grouped by player
      // Fetch raw history rows that overlap with the window to calculate in JS (avoids Timezone/SQL calc issues)
      const [history, activeAssignments] = await Promise.all([
        db.select()
          .from(scoutHistory)
          .where(
            and(
              eq(scoutHistory.userId, userId),
              or(isNull(scoutHistory.endedAt), gt(scoutHistory.endedAt, lastDist)),
              lt(scoutHistory.startedAt, now)
            )
          ),
        db.select()
          .from(scoutAssignments)
          .where(eq(scoutAssignments.userId, userId))
      ]);

      const perPlayer: Record<string, number> = {};
      let totalEarnedMinutes = 0;

      // SELF-HEALING: Check for active assignments that don't have an open history record
      // This handles legacy data or cases where history failed to write
      const openHistoryMap = new Set(history.filter(h => !h.endedAt).map(h => h.playerId));

      for (const assignment of activeAssignments) {
        if (assignment.scoutCount > 0 && !openHistoryMap.has(assignment.playerId)) {
          console.log(`[getScoutStatus] Found ghost assignment for player ${assignment.playerId} (Count: ${assignment.scoutCount}). Backfilling...`);
          // Treat as a history row that started at assignment.updatedAt (or lastDist if older)
          // We push it to the history array so the loop below processes it naturally
          // We construct a mock history object compatible with the loop
          history.push({
            id: "ghost",
            userId: assignment.userId,
            playerId: assignment.playerId,
            scoutCount: assignment.scoutCount,
            startedAt: assignment.updatedAt || lastDist, // If Attr missing, assume window start
            endedAt: null
          });
        }
      }

      for (const row of history) {
        // Active window overlap calculation
        // Ensure dates are Date objects to prevent runtime errors if driver returns strings
        let rowStart = new Date(row.startedAt);
        if (isNaN(rowStart.getTime())) rowStart = lastDist; // Fallback

        const start = rowStart < lastDist ? lastDist : rowStart;

        // If endedAt is null, it's still active -> use NOW. If endedAt > NOW (future?), use NOW.
        let rowEnd = row.endedAt ? new Date(row.endedAt) : now;
        if (rowEnd > now) rowEnd = now;

        const end = rowEnd;

        // Ensure both are valid Dates before math
        const durationMs = end.getTime() - start.getTime();

        if (durationMs > 0) {
          // Minutes = Duration in minutes * Scout Count
          const minutes = (durationMs / 1000.0 / 60.0) * row.scoutCount;
          const rounded = Math.floor(minutes * 100) / 100;

          if (rounded > 0) {
            perPlayer[row.playerId] = (perPlayer[row.playerId] || 0) + rounded;
            totalEarnedMinutes += rounded;
          }
        }
      }

      // Final rounding pass to ensure clean 2 decimal places
      Object.keys(perPlayer).forEach(k => {
        perPlayer[k] = Math.floor(perPlayer[k] * 100) / 100;
      });
      totalEarnedMinutes = Math.floor(totalEarnedMinutes * 100) / 100;

      // Log for debugging
      console.log(`[getScoutStatus] Calculated ${totalEarnedMinutes} min for user ${userId} across ${history.length} history rows.`);

      return {
        earnedMinutes: Math.floor(totalEarnedMinutes * 100) / 100,
        perPlayer, // Return the breakdown
        nextDistribution
      };
    } catch (err: any) {
      console.error("[getScoutStatus] Query failed:", err.message);
      throw err;
    }
  }

  // Power Level / Condense methods
  // Condenses raw shares into Power Level at 5:1 ratio
  // Power Level shares are used for Daily Boosts and do NOT earn scout dividends
  // Creates a separate holding row for powered shares (power=5)
  async condenseShares(userId: string, playerId: string, rawShareCount: number): Promise<{ newPowerLevel: string; sharesCondensed: number; poweredSharesCreated: number }> {
    // Validate input
    if (rawShareCount < 5) {
      throw new Error("Minimum 5 shares required to condense");
    }
    if (rawShareCount % 5 !== 0) {
      throw new Error("Share count must be divisible by 5");
    }

    // Calculate power gained (5:1 ratio)
    const powerGained = rawShareCount / 5;

    return await db.transaction(async (tx) => {
      // Get regular holding (power=1)
      const [regularHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
            eq(holdings.power, 1)
          )
        )
        .for("update");

      if (!regularHolding) {
        throw new Error("No regular shares found to condense");
      }

      // Check available shares (quantity minus locked)
      const [lockedResult] = await tx
        .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
        .from(holdingsLocks)
        .where(
          and(
            eq(holdingsLocks.userId, userId),
            eq(holdingsLocks.assetType, "player"),
            eq(holdingsLocks.assetId, playerId)
          )
        );
      const lockedShares = Number(lockedResult?.total || 0);
      const availableShares = regularHolding.quantity - lockedShares;

      if (availableShares < rawShareCount) {
        throw new Error(`Only ${availableShares} shares available (${lockedShares} locked)`);
      }

      // Calculate new regular quantity
      const newRegularQuantity = regularHolding.quantity - rawShareCount;

      // Update or remove regular holding
      if (newRegularQuantity <= 0) {
        await tx
          .delete(holdings)
          .where(eq(holdings.id, regularHolding.id));
      } else {
        await tx
          .update(holdings)
          .set({
            quantity: newRegularQuantity,
            // powerLevel = quantity * power = newRegularQuantity * 1 = newRegularQuantity
            powerLevel: newRegularQuantity.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, regularHolding.id));
      }

      // Find existing powered holding (power > 1)
      const poweredHoldings = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
            sql`${holdings.power} > 1`
          )
        );

      if (poweredHoldings.length > 0) {
        // Add power to existing powered holding
        const existingPowered = poweredHoldings[0];
        const newPower = parseFloat(existingPowered.powerLevel || "0") + powerGained;
        await tx
          .update(holdings)
          .set({
            powerLevel: newPower.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingPowered.id));
      } else {
        // Create new powered holding with single share at gained power
        await tx
          .insert(holdings)
          .values({
            userId,
            assetType: "player",
            assetId: playerId,
            quantity: 1,
            power: powerGained, // The single share has power = rawShareCount / 5
            powerLevel: powerGained.toFixed(2), // powerLevel = power * quantity = powerGained * 1
            avgCostBasis: regularHolding.avgCostBasis,
            totalCostBasis: (powerGained * parseFloat(regularHolding.avgCostBasis)).toFixed(2),
            lastUpdated: new Date(),
          });
      }

      console.log(`[condenseShares] User ${userId} condensed ${rawShareCount} shares of ${playerId} into 1 powered share with ${powerGained.toFixed(2)} power`);

      return {
        newPowerLevel: powerGained.toFixed(2),
        sharesCondensed: rawShareCount,
        poweredSharesCreated: 1,
      };
    });
  }

  // Get all holdings for a player with power level breakdown
  async getHoldingsWithPowerBreakdown(userId: string, playerId: string): Promise<{
    regular: typeof holdings.$inferSelect | null;
    powered: typeof holdings.$inferSelect[];
  }> {
    const allHoldings = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        )
      );

    const regular = allHoldings.find(h => h.power === 1) || null;
    const powered = allHoldings.filter(h => h.power > 1);

    return { regular, powered };
  }

  // Get total power level for a player (sum of all powered shares)
  async getTotalPowerLevel(userId: string, playerId: string): Promise<number> {
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(${holdings.quantity} * ${holdings.power}), 0)` })
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        )
      );
    return Number(result?.total || 0);
  }

  // Get holding with power level information for a specific player
  async getHoldingWithPowerLevel(userId: string, playerId: string): Promise<{ quantity: number; powerLevel: string; availableShares: number } | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId)
        )
      );

    if (!holding) return undefined;

    // Calculate available shares (quantity minus locked)
    const [lockedResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
      .from(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.userId, userId),
          eq(holdingsLocks.assetType, "player"),
          eq(holdingsLocks.assetId, playerId)
        )
      );
    const lockedShares = Number(lockedResult?.total || 0);

    return {
      quantity: holding.quantity,
      powerLevel: holding.powerLevel || "0.00",
      availableShares: holding.quantity - lockedShares,
    };
  }
}

export const storage = new DatabaseStorage();
