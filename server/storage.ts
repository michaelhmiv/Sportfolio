import {
  users,
  players,
  playerMarketMetrics,
  holdings,
  playerMultipliers,
  playerMultiplierEvents,
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
  playerGameStats,
  priceHistory,
  dailyGames,
  jobExecutionLogs,
  blogPosts,
  portfolioSnapshots,
  marketSnapshots,
  premiumCheckoutSessions,
  premiumOrders,
  premiumTrades,
  whopPayments,
  watchlists,
  watchList,
  dailyBoosts,
  boostPayouts,
  sharePayouts,
  communityBoosts,
  communityCheckoutSessions,
  playerPools,
  lpPositions,
  lpTransactions,
  userApiTokens,
  type User,
  type InsertUser,
  type InsertUserApiToken,
  type UpsertUser,
  type Player,
  type InsertPlayer,
  type Holding,
  type PlayerMultiplier,
  type HoldingsLock,
  type InsertHoldingsLock,
  type InsertPlayerMultiplierEvent,
  type BalanceLock,
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
  type SharePayout,
  type InsertSharePayout,
  type CommunityBoost,
  type InsertCommunityBoost,
  type CommunityCheckoutSession,
  type UserApiToken,
} from "@shared/schema";
import { db } from "./db";
import {
  eq,
  and,
  desc,
  asc,
  sql,
  inArray,
  or,
  gte,
  lte,
  isNotNull,
  count,
  gt,
  lt,
  isNull,
  ne,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";
import { getETDayBoundaries, getGameDay } from "./lib/time";
import { choosePreferredDailyGame } from "./lib/daily-game-dedupe";
import { getCurrentCompetitiveSeasons } from "./storage/season-utils";

export interface PlayerFinancialMetrics {
  peRatio: number;
  valueIndex: number; // 100 = Fair. <100 = Undervalued. >100 = Premium.
  isUndervalued: boolean; // Computed helper (valueIndex < 100)
  sentiment: {
    buyPressure: number; // 0-100
    totalVolume24h: number;
    trend: "bullish" | "bearish" | "neutral";
  };
  heatCheck: {
    l5Avg: number;
    seasonAvg: number;
    status: "fire" | "ice" | "neutral"; // >15% above, >15% below
  };
  marketCapRank: {
    tier: "blue_chip" | "mid_cap" | "moonshot"; // Top 10%, Mid, Bottom 50%
    percentile: number;
  };
}

export interface HoldingSummary extends Holding {
  effectiveShares: string;
  multiplier: string;
  isStackedShare: boolean;
}

export interface HoldingWithPlayerSummary extends HoldingSummary {
  player: Player;
}

export interface BoostEligibleHolding extends HoldingWithPlayerSummary {
  availableShares: number;
  gameId: string | null;
  gameStartTime: Date | null;
}

export interface HoldingMultiplierState {
  quantity: number;
  availableShares: number;
  effectiveShares: number;
  multiplier: string;
  hasStackedShare: boolean;
  canStackShares: boolean;
  maxStackable: number;
  tradeableShares: number;
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsersForRanking(): Promise<
    Array<{ userId: string; balance: string; portfolioValue: number }>
  >;
  getUserTradingVolumeSince(startDate: Date): Promise<Map<string, number>>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserBalance(userId: string, amount: string): Promise<void>;
  updateUsername(userId: string, username: string): Promise<User | undefined>;
  updateProfileImage(userId: string, imageUrl: string): Promise<User | undefined>;
  incrementTotalSharesVested(userId: string, amount: number): Promise<void>;
  markOnboardingComplete(userId: string): Promise<void>;
  updateUserPremiumStatus(
    userId: string,
    isPremium: boolean,
    premiumExpiresAt: Date | null,
  ): Promise<void>;
  listUserApiTokens(userId: string): Promise<UserApiToken[]>;
  createUserApiToken(token: InsertUserApiToken): Promise<UserApiToken>;
  getUserApiTokenByHash(tokenHash: string): Promise<UserApiToken | undefined>;
  markUserApiTokenUsed(tokenId: string): Promise<void>;
  revokeUserApiToken(userId: string, tokenId: string): Promise<boolean>;

  // Player methods
  getPlayers(filters?: { search?: string; team?: string; position?: string }): Promise<Player[]>;
  getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
    offset?: number;
    sortBy?:
      | "price"
      | "volume"
      | "change"
      | "tvl"
      | "marketCap"
      | "sentiment"
      | "undervalued"
      | "fantasyPoints"
      | "name"
      | "team";
    sortOrder?: "asc" | "desc";
    teamsPlayingOnDate?: string[];
    watchlistUserId?: string;
    watchlistId?: string;
  }): Promise<{ players: Player[]; total: number }>;
  refreshPlayerMarketMetrics(playerIds?: string[]): Promise<number>;
  refreshPlayerVolume24h(): Promise<number>;
  getPlayer(id: string): Promise<Player | undefined>;
  getPlayersByIds(ids: string[]): Promise<Player[]>;
  getPlayersBySport(sport: string): Promise<Player[]>;
  getTopPlayersByVolume(limit: number): Promise<Player[]>;
  getPlayerPoolsByPlayerIds(playerIds: string[]): Promise<any[]>;
  upsertPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(playerId: string, updates: Partial<InsertPlayer>): Promise<void>;
  getDistinctTeams(): Promise<string[]>;
  getDistinctTeamsBySport(sport: string): Promise<string[]>;

  // Holdings methods
  getHolding(userId: string, assetType: string, assetId: string): Promise<Holding | undefined>;
  getRegularHolding(
    userId: string,
    assetType: string,
    assetId: string,
  ): Promise<Holding | undefined>;
  getUserHoldings(userId: string): Promise<HoldingSummary[]>;
  getUserHoldingsWithPlayers(userId: string): Promise<any[]>;
  updateHolding(
    userId: string,
    assetType: string,
    assetId: string,
    quantity: number,
    avgCost: string,
  ): Promise<void>;
  getPlayerShareBreakdown(
    userId: string,
    playerId: string,
  ): Promise<{ regular: Holding | null; stacked: HoldingSummary[] }>;
  getTotalEffectiveShares(userId: string, playerId: string): Promise<number>;
  getUserCommunityBoostShares(userId: string): Promise<number>;

  // Batch sentiment logic
  getBatchSentiment(
    playerIds: string[],
  ): Promise<Map<string, { buyPressure: number; totalVolume24h: number }>>;

  getBatchAllTimeAvgFantasyPoints(playerIds: string[]): Promise<Map<string, number>>;

  // Batch pool data for AMM liquidity
  getBatchPoolData(
    playerIds: string[],
  ): Promise<
    Map<string, { shares: number; playMoney: number; totalVolume: number; totalTrades: number }>
  >;

  // Watch list methods
  getWatchList(userId: string): Promise<string[]>; // Returns array of player IDs (legacy/all lists)
  addToWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void>;
  removeFromWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void>;
  isOnWatchList(userId: string, playerId: string): Promise<boolean>;

  // Multi-watchlist methods
  getWatchlists(
    userId: string,
  ): Promise<
    { id: string; name: string; isDefault: boolean; color: string | null; itemCount: number }[]
  >;
  createWatchlist(
    userId: string,
    name: string,
    isDefault?: boolean,
    color?: string,
  ): Promise<{ id: string; name: string }>;
  updateWatchlist(watchlistId: string, updates: { name?: string; color?: string }): Promise<void>;
  deleteWatchlist(watchlistId: string): Promise<void>;
  ensureDefaultWatchlist(userId: string): Promise<string>; // Returns default watchlist ID
  getWatchlistItems(watchlistId: string): Promise<string[]>; // Returns player IDs
  getPlayerWatchlists(userId: string, playerId: string): Promise<string[]>; // Returns watchlist IDs containing player

  // Holdings lock methods - prevent double-spending of shares
  reserveShares(
    userId: string,
    assetType: string,
    assetId: string,
    lockType: string,
    lockReferenceId: string,
    quantity: number,
  ): Promise<HoldingsLock>;
  releaseShares(lockId: string): Promise<void>;
  releaseSharesByReference(lockReferenceId: string): Promise<void>;
  getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number>;
  getLockedShares(userId: string, assetType: string, assetId: string): Promise<HoldingsLock[]>;
  getTotalLockedQuantity(userId: string, assetType: string, assetId: string): Promise<number>;
  adjustLockQuantity(lockReferenceId: string, newQuantity: number): Promise<void>;

  // Balance lock methods - prevent double-spending of cash
  reserveCash(
    userId: string,
    lockType: string,
    lockReferenceId: string,
    amount: string,
  ): Promise<BalanceLock>;
  releaseCash(lockId: string): Promise<void>;
  releaseCashByReference(lockReferenceId: string): Promise<void>;
  getAvailableBalance(userId: string): Promise<number>;
  getTotalLockedBalance(userId: string): Promise<number>;
  adjustLockAmount(lockReferenceId: string, newAmount: string): Promise<void>;

  // Trade methods
  createTrade(trade: any): Promise<Trade>;
  getRecentTrades(playerId?: string, limit?: number): Promise<Trade[]>;
  getMarketActivity(filters?: {
    playerId?: string;
    userId?: string;
    limit?: number;
  }): Promise<any[]>;

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
  getScoutRoster(playerId: string): Promise<
    Array<{
      user: { id: string; username: string | null; avatarUrl: string | null } | null;
      scoutCount: number;
    }>
  >;

  // Activity methods
  getUserActivity(
    userId: string,
    filters?: {
      types?: string[];
      limit?: number;
      offset?: number;
      includeBalanceAfter?: boolean;
    },
  ): Promise<any[]>;

  // Daily games methods
  upsertDailyGame(game: InsertDailyGame): Promise<DailyGame>;
  getDailyGames(startDate: Date, endDate: Date): Promise<DailyGame[]>;
  getDailyGamesBySport(sport: string, startDate: Date, endDate: Date): Promise<DailyGame[]>;
  getDailyGameByGameId(gameId: string): Promise<DailyGame | undefined>;
  createDailyGame(game: InsertDailyGame): Promise<DailyGame>;
  updateDailyGame(id: string, updates: Partial<InsertDailyGame>): Promise<void>;
  updateDailyGameStatus(gameId: string, status: string): Promise<void>;
  updateDailyGameScore(
    gameId: string,
    homeScore: number,
    awayScore: number,
    status: string,
  ): Promise<void>;
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
  getPlayerGameStatsByGameAndHomeAway(
    gameId: string,
    homeAway: "home" | "away",
  ): Promise<PlayerGameStats[]>;
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
  getBlogPosts(options: {
    limit: number;
    offset: number;
    publishedOnly: boolean;
  }): Promise<{ posts: BlogPost[]; total: number }>;
  getBlogPostBySlug(slug: string): Promise<BlogPost | undefined>;
  createBlogPost(post: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: string, updates: Partial<BlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: string): Promise<void>;

  // Portfolio snapshot methods
  getAllUsersForRanking(): Promise<
    Array<{ userId: string; balance: string; portfolioValue: number }>
  >;
  getPortfolioSnapshot(userId: string, date: Date): Promise<PortfolioSnapshot | undefined>;
  getLatestSnapshotRanks(): Promise<
    Map<
      string,
      { cashRank: number | null; portfolioRank: number | null; netWorthRank: number | null }
    >
  >;
  getPortfolioSnapshotsInRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PortfolioSnapshot[]>;
  createPortfolioSnapshot(snapshot: InsertPortfolioSnapshot): Promise<PortfolioSnapshot>;

  // Analytics methods
  getMarketHealthStats(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    transactionCount: number;
    totalVolume: number;
    totalMarketCap: number;
    prevTransactionCount: number;
    prevTotalVolume: number;
    prevTotalMarketCap: number;
  }>;
  getMarketHealthTimeSeries(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      date: string;
      transactions: number;
      volume: number;
      marketCap: number;
    }>
  >;
  getPlayerSharesOutstanding(playerIds?: string[]): Promise<Map<string, number>>;
  getHotColdPlayers(limit: number): Promise<{ hot: Player[]; cold: Player[] }>;
  getHeatmapData(): Promise<
    Array<{
      team: string;
      position: string;
      avgPriceChange: number;
      playerCount: number;
      topPlayer: string;
    }>
  >;
  getPowerRankings(limit?: number): Promise<
    Array<{
      playerId: string;
      name: string;
      team: string;
      position: string;
      price: number;
      priceChange7d: number;
      volume: number;
      avgFantasyPoints: number;
      compositeScore: number;
    }>
  >;
  getShareEconomyStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalSharesVested: number;
    totalSharesScouted: number;
    totalSharesBurned: number;
    totalSharesInEconomy: number;
    periodSharesVested: number;
    periodSharesScouted: number;
    periodsharesVested: number;
    periodSharesBurned: number;
  }>;
  getShareEconomyTimeSeries(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      date: string;
      sharesVested: number;
      sharesScouted: number;
      sharesBurned: number;
    }>
  >;

  getVestingByReference?(referenceId: string): Promise<Vesting | undefined>;

  // Premium checkout session methods
  createPremiumCheckoutSession(session: {
    userId: string;
    planId: string;
    quantity: number;
    amountCents: number;
    whopSessionId?: string;
  }): Promise<PremiumCheckoutSession>;
  getPremiumCheckoutSession(id: string): Promise<PremiumCheckoutSession | undefined>;
  getPremiumCheckoutSessionByReceipt(
    receiptId: string,
  ): Promise<PremiumCheckoutSession | undefined>;
  completePremiumCheckoutSession(
    id: string,
    receiptId: string,
  ): Promise<PremiumCheckoutSession | undefined>;
  getUserPremiumCheckoutSessions(userId: string): Promise<PremiumCheckoutSession[]>;
  getPendingPremiumCheckoutSessions(): Promise<PremiumCheckoutSession[]>;

  // Community checkout session methods
  createCommunityCheckoutSession(session: {
    userId: string;
    planId: string;
    quantity: number;
    amountCents: number;
    whopSessionId?: string;
  }): Promise<CommunityCheckoutSession>;
  getCommunityCheckoutSession(id: string): Promise<CommunityCheckoutSession | undefined>;
  getCommunityCheckoutSessionByReceipt(
    receiptId: string,
  ): Promise<CommunityCheckoutSession | undefined>;
  completeCommunityCheckoutSession(
    id: string,
    receiptId: string,
  ): Promise<CommunityCheckoutSession | undefined>;
  getUserCommunityCheckoutSessions(userId: string): Promise<CommunityCheckoutSession[]>;
  getPendingCommunityCheckoutSessions(): Promise<CommunityCheckoutSession[]>;

  // Whop payment sync methods
  getWhopPaymentByPaymentId(paymentId: string): Promise<WhopPayment | undefined>;
  getWhopPaymentsByEmail(email: string): Promise<WhopPayment[]>;
  getWhopPaymentsByUserId(userId: string): Promise<WhopPayment[]>;
  getUncreditedWhopPaymentsByEmail(email: string): Promise<WhopPayment[]>;
  upsertWhopPayment(payment: InsertWhopPayment): Promise<WhopPayment>;
  creditWhopPayment(paymentId: string, userId: string): Promise<WhopPayment | undefined>;
  revokeWhopPayment(
    paymentId: string,
    revokedQuantity: number,
    liabilityQuantity?: number,
  ): Promise<WhopPayment | undefined>;
  updateWhopPaymentStatus(paymentId: string, whopStatus: string): Promise<WhopPayment | undefined>;

  // Financial Metrics
  getPlayerFinancialMetrics(playerId: string): Promise<PlayerFinancialMetrics>;
  getFinancialMarketScanners(sport?: string): Promise<{
    undervalued: { player: Player; metrics: PlayerFinancialMetrics }[];
    sentiment: { player: Player; metrics: PlayerFinancialMetrics }[];
    momentum: { player: Player; metrics: PlayerFinancialMetrics }[];
    premium: { player: Player; metrics: PlayerFinancialMetrics }[];
  }>;

  // Daily Boosts methods
  getDailyBoosts(userId: string, sport: string, date: Date): Promise<DailyBoost[]>;
  getDailyBoostsAllSports(userId: string, date: Date): Promise<DailyBoost[]>;
  getDailyBoostsByStatus(status: string): Promise<DailyBoost[]>;
  getEligiblePlayersForBoost(
    userId: string,
    sport: string,
    date: Date,
  ): Promise<BoostEligibleHolding[]>;
  getAllHoldingsWithPlayers(userId: string): Promise<HoldingWithPlayerSummary[]>;
  createDailyBoost(boost: InsertDailyBoost): Promise<DailyBoost>;
  updateDailyBoost(boostId: string, updates: Partial<DailyBoost>): Promise<void>;
  deleteDailyBoost(boostId: string): Promise<void>;
  getBoostPayoutHistory(userId: string, limit?: number): Promise<BoostPayout[]>;
  createBoostPayout(payout: InsertBoostPayout): Promise<BoostPayout>;
  createSharePayoutSnapshotsForGame(
    game: Pick<DailyGame, "gameId" | "sport" | "homeTeam" | "awayTeam">,
    baseRate: string,
  ): Promise<number>;
  getPendingSharePayouts(limit?: number): Promise<SharePayout[]>;
  processSharePayoutCredit(
    payoutId: string,
    userId: string,
    fantasyPoints: string,
    payoutAmount: string,
  ): Promise<boolean>;
  createSharePayout(payout: InsertSharePayout): Promise<SharePayout>;
  lockBoostShares(boostId: string): Promise<void>;
  unlockBoostShares(boostId: string): Promise<void>;
  ensureHoldingConsistency(holdingId: string): Promise<void>;
  getPlayerGameForDate(playerId: string, sport: string, date: Date): Promise<DailyGame | undefined>;

  // Community Boosts methods
  getCommunityBoostsForDate(
    sport: string,
    date: Date,
  ): Promise<(CommunityBoost & { creator: User; player: Player })[]>;
  getCommunityBoostsAllSports(
    date: Date,
  ): Promise<(CommunityBoost & { creator: User; player: Player })[]>;
  createCommunityBoost(boost: InsertCommunityBoost): Promise<CommunityBoost>;
  getCommunityBoostBeneficiaries(playerId: string): Promise<(Holding & { user: User })[]>;
  updateCommunityBoost(boostId: string, updates: Partial<CommunityBoost>): Promise<void>;
  getCommunityBoostsByStatus(status: string): Promise<CommunityBoost[]>;
  getScoutStatus(
    userId: string,
  ): Promise<{ earnedMinutes: number; nextDistribution: Date; perPlayer?: Record<string, number> }>;

  // Multiplier / Stack Shares methods
  stackShares(
    userId: string,
    playerId: string,
    rawShareCount: number,
  ): Promise<{
    newMultiplier: string;
    sharesStacked: number;
    multiplier: string;
    effectiveSharesBurned: number;
  }>;
  getHoldingMultiplierState(
    userId: string,
    playerId: string,
  ): Promise<HoldingMultiplierState | undefined>;

  // AMM / LP methods
  getPlayerPool(playerId: string): Promise<any>;
  getLpPosition(playerId: string, userId: string): Promise<any>;
  getUserLpPositions(userId: string): Promise<any[]>;
  createLpPosition(position: any): Promise<any>;
  updateLpPosition(id: string, updates: Partial<any>): Promise<void>;
  deleteLpPosition(id: string): Promise<void>;
  getLpTransactionHistory(userId: string, playerId?: string, limit?: number): Promise<any[]>;
}

function toFixedString(value: number, scale: number): string {
  return Number.isFinite(value) ? value.toFixed(scale) : (0).toFixed(scale);
}

function toHoldingNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildHoldingSummary(holding: Holding): HoldingSummary {
  return {
    ...holding,
    effectiveShares: holding.quantity,
    multiplier: "1.00",
    isStackedShare: false,
  };
}

function buildStackedShareSummary(multiplier: PlayerMultiplier): HoldingSummary {
  const multiplierValue = Math.max(0, Number(multiplier.multiplier || 0));
  return {
    id: multiplier.id,
    userId: multiplier.userId,
    assetType: "player",
    assetId: multiplier.playerId,
    quantity: "1",
    effectiveShares: toFixedString(multiplierValue, 2),
    multiplier: toFixedString(multiplierValue, 2),
    isStackedShare: true,
    avgCostBasis: multiplier.avgCostBasis,
    totalCostBasis: multiplier.totalCostBasis,
    lastUpdated: multiplier.updatedAt,
  };
}

export class DatabaseStorage implements IStorage {
  private async getPlayerMultiplier(
    userId: string,
    playerId: string,
    tx: typeof db = db,
  ): Promise<PlayerMultiplier | undefined> {
    const [multiplier] = await tx
      .select()
      .from(playerMultipliers)
      .where(and(eq(playerMultipliers.userId, userId), eq(playerMultipliers.playerId, playerId)));
    return multiplier || undefined;
  }

  private async getPlayerMultiplierMap(
    userId: string,
    playerIds?: string[],
    tx: typeof db = db,
  ): Promise<Map<string, PlayerMultiplier>> {
    const conditions = [eq(playerMultipliers.userId, userId)];
    if (playerIds && playerIds.length > 0) {
      conditions.push(inArray(playerMultipliers.playerId, playerIds));
    }

    const rows = await tx
      .select()
      .from(playerMultipliers)
      .where(and(...conditions));

    return new Map(rows.map((row) => [row.playerId, row]));
  }

  private async getRegularAvailableShares(
    userId: string,
    assetId: string,
    tx: typeof db = db,
  ): Promise<number> {
    const [regularHolding] = await tx
      .select({ quantity: holdings.quantity })
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, assetId),
        ),
      );

    const totalLocked = await this.getTotalLockedQuantity(userId, "player", assetId);
    return Math.max(0, toHoldingNumber(regularHolding?.quantity) - totalLocked);
  }

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
    const [user] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email})`);
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
      console.log(
        `[LAZY_MIGRATION] User ${userData.email} already exists with ID ${userData.id}, skipping migration`,
      );
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
          .for("update");

        if (!existingUserByEmail || existingUserByEmail.id === userData.id) {
          // No migration needed - either no user with this email, or same ID
          return null;
        }

        // Found existing user with different ID - update their record with new auth ID
        // This preserves all their holdings, orders, trades, and balances
        console.log(
          `[LAZY_MIGRATION] Migrating user ${userData.email} from ID ${existingUserByEmail.id} to ${userData.id}`,
        );

        const oldId = existingUserByEmail.id;
        const newId = userData.id;

        // Step 1: Temporarily clear unique constraints on old row to allow new row insert
        // Email and username have unique constraints, so we clear them first
        await tx
          .update(users)
          .set({
            email: null,
            username: `__migrating_${oldId}`,
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
        await tx.update(vesting).set({ userId: newId }).where(eq(vesting.userId, oldId));

        // Update holdings
        await tx.update(holdings).set({ userId: newId }).where(eq(holdings.userId, oldId));

        // Update holdings locks
        await tx
          .update(holdingsLocks)
          .set({ userId: newId })
          .where(eq(holdingsLocks.userId, oldId));

        // Update balance locks
        await tx.update(balanceLocks).set({ userId: newId }).where(eq(balanceLocks.userId, oldId));

        // Update orders
        await tx.update(orders).set({ userId: newId }).where(eq(orders.userId, oldId));

        // Update trades (buyer and seller)
        await tx.update(trades).set({ buyerId: newId }).where(eq(trades.buyerId, oldId));

        await tx.update(trades).set({ sellerId: newId }).where(eq(trades.sellerId, oldId));

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
        await tx.update(whopPayments).set({ userId: newId }).where(eq(whopPayments.userId, oldId));

        // Update blog posts (author)
        await tx.update(blogPosts).set({ authorId: newId }).where(eq(blogPosts.authorId, oldId));

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

  async listUserApiTokens(userId: string): Promise<UserApiToken[]> {
    return db
      .select()
      .from(userApiTokens)
      .where(eq(userApiTokens.userId, userId))
      .orderBy(desc(userApiTokens.createdAt));
  }

  async createUserApiToken(token: InsertUserApiToken): Promise<UserApiToken> {
    const [created] = await db.insert(userApiTokens).values(token).returning();
    return created;
  }

  async getUserApiTokenByHash(tokenHash: string): Promise<UserApiToken | undefined> {
    const [token] = await db
      .select()
      .from(userApiTokens)
      .where(and(eq(userApiTokens.tokenHash, tokenHash), isNull(userApiTokens.revokedAt)));

    return token || undefined;
  }

  async markUserApiTokenUsed(tokenId: string): Promise<void> {
    await db
      .update(userApiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(userApiTokens.id, tokenId));
  }

  async revokeUserApiToken(userId: string, tokenId: string): Promise<boolean> {
    const [revoked] = await db
      .update(userApiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userApiTokens.id, tokenId),
          eq(userApiTokens.userId, userId),
          isNull(userApiTokens.revokedAt),
        ),
      )
      .returning({ id: userApiTokens.id });

    return Boolean(revoked);
  }

  async updateUserBalance(userId: string, amount: string): Promise<void> {
    await db.update(users).set({ balance: amount }).where(eq(users.id, userId));
  }

  async incrementTotalSharesVested(userId: string, amount: number): Promise<void> {
    await db
      .update(users)
      .set({
        totalSharesVested: sql`${users.totalSharesVested} + ${amount}`,
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
    return result.map((r) => r.userId);
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
        await tx.insert(vestingSplits).values(splits.map((s) => ({ ...s, userId })));
      }
    });
  }

  async createVestingClaim(claim: InsertVestingClaim): Promise<VestingClaim> {
    const [created] = await db.insert(vestingClaims).values(claim).returning();
    return created;
  }

  // Scout Engine methods
  private async assignScoutsInTransaction(
    tx: any,
    userId: string,
    playerId: string,
    count: number,
  ): Promise<void> {
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new Error("User not found");
    }

    const maxScouts = user.isPremium ? 10 : 5;

    const currentAssignments = await tx
      .select({ totalScouts: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)` })
      .from(scoutAssignments)
      .where(
        and(eq(scoutAssignments.userId, userId), sql`${scoutAssignments.playerId} != ${playerId}`),
      );

    const currentTotal = Number(currentAssignments[0]?.totalScouts || 0);
    const newTotal = currentTotal + count;

    if (newTotal > maxScouts) {
      throw new Error(
        `Scout limit exceeded. Maximum: ${maxScouts}, Current: ${currentTotal}, Requested: ${count}`,
      );
    }

    if (count === 0) {
      await tx
        .delete(scoutAssignments)
        .where(and(eq(scoutAssignments.userId, userId), eq(scoutAssignments.playerId, playerId)));
    } else {
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

    await tx
      .update(scoutHistory)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(scoutHistory.userId, userId),
          eq(scoutHistory.playerId, playerId),
          sql`${scoutHistory.endedAt} IS NULL`,
        ),
      );

    if (count > 0) {
      await tx.insert(scoutHistory).values({
        userId,
        playerId,
        scoutCount: count,
        startedAt: new Date(),
      });
    }

    await tx.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
  }

  async assignScouts(userId: string, playerId: string, count: number): Promise<void> {
    await db.transaction(async (tx) => {
      await this.assignScoutsInTransaction(tx, userId, playerId, count);
    });
  }

  async applyScoutAssignments(
    userId: string,
    assignments: Array<{ playerId: string; count: number }>,
  ): Promise<void> {
    if (assignments.length === 0) {
      return;
    }

    await db.transaction(async (tx) => {
      const playerIds = assignments.map((assignment) => assignment.playerId);
      const existingAssignments = await tx
        .select({
          playerId: scoutAssignments.playerId,
          scoutCount: scoutAssignments.scoutCount,
        })
        .from(scoutAssignments)
        .where(
          and(eq(scoutAssignments.userId, userId), inArray(scoutAssignments.playerId, playerIds)),
        );

      const currentCounts = new Map(
        existingAssignments.map((assignment) => [assignment.playerId, assignment.scoutCount]),
      );
      const orderedAssignments = [...assignments].sort((left, right) => {
        const leftDelta = left.count - (currentCounts.get(left.playerId) || 0);
        const rightDelta = right.count - (currentCounts.get(right.playerId) || 0);
        return leftDelta - rightDelta;
      });

      for (const assignment of orderedAssignments) {
        await this.assignScoutsInTransaction(tx, userId, assignment.playerId, assignment.count);
      }
    });
  }

  async getUserScoutAssignments(
    userId: string,
  ): Promise<(ScoutAssignment & { player: Player | null })[]> {
    const results = await db
      .selectDistinct()
      .from(scoutAssignments)
      .leftJoin(players, eq(scoutAssignments.playerId, players.id))
      .where(eq(scoutAssignments.userId, userId));

    return results.map((r) => ({
      ...r.scout_assignments,
      player: r.players,
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
      .where(
        and(eq(scoutAssignments.playerId, playerId), gte(users.lastActiveAt, twentyFourHoursAgo)),
      );

    return results.map((r) => ({ userId: r.userId, scoutCount: r.scoutCount }));
  }

  async updateLastActive(userId: string): Promise<void> {
    await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
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

    return results.map((r) => r.playerId);
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
        .for("update");

      if (!player) {
        throw new Error(`Player ${playerId} not found`);
      }

      // Credit shares to the user's regular-share holdings (multiplier field = 1) with $0 cost basis.
      const existing = await this.getRegularHolding(userId, "player", playerId);

      if (existing) {
        // Add to existing regular holding - keep existing cost basis for purchased shares
        // New shares have $0 cost, so weighted average shifts down
        const existingQuantity = parseFloat(existing.quantity);
        const newQuantity = existingQuantity + shares;
        const existingCost = parseFloat(existing.totalCostBasis || "0");
        // New shares are free, so total cost stays the same
        const newAvgCost = newQuantity > 0 ? (existingCost / newQuantity).toFixed(4) : "0.0000";
        await tx
          .update(holdings)
          .set({
            quantity: newQuantity.toString(),
            avgCostBasis: newAvgCost,
            // totalCostBasis stays the same since new shares are free
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existing.id));
      } else {
        // Create new regular holding with $0 cost basis
        await tx.insert(holdings).values({
          userId,
          assetType: "player",
          assetId: playerId,
          quantity: shares.toString(),
          avgCostBasis: "0.0000",
          totalCostBasis: "0.00",
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

  async getScoutRoster(playerId: string): Promise<
    Array<{
      user: { id: string; username: string | null; avatarUrl: string | null } | null;
      scoutCount: number;
    }>
  > {
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
        scoutCount: scoutAssignments.scoutCount,
      })
      .from(scoutAssignments)
      .where(eq(scoutAssignments.playerId, playerId))
      .orderBy(desc(scoutAssignments.scoutCount))
      .limit(50);

    return rawResults.map((r) => ({
      user: {
        id: r.userId,
        username: `User ${r.userId.substring(0, 8)}...`, // Anonymized fallback
        avatarUrl: null,
      },
      scoutCount: r.scoutCount,
    }));
  }

  async addUserBalance(userId: string, delta: number): Promise<User | undefined> {
    // Atomically increment the balance in the database
    // Drizzle handles numeric values correctly when passed directly
    await db
      .update(users)
      .set({
        // PostgreSQL handles the arithmetic atomically with proper precision
        balance: sql`${users.balance} + ${delta}`,
      })
      .where(eq(users.id, userId));

    return await this.getUser(userId);
  }

  async updateUsername(userId: string, username: string): Promise<User | undefined> {
    await db.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, userId));

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
    await db.update(users).set({ hasSeenOnboarding: true }).where(eq(users.id, userId));
  }

  async updateUserPremiumStatus(
    userId: string,
    isPremium: boolean,
    premiumExpiresAt: Date | null,
  ): Promise<void> {
    await db
      .update(users)
      .set({
        isPremium,
        premiumExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  private normalizePlayerSearchInput(search?: string): {
    normalized: string;
    normalizedLower: string;
    compactLower: string;
    tokens: string[];
  } | null {
    const normalized = (search || "").trim().replace(/\s+/g, " ");
    if (!normalized) return null;

    const normalizedLower = normalized.toLowerCase();
    const compactLower = normalizedLower.replace(/\s+/g, "");
    const tokens = normalizedLower.split(" ").filter(Boolean).slice(0, 6);

    return { normalized, normalizedLower, compactLower, tokens };
  }

  // Helper: Build player query conditions (reused by getPlayers and getPlayersPaginated)
  private buildPlayerQueryConditions(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
  }) {
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
      const normalizedSearch = this.normalizePlayerSearchInput(filters.search);
      if (normalizedSearch) {
        const fullNameExpr = sql`LOWER(CONCAT_WS(' ', ${players.firstName}, ${players.lastName}))`;
        const compactFullNameExpr = sql`REPLACE(${fullNameExpr}, ' ', '')`;
        const searchPattern = `%${normalizedSearch.normalizedLower}%`;
        const compactSearchPattern = `%${normalizedSearch.compactLower}%`;

        const tokenConditions = normalizedSearch.tokens.map((token) => {
          const tokenPattern = `%${token}%`;
          return sql`(
            LOWER(${players.firstName}) LIKE ${tokenPattern}
            OR LOWER(${players.lastName}) LIKE ${tokenPattern}
            OR LOWER(${players.team}) LIKE ${tokenPattern}
            OR LOWER(COALESCE(${players.position}, '')) LIKE ${tokenPattern}
            OR LOWER(${players.id}) LIKE ${tokenPattern}
          )`;
        });
        const allTokenMatchCondition =
          tokenConditions.length > 0 ? and(...tokenConditions) : undefined;

        const broadMatchCondition = sql`(
          ${fullNameExpr} LIKE ${searchPattern}
          OR ${compactFullNameExpr} LIKE ${compactSearchPattern}
          OR LOWER(${players.firstName}) LIKE ${searchPattern}
          OR LOWER(${players.lastName}) LIKE ${searchPattern}
          OR LOWER(${players.team}) LIKE ${searchPattern}
          OR LOWER(COALESCE(${players.position}, '')) LIKE ${searchPattern}
          OR LOWER(${players.id}) LIKE ${searchPattern}
        )`;

        conditions.push(
          allTokenMatchCondition
            ? sql`(${broadMatchCondition} OR ${allTokenMatchCondition})`
            : broadMatchCondition,
        );
      }
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
      return await db
        .select()
        .from(players)
        .where(and(...conditions));
    }
    return await db.select().from(players);
  }

  // Paginated players - returns subset with total count (new API for performance)
  // OPTIMIZED: Removed correlated subqueries that caused 73s query times
  // Now uses fast base query + route handler for enrichment (188ms total)
  async getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
    offset?: number;
    sortBy?:
      | "price"
      | "volume"
      | "change"
      | "tvl"
      | "marketCap"
      | "sentiment"
      | "undervalued"
      | "fantasyPoints"
      | "name"
      | "team";
    sortOrder?: "asc" | "desc";
    teamsPlayingOnDate?: string[];
    watchlistUserId?: string;
    watchlistId?: string;
  }): Promise<{ players: Player[]; total: number }> {
    const {
      search,
      team,
      position,
      sport,
      limit = 50,
      offset = 0,
      sortBy = "volume",
      sortOrder = "desc",
      teamsPlayingOnDate,
      watchlistUserId,
      watchlistId,
    } = filters || {};

    type PlayerSortBy =
      | "price"
      | "volume"
      | "change"
      | "tvl"
      | "marketCap"
      | "sentiment"
      | "undervalued"
      | "fantasyPoints"
      | "name"
      | "team";
    const sortBySafe: PlayerSortBy = sortBy as PlayerSortBy;
    const normalizedSearch = this.normalizePlayerSearchInput(search);

    // Build conditions using the helper
    const conditions = this.buildPlayerQueryConditions({ search, team, position, sport });

    // Add additional filters
    if (watchlistUserId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${watchList}
          WHERE ${watchList.playerId} = ${players.id}
          AND ${watchList.userId} = ${watchlistUserId}
          ${watchlistId ? sql`AND ${watchList.watchlistId} = ${watchlistId}` : sql``}
        )`,
      );
    }

    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {
      conditions.push(inArray(players.team, teamsPlayingOnDate));
    } // Always filter by is_active
    conditions.push(eq(players.isActive, true));

    const isComplexSort = ["sentiment", "undervalued", "fantasyPoints"].includes(sortBySafe);

    // Build ORDER BY clause
    let orderByClause: any;
    switch (sortBySafe) {
      case "price":
        orderByClause =
          sortOrder === "asc" ? asc(players.lastTradePrice) : desc(players.lastTradePrice);
        break;
      case "marketCap":
        orderByClause = sortOrder === "asc" ? asc(players.marketCap) : desc(players.marketCap);
        break;
      case "volume":
        orderByClause = sortOrder === "asc" ? asc(players.volume24h) : desc(players.volume24h);
        break;
      case "change":
        orderByClause =
          sortOrder === "asc" ? asc(players.priceChange24h) : desc(players.priceChange24h);
        break;
      case "name":
        orderByClause =
          sortOrder === "asc"
            ? sql`${players.lastName} ASC, ${players.firstName} ASC`
            : sql`${players.lastName} DESC, ${players.firstName} DESC`;
        break;
      case "team":
        orderByClause = sortOrder === "asc" ? asc(players.team) : desc(players.team);
        break;
      case "sentiment":
        orderByClause =
          sortOrder === "asc"
            ? asc(sql`COALESCE(${playerMarketMetrics.buyPressure}, 50)`)
            : desc(sql`COALESCE(${playerMarketMetrics.buyPressure}, 50)`);
        break;
      case "undervalued":
        orderByClause =
          sortOrder === "asc"
            ? asc(sql`COALESCE(NULLIF(${playerMarketMetrics.valueIndex}, 0), 999999999)`)
            : desc(sql`COALESCE(${playerMarketMetrics.valueIndex}, 0)`);
        break;
      case "fantasyPoints":
        orderByClause =
          sortOrder === "asc"
            ? asc(sql`COALESCE(${playerMarketMetrics.avgFantasyPoints}, 0)`)
            : desc(sql`COALESCE(${playerMarketMetrics.avgFantasyPoints}, 0)`);
        break;
      case "tvl": {
        const tvlExpr = sql<number>`COALESCE(${playerPools.playMoney}, 0) * 2`;
        orderByClause = sortOrder === "asc" ? sql`${tvlExpr} ASC` : sql`${tvlExpr} DESC`;
        break;
      }
      default:
        orderByClause = desc(players.volume24h);
    }

    let finalOrderByClause: any = orderByClause;
    if (normalizedSearch) {
      const fullNameExpr = sql`LOWER(CONCAT_WS(' ', ${players.firstName}, ${players.lastName}))`;
      const compactFullNameExpr = sql`REPLACE(${fullNameExpr}, ' ', '')`;
      const searchPrefix = `${normalizedSearch.normalizedLower}%`;
      const searchPattern = `%${normalizedSearch.normalizedLower}%`;

      const tokenConditions = normalizedSearch.tokens.map((token) => {
        const tokenPattern = `%${token}%`;
        return sql`(
          LOWER(${players.firstName}) LIKE ${tokenPattern}
          OR LOWER(${players.lastName}) LIKE ${tokenPattern}
          OR LOWER(${players.team}) LIKE ${tokenPattern}
          OR LOWER(COALESCE(${players.position}, '')) LIKE ${tokenPattern}
          OR LOWER(${players.id}) LIKE ${tokenPattern}
        )`;
      });
      const allTokenMatchCondition = tokenConditions.length > 0 ? and(...tokenConditions) : null;

      const relevanceScoreExpr = sql<number>`CASE
        WHEN LOWER(${players.id}) = ${normalizedSearch.normalizedLower} THEN 120
        WHEN ${fullNameExpr} = ${normalizedSearch.normalizedLower} THEN 115
        WHEN ${compactFullNameExpr} = ${normalizedSearch.compactLower} THEN 112
        WHEN ${fullNameExpr} LIKE ${searchPrefix} THEN 105
        WHEN LOWER(${players.lastName}) LIKE ${searchPrefix} THEN 100
        WHEN LOWER(${players.firstName}) LIKE ${searchPrefix} THEN 98
        WHEN LOWER(${players.team}) LIKE ${searchPrefix} THEN 95
        WHEN ${fullNameExpr} LIKE ${searchPattern} THEN 90
        WHEN LOWER(${players.firstName}) LIKE ${searchPattern}
          OR LOWER(${players.lastName}) LIKE ${searchPattern} THEN 85
        WHEN LOWER(${players.team}) LIKE ${searchPattern}
          OR LOWER(COALESCE(${players.position}, '')) LIKE ${searchPattern}
          OR LOWER(${players.id}) LIKE ${searchPattern} THEN 80
        ${allTokenMatchCondition ? sql`WHEN ${allTokenMatchCondition} THEN 75` : sql``}
        ELSE 0
      END`;

      finalOrderByClause = sql`${relevanceScoreExpr} DESC, ${orderByClause}, ${players.id} ASC`;
    }

    // Execute count and data queries in parallel
    const countQuery = db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(players)
      .where(and(...conditions));

    const dataQuery = isComplexSort
      ? db
          .select({
            player: players,
            metricBuyPressure: sql<string>`COALESCE(${playerMarketMetrics.buyPressure}, '50')`,
            metricValueIndex: sql<string>`COALESCE(${playerMarketMetrics.valueIndex}, '0')`,
            metricAvgFantasyPoints: sql<string>`COALESCE(${playerMarketMetrics.avgFantasyPoints}, '0')`,
          })
          .from(players)
          .leftJoin(playerMarketMetrics, eq(playerMarketMetrics.playerId, players.id))
          .where(and(...conditions))
          .orderBy(finalOrderByClause)
          .limit(limit)
          .offset(offset)
      : sortBySafe === "tvl"
        ? db
            .select({ player: players })
            .from(players)
            .leftJoin(playerPools, eq(playerPools.playerId, players.id))
            .where(and(...conditions))
            .orderBy(finalOrderByClause)
            .limit(limit)
            .offset(offset)
        : db
            .select({ player: players })
            .from(players)
            .where(and(...conditions))
            .orderBy(finalOrderByClause)
            .limit(limit)
            .offset(offset);

    const [countResult, playerRows] = await Promise.all([countQuery, dataQuery]);

    const mappedPlayers = playerRows.map((r: any) => {
      const player = r.player as Player & {
        _metricBuyPressure?: string;
        _metricValueIndex?: string;
        _metricAvgFantasyPoints?: string;
      };

      if (isComplexSort) {
        player._metricBuyPressure = r.metricBuyPressure;
        player._metricValueIndex = r.metricValueIndex;
        player._metricAvgFantasyPoints = r.metricAvgFantasyPoints;
      }

      return player as Player;
    });

    return { players: mappedPlayers, total: countResult[0].count };
  }

  async getPlayer(id: string): Promise<Player | undefined> {
    const trimmedId = (id || "").trim();
    if (!trimmedId) return undefined;

    const [player] = await db.select().from(players).where(eq(players.id, trimmedId));
    if (player) return player;

    // Backwards compatibility: allow passing raw numeric IDs and resolve to prefixed IDs.
    // The canonical format is sport-prefixed (e.g., nba_12345, nfl_67890, mlb_99999).
    if (/^\d+$/.test(trimmedId)) {
      const candidates = [`nba_${trimmedId}`, `nfl_${trimmedId}`, `mlb_${trimmedId}`];
      const resolved = await db
        .select()
        .from(players)
        .where(inArray(players.id, candidates))
        .limit(1);
      return resolved[0] || undefined;
    }

    return undefined;
  }

  async getPlayersByIds(ids: string[]): Promise<Player[]> {
    if (ids.length === 0) return [];
    return await db.select().from(players).where(inArray(players.id, ids));
  }

  async getTopPlayersByVolume(limit: number): Promise<Player[]> {
    return await db.select().from(players).orderBy(desc(players.volume24h)).limit(limit);
  }

  async upsertPlayer(player: InsertPlayer): Promise<Player> {
    const normalizedSport = (player.sport ?? "NBA").toUpperCase();
    const normalizedTeam = (player.team || "").trim().toUpperCase();

    // Prefer canonical row when same player identity already exists.
    // If historical duplicates exist, pick the row with the strongest economic footprint.
    const sameIdentityCandidates = await db
      .select()
      .from(players)
      .where(
        and(
          sql`LOWER(${players.firstName}) = LOWER(${player.firstName})`,
          sql`LOWER(${players.lastName}) = LOWER(${player.lastName})`,
          sql`UPPER(${players.team}) = ${normalizedTeam}`,
          sql`UPPER(${players.sport}) = ${normalizedSport}`,
        ),
      )
      .orderBy(
        desc(players.totalShares),
        desc(players.volume24h),
        desc(players.lastUpdated),
        asc(players.id),
      )
      .limit(10);

    if (sameIdentityCandidates.length > 0) {
      const canonical = sameIdentityCandidates[0];

      if (sameIdentityCandidates.length > 1) {
        console.warn(
          `[upsertPlayer] Found ${sameIdentityCandidates.length} existing duplicates for ${player.firstName} ${player.lastName} (${player.team}, ${normalizedSport}). Canonical ID: ${canonical.id}`,
        );
      }

      if (canonical.id !== player.id) {
        console.log(
          `[upsertPlayer] Merging duplicate: ${player.firstName} ${player.lastName} (${player.team}) - keeping existing ID: ${canonical.id}, ignoring new ID: ${player.id}`,
        );
      }

      const [updated] = await db
        .update(players)
        .set({
          sport: normalizedSport,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
          position: player.position,
          jerseyNumber: player.jerseyNumber,
          isActive: player.isActive,
          isEligibleForVesting: player.isEligibleForVesting,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, canonical.id))
        .returning();

      return updated;
    }

    // No existing player found by identity - check by ID
    const existing = await this.getPlayer(player.id);

    if (existing) {
      const [updated] = await db
        .update(players)
        .set({ ...player, sport: normalizedSport, lastUpdated: new Date() })
        .where(eq(players.id, player.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(players)
        .values({ ...player, sport: normalizedSport })
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

    return result.map((r) => r.team);
  }

  async getDistinctTeamsBySport(sport: string): Promise<string[]> {
    const result = await db
      .selectDistinct({ team: players.team })
      .from(players)
      .where(and(eq(players.isActive, true), eq(players.sport, sport)))
      .orderBy(asc(players.team));

    return result.map((r) => r.team);
  }

  async getPlayersBySport(sport: string): Promise<Player[]> {
    if (sport.toUpperCase() === "ALL") {
      return await db.select().from(players);
    }
    return await db
      .select()
      .from(players)
      .where(sql`UPPER(${players.sport}) = ${sport.toUpperCase()}`);
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

  async getPlayerPoolsByPlayerIds(playerIds: string[]): Promise<any[]> {
    if (playerIds.length === 0) return [];

    // IMPORTANT: avoid `select()` (SELECT *) here.
    // If the database is behind migrations (e.g. missing fee_growth_per_lp_share),
    // selecting all columns will throw and break otherwise unrelated endpoints.
    return await db
      .select({
        playerId: playerPools.playerId,
        shares: playerPools.shares,
        playMoney: playerPools.playMoney,
        k: playerPools.k,
        lpSharesTotal: playerPools.lpSharesTotal,
        feesAccumulated: playerPools.feesAccumulated,
        totalVolume: playerPools.totalVolume,
        totalTrades: playerPools.totalTrades,
        createdAt: playerPools.createdAt,
        updatedAt: playerPools.updatedAt,
      })
      .from(playerPools)
      .where(inArray(playerPools.playerId, playerIds));
  }

  // Holdings methods
  async getHolding(
    userId: string,
    assetType: string,
    assetId: string,
  ): Promise<Holding | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId),
        ),
      );
    return holding || undefined;
  }

  // Get the regular-share holding row (multiplier field = 1) for a specific asset
  async getRegularHolding(
    userId: string,
    assetType: string,
    assetId: string,
  ): Promise<Holding | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId),
        ),
      );
    return holding || undefined;
  }

  async getUserHoldings(userId: string): Promise<HoldingSummary[]> {
    const [baseHoldings, multiplierRows] = await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, userId)),
      db.select().from(playerMultipliers).where(eq(playerMultipliers.userId, userId)),
    ]);

    return [
      ...baseHoldings.map(buildHoldingSummary),
      ...multiplierRows.map(buildStackedShareSummary),
    ];
  }

  // Batched version: fetch multiple holdings for specific assets in ONE query
  async getBatchHoldings(
    userId: string,
    assetType: string,
    assetIds: string[],
  ): Promise<Map<string, Holding>> {
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
          inArray(holdings.assetId, assetIds),
        ),
      );

    const holdingsMap = new Map();
    for (const holding of holdingsArray) {
      holdingsMap.set(holding.assetId, holding);
    }
    return holdingsMap;
  }

  async getUserHoldingsWithPlayers(userId: string): Promise<any[]> {
    const [holdingRows, multiplierRows] = await Promise.all([
      db
        .select({
          holding: holdings,
          player: players,
          totalLocked: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)`,
        })
        .from(holdings)
        .leftJoin(players, and(eq(holdings.assetType, "player"), eq(holdings.assetId, players.id)))
        .leftJoin(
          holdingsLocks,
          and(
            eq(holdingsLocks.userId, holdings.userId),
            eq(holdingsLocks.assetId, holdings.assetId),
            eq(holdingsLocks.assetType, holdings.assetType),
          ),
        )
        .where(eq(holdings.userId, userId))
        .groupBy(holdings.id, players.id),
      db
        .select({
          multiplier: playerMultipliers,
          player: players,
        })
        .from(playerMultipliers)
        .innerJoin(players, eq(playerMultipliers.playerId, players.id))
        .where(eq(playerMultipliers.userId, userId)),
    ]);

    const syntheticRows = multiplierRows.map((row) => ({
      holding: buildStackedShareSummary(row.multiplier),
      player: row.player,
      totalLocked: 0,
      hasStackedShare: true,
      multiplier: row.multiplier.multiplier,
      effectiveShares: row.multiplier.multiplier,
    }));

    return [...holdingRows, ...syntheticRows];
  }

  async updateHolding(
    userId: string,
    assetType: string,
    assetId: string,
    quantity: number,
    avgCost: string,
  ): Promise<void> {
    const existing =
      assetType === "player"
        ? await this.getRegularHolding(userId, assetType, assetId)
        : await this.getHolding(userId, assetType, assetId);

    if (existing) {
      if (quantity <= 0) {
        // Remove holding - normalize to zero to avoid NaN
        await db
          .delete(holdings)
          .where(
            and(
              eq(holdings.userId, userId),
              eq(holdings.assetType, assetType),
              eq(holdings.assetId, assetId),
            ),
          );
      } else {
        // Update holding - ensure proper rounding and cost basis persistence
        const avgCostParsed = parseFloat(avgCost);
        const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
        const totalCost = (parseFloat(avgCostNormalized) * quantity).toFixed(2);

        await db
          .update(holdings)
          .set({
            quantity: quantity.toString(),
            avgCostBasis: avgCostNormalized,
            totalCostBasis: totalCost,
            lastUpdated: new Date(),
          })
          .where(
            and(
              eq(holdings.userId, userId),
              eq(holdings.assetType, assetType),
              eq(holdings.assetId, assetId),
            ),
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
        quantity: quantity.toString(),
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
    quantity: number,
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
            eq(holdings.assetId, assetId),
          ),
        )
        .for("update"); // SELECT ... FOR UPDATE - prevents concurrent reservations

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
            eq(holdingsLocks.assetId, assetId),
          ),
        );

      const totalLocked = Number(lockedResult[0]?.total || 0);
      const available = parseFloat(holding.quantity) - totalLocked;

      // Step 3: Check if sufficient shares are available
      if (available < quantity) {
        throw new Error(`Insufficient available shares: have ${available}, need ${quantity}`);
      }

      // Step 4: Create the lock (round quantity to nearest integer)
      const [lock] = await tx
        .insert(holdingsLocks)
        .values({
          userId,
          assetType,
          assetId,
          lockType,
          lockReferenceId,
          lockedQuantity: Math.round(quantity),
        })
        .returning();

      return lock;
    });
  }

  async releaseShares(lockId: string): Promise<void> {
    await db.delete(holdingsLocks).where(eq(holdingsLocks.id, lockId));
  }

  async releaseSharesByReference(lockReferenceId: string): Promise<void> {
    await db.delete(holdingsLocks).where(eq(holdingsLocks.lockReferenceId, lockReferenceId));
  }

  async getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number> {
    if (assetType === "player") {
      const [regularAvailable, multiplier] = await Promise.all([
        this.getRegularAvailableShares(userId, assetId),
        this.getPlayerMultiplier(userId, assetId),
      ]);

      return regularAvailable + (multiplier ? 1 : 0);
    }

    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${holdings.quantity} AS NUMERIC)), 0)` })
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetId),
        ),
      );

    const totalQuantity = Number(result[0]?.total || 0);
    const lockedQuantity = await this.getTotalLockedQuantity(userId, assetType, assetId);
    return Math.max(0, totalQuantity - lockedQuantity);
  }

  async getLockedShares(
    userId: string,
    assetType: string,
    assetId: string,
  ): Promise<HoldingsLock[]> {
    return await db
      .select()
      .from(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.userId, userId),
          eq(holdingsLocks.assetType, assetType),
          eq(holdingsLocks.assetId, assetId),
        ),
      );
  }

  async getTotalLockedQuantity(
    userId: string,
    assetType: string,
    assetId: string,
  ): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
      .from(holdingsLocks)
      .where(
        and(
          eq(holdingsLocks.userId, userId),
          eq(holdingsLocks.assetType, assetType),
          eq(holdingsLocks.assetId, assetId),
        ),
      );

    return Number(result[0]?.total || 0);
  }

  async adjustLockQuantity(lockReferenceId: string, newQuantity: number): Promise<void> {
    if (newQuantity <= 0) {
      await this.releaseSharesByReference(lockReferenceId);
    } else {
      await db
        .update(holdingsLocks)
        .set({ lockedQuantity: Math.round(newQuantity) })
        .where(eq(holdingsLocks.lockReferenceId, lockReferenceId));
    }
  }

  // Cash lock methods - prevent double-spending balance on buy orders
  async reserveCash(
    userId: string,
    lockType: string,
    lockReferenceId: string,
    amount: string,
  ): Promise<BalanceLock> {
    // CRITICAL: Use transaction with row-level lock to prevent race conditions
    return await db.transaction(async (tx) => {
      // Step 1: Lock the user row to prevent concurrent modifications
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update"); // SELECT ... FOR UPDATE - prevents concurrent reservations

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Step 2: Calculate available balance (total - locked)
      const totalLocked = await this.getTotalLockedBalance(userId, tx);
      const availableBalance = parseFloat(user.balance) - totalLocked;
      const requestedAmount = parseFloat(amount);

      if (availableBalance < requestedAmount) {
        throw new Error(
          `Insufficient available balance. Available: $${availableBalance.toFixed(2)}, Requested: $${requestedAmount.toFixed(2)}`,
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
    await db.delete(balanceLocks).where(eq(balanceLocks.id, lockId));
  }

  async releaseCashByReference(lockReferenceId: string): Promise<void> {
    await db.delete(balanceLocks).where(eq(balanceLocks.lockReferenceId, lockReferenceId));
  }

  async getAvailableBalance(userId: string, tx?: any): Promise<number> {
    const dbContext = tx || db;
    const [user] = await dbContext.select().from(users).where(eq(users.id, userId));

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

  async getBatchSentiment(
    playerIds: string[],
  ): Promise<Map<string, { buyPressure: number; totalVolume24h: number }>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    // AMM-only sentiment: derive "buy" vs "sell" pressure from executed trades.
    // Convention: in AMM trades, the pool is one side of the trade.
    // - User BUYs shares when sellerId === 'pool'
    // - User SELLs shares when buyerId === 'pool'
    // Non-pool trades are ignored for sentiment.
    const sentimentStats = await db
      .select({
        playerId: trades.playerId,
        buyVol: sql<number>`SUM(CASE WHEN ${trades.sellerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
        sellVol: sql<number>`SUM(CASE WHEN ${trades.buyerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
      })
      .from(trades)
      .where(
        and(
          inArray(trades.playerId, playerIds),
          gte(trades.executedAt, sql`NOW() - INTERVAL '24 hours'`),
        ),
      )
      .groupBy(trades.playerId);

    const sentimentMap = new Map();
    for (const s of sentimentStats) {
      const buyVol = Number(s.buyVol || 0);
      const sellVol = Number(s.sellVol || 0);
      const totalVol = buyVol + sellVol;
      const buyPressure = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;
      sentimentMap.set(s.playerId as string, { buyPressure, totalVolume24h: totalVol });
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

  async refreshPlayerMarketMetrics(playerIds?: string[]): Promise<number> {
    let targetPlayerIds = (playerIds || []).filter(Boolean);

    if (targetPlayerIds.length === 0) {
      const activePlayers = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.isActive, true));
      targetPlayerIds = activePlayers.map((p) => p.id);
    }

    targetPlayerIds = Array.from(new Set(targetPlayerIds));
    if (targetPlayerIds.length === 0) return 0;

    const [playerRows, sentimentMap, seasonStatsMap, allTimeAvgMap] = await Promise.all([
      db
        .select({
          id: players.id,
          lastTradePrice: players.lastTradePrice,
        })
        .from(players)
        .where(inArray(players.id, targetPlayerIds)),
      this.getBatchSentiment(targetPlayerIds),
      this.getBatchPlayerSeasonStatsFromLogs(targetPlayerIds),
      this.getBatchAllTimeAvgFantasyPoints(targetPlayerIds),
    ]);

    const playerPriceMap = new Map(
      playerRows.map((p) => [p.id, parseFloat(p.lastTradePrice || "0")]),
    );

    const LEAGUE_AVG_PE = 0.43;
    const now = new Date();
    const rows = targetPlayerIds.map((playerId) => {
      const sentiment = sentimentMap.get(playerId) || { buyPressure: 50, totalVolume24h: 0 };
      const seasonStats = seasonStatsMap.get(playerId) || {
        gamesPlayed: 0,
        avgFantasyPointsPerGame: "0.0",
      };
      const allTimeAvgFp = allTimeAvgMap.get(playerId) || 0;
      const price = playerPriceMap.get(playerId) || 0;
      const peRatio = allTimeAvgFp > 0 ? price / allTimeAvgFp : 0;
      const valueIndex = LEAGUE_AVG_PE > 0 ? (peRatio / LEAGUE_AVG_PE) * 100 : 0;

      return {
        playerId,
        avgFantasyPoints: (parseFloat(seasonStats.avgFantasyPointsPerGame || "0") || 0).toFixed(2),
        buyPressure: (sentiment.buyPressure || 50).toFixed(2),
        totalOrderVolume24h: Math.round(sentiment.totalVolume24h || 0),
        valueIndex: (valueIndex || 0).toFixed(2),
        bestBid: "0.00",
        bestAsk: "0.00",
        bidSize: 0,
        askSize: 0,
        updatedAt: now,
      };
    });

    await db
      .insert(playerMarketMetrics)
      .values(rows)
      .onConflictDoUpdate({
        target: playerMarketMetrics.playerId,
        set: {
          avgFantasyPoints: sql`excluded.avg_fantasy_points`,
          buyPressure: sql`excluded.buy_pressure`,
          totalOrderVolume24h: sql`excluded.total_order_volume_24h`,
          valueIndex: sql`excluded.value_index`,
          bestBid: sql`excluded.best_bid`,
          bestAsk: sql`excluded.best_ask`,
          bidSize: sql`excluded.bid_size`,
          askSize: sql`excluded.ask_size`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    return rows.length;
  }

  /**
   * Recompute players.volume24h as rolling 24h shares volume from AMM trades only.
   * Source of truth: AMM trades executed in the last 24 hours (pool is buyer or seller).
   */
  async refreshPlayerVolume24h(): Promise<number> {
    // 1) Update players with AMM trades in the window
    const updatedWithTrades: any = await db.execute(sql`
      WITH v AS (
        SELECT
          ${trades.playerId} AS player_id,
          COALESCE(ROUND(SUM(${trades.quantity}))::int, 0) AS vol
        FROM ${trades}
        WHERE ${trades.executedAt} >= NOW() - INTERVAL '24 hours'
          AND (${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool')
        GROUP BY ${trades.playerId}
      )
      UPDATE ${players} p
      SET ${players.volume24h} = v.vol,
          ${players.lastUpdated} = NOW()
      FROM v
      WHERE p.${players.id} = v.player_id;
    `);

    // 2) Zero out any players that previously had volume but no longer do
    const updatedZeroed: any = await db.execute(sql`
      UPDATE ${players} p
      SET ${players.volume24h} = 0,
          ${players.lastUpdated} = NOW()
      WHERE p.${players.volume24h} <> 0
        AND NOT EXISTS (
          SELECT 1
          FROM ${trades} t
          WHERE t.${trades.playerId} = p.${players.id}
            AND t.${trades.executedAt} >= NOW() - INTERVAL '24 hours'
            AND (t.${trades.buyerId} = 'pool' OR t.${trades.sellerId} = 'pool')
        );
    `);

    const c1 = typeof updatedWithTrades?.rowCount === "number" ? updatedWithTrades.rowCount : 0;
    const c2 = typeof updatedZeroed?.rowCount === "number" ? updatedZeroed.rowCount : 0;
    return c1 + c2;
  }

  // Trade methods
  async createTrade(trade: any): Promise<Trade> {
    const [created] = await db.insert(trades).values(trade).returning();
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
    return await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(limit);
  }

  async getMarketActivity(filters?: {
    playerId?: string;
    userId?: string;
    playerSearch?: string;
    limit?: number;
    sport?: string;
  }): Promise<any[]> {
    const { playerId, userId, playerSearch, limit = 50, sport } = filters || {};

    const buyer = alias(users, "buyer");
    const seller = alias(users, "seller");

    // AMM-only market activity: trades-only feed.
    const searchPattern = playerSearch ? `%${playerSearch}%` : null;
    const normalizedSport = sport?.toUpperCase() !== "ALL" ? sport?.toUpperCase() : null;

    // --- Trades Subquery ---
    const tradesBase = db
      .select({
        activityType: sql<string>`'trade'`.as("activityType"),
        id: trades.id,
        playerId: trades.playerId,
        playerFirstName: players.firstName,
        playerLastName: players.lastName,
        playerTeam: players.team,
        playerSport: players.sport,
        userId: sql<string>`NULL`.as("userId"),
        userUsername: sql<string>`NULL`.as("userUsername"),
        userAvatar: sql<string | null>`NULL`.as("userAvatar"),
        buyerId: trades.buyerId,
        buyerUsername:
          sql<string>`CASE WHEN ${trades.buyerId} = 'pool' THEN 'Pool' ELSE ${buyer.username} END`.as(
            "buyerUsername",
          ),
        sellerId: trades.sellerId,
        sellerUsername:
          sql<string>`CASE WHEN ${trades.sellerId} = 'pool' THEN 'Pool' ELSE ${seller.username} END`.as(
            "sellerUsername",
          ),
        side: sql<string>`NULL`.as("side"),
        orderType: sql<string>`NULL`.as("orderType"),
        quantity: trades.quantity,
        price: trades.price,
        limitPrice: sql<string>`NULL`.as("limitPrice"),
        timestamp: sql<Date>`${trades.executedAt}`.as("timestamp"),
      })
      .from(trades)
      .innerJoin(players, eq(trades.playerId, players.id))
      .leftJoin(buyer, eq(trades.buyerId, buyer.id))
      .leftJoin(seller, eq(trades.sellerId, seller.id));

    const tradesConditions = [];
    if (playerId) tradesConditions.push(eq(trades.playerId, playerId));
    if (userId) tradesConditions.push(or(eq(trades.buyerId, userId), eq(trades.sellerId, userId)));
    if (searchPattern)
      tradesConditions.push(
        sql`(${players.firstName} ILIKE ${searchPattern} OR ${players.lastName} ILIKE ${searchPattern})`,
      );
    if (normalizedSport) tradesConditions.push(sql`UPPER(${players.sport}) = ${normalizedSport}`);

    const finalTradesQuery =
      tradesConditions.length > 0 ? tradesBase.where(and(...tradesConditions)) : tradesBase;

    return await finalTradesQuery.orderBy(desc(trades.executedAt)).limit(limit);
  }

  // Price history methods
  async getPriceHistory(playerId: string, days: number = 30): Promise<PriceHistory[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return await db
      .select()
      .from(priceHistory)
      .where(
        and(eq(priceHistory.playerId, playerId), sql`${priceHistory.timestamp} >= ${startDate}`),
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
          sql`${priceHistory.timestamp} <= ${twentyFourHoursAgo}`,
        ),
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
      .where(and(eq(holdings.assetType, "player"), eq(holdings.assetId, playerId)));

    return parseInt(result?.totalShares || "0", 10);
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
    const [preset] = await db.select().from(vestingPresets).where(eq(vestingPresets.id, presetId));
    return preset || undefined;
  }

  async createVestingPreset(preset: InsertVestingPreset): Promise<VestingPreset> {
    const [created] = await db.insert(vestingPresets).values(preset).returning();
    return created;
  }

  async updateVestingPreset(
    presetId: string,
    updates: Partial<InsertVestingPreset>,
  ): Promise<VestingPreset | undefined> {
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
  async getUserActivity(
    userId: string,
    filters?: {
      types?: string[];
      limit?: number;
      offset?: number;
      includeBalanceAfter?: boolean;
    },
  ): Promise<any[]> {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    const types = filters?.types || ["vesting", "market", "scout"];
    const includeBalanceAfter = filters?.includeBalanceAfter ?? true;

    const activities: any[] = [];

    // 1. Vesting claims
    if (types.includes("vesting")) {
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

      claims.forEach((claim) => {
        activities.push({
          id: `vesting-${claim.id}`,
          userId,
          occurredAt: claim.occurredAt,
          category: "vesting",
          subtype: "claim",
          cashDelta: "0.00",
          sharesDelta: claim.sharesClaimed,
          metadata: {
            playerId: claim.playerId,
            playerName: claim.playerId
              ? `${claim.playerFirstName} ${claim.playerLastName}`
              : "Multiple Players",
            playerTeam: claim.playerTeam,
            sharesClaimed: claim.sharesClaimed,
          },
        });
      });
    }

    // 2. Trades (executed)
    if (types.includes("market")) {
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

      userBuyTrades.forEach((trade) => {
        const totalCost = parseFloat(trade.price) * parseFloat(trade.quantity);
        activities.push({
          id: `trade-buy-${trade.id}`,
          userId,
          occurredAt: trade.occurredAt,
          category: "market",
          subtype: "trade_buy",
          cashDelta: `-${totalCost.toFixed(2)}`,
          sharesDelta: trade.quantity,
          metadata: {
            playerId: trade.playerId,
            playerName: `${trade.playerFirstName} ${trade.playerLastName}`,
            playerTeam: trade.playerTeam,
            quantity: trade.quantity,
            tradePrice: trade.price,
            side: "buy",
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

      userSellTrades.forEach((trade) => {
        const totalRevenue = parseFloat(trade.price) * parseFloat(trade.quantity);
        activities.push({
          id: `trade-sell-${trade.id}`,
          userId,
          occurredAt: trade.occurredAt,
          category: "market",
          subtype: "trade_sell",
          cashDelta: `${totalRevenue.toFixed(2)}`,
          sharesDelta: -trade.quantity,
          metadata: {
            playerId: trade.playerId,
            playerName: `${trade.playerFirstName} ${trade.playerLastName}`,
            playerTeam: trade.playerTeam,
            quantity: trade.quantity,
            tradePrice: trade.price,
            side: "sell",
          },
        });
      });
    }

    // 4. Scout distributions (hourly share earnings)
    if (types.includes("scout")) {
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

      distributions.forEach((dist) => {
        activities.push({
          id: `scout-dist-${dist.id}`,
          userId,
          occurredAt: dist.occurredAt,
          category: "scout",
          subtype: "distribution",
          cashDelta: "0.00",
          sharesDelta: parseFloat(dist.sharesEarned?.toString() || "0"),
          metadata: {
            playerId: dist.playerId,
            playerName: dist.playerId
              ? `${dist.playerFirstName} ${dist.playerLastName}`
              : "Unknown Player",
            playerTeam: dist.playerTeam,
            sharesEarned: dist.sharesEarned,
          },
        });
      });
    }

    // Sort all activities by timestamp (most recent first) and apply pagination
    const sorted = activities.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    // Get current user balance for balance-after calculations
    let currentBalance = 0;
    if (includeBalanceAfter) {
      const user = await this.getUser(userId);
      if (!user) return [];
      currentBalance = parseFloat(user.balance);
    }

    // Process activities from most recent to oldest, adding descriptions and balance-after
    const enrichedActivities = sorted.slice(offset, offset + limit).map((activity: any) => {
      const cashDelta = activity.cashDelta ? parseFloat(activity.cashDelta) : 0;
      const balanceAfter = includeBalanceAfter ? currentBalance : null;

      // Move backwards through history (we're going DESC)
      if (includeBalanceAfter) {
        currentBalance -= cashDelta;
      }

      // Build description
      let description = "";
      const meta = activity.metadata;

      if (activity.category === "vesting") {
        description = `Claimed ${meta.sharesClaimed} shares${meta.playerName ? ` of ${meta.playerName}` : ""}`;
      } else if (activity.category === "market") {
        if (activity.subtype === "trade_buy") {
          description = `Bought ${meta.quantity} shares of ${meta.playerName} @ $${meta.tradePrice}`;
        } else if (activity.subtype === "trade_sell") {
          description = `Sold ${meta.quantity} shares of ${meta.playerName} @ $${meta.tradePrice}`;
        }
      } else if (activity.category === "scout") {
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
        balanceAfter: balanceAfter !== null ? balanceAfter.toFixed(2) : undefined,
        metadata: meta,
      };
    });

    return enrichedActivities;
  }

  // Daily games methods
  async upsertDailyGame(game: InsertDailyGame): Promise<DailyGame> {
    const [existing] = await db.select().from(dailyGames).where(eq(dailyGames.gameId, game.gameId));

    if (existing) {
      const [updated] = await db
        .update(dailyGames)
        .set({ ...game, lastFetchedAt: new Date() })
        .where(eq(dailyGames.gameId, game.gameId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(dailyGames).values(game).returning();
      return created;
    }
  }

  async getDailyGames(startDate: Date, endDate: Date, sport?: string): Promise<DailyGame[]> {
    const conditions = [
      sql`${dailyGames.startTime} >= ${startDate}`,
      sql`${dailyGames.startTime} < ${endDate}`,
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

  async updateDailyGameScore(
    gameId: string,
    homeScore: number,
    awayScore: number,
    status: string,
  ): Promise<void> {
    await db
      .update(dailyGames)
      .set({
        homeScore,
        awayScore,
        status,
        lastFetchedAt: new Date(),
      })
      .where(eq(dailyGames.gameId, gameId));
  }

  async getGamesByTeam(
    teamAbbreviation: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DailyGame[]> {
    return await db
      .select()
      .from(dailyGames)
      .where(
        and(
          sql`${dailyGames.startTime} >= ${startDate}`,
          sql`${dailyGames.startTime} < ${endDate}`,
          sql`(${dailyGames.homeTeam} = ${teamAbbreviation} OR ${dailyGames.awayTeam} = ${teamAbbreviation})`,
        ),
      )
      .orderBy(asc(dailyGames.startTime));
  }

  async getDailyGamesBySport(sport: string, startDate: Date, endDate: Date): Promise<DailyGame[]> {
    const conditions = [
      sql`${dailyGames.startTime} >= ${startDate}`,
      sql`${dailyGames.startTime} < ${endDate}`,
    ];

    // Only filter by sport if not "ALL" (case-insensitive)
    if (sport.toUpperCase() !== "ALL") {
      conditions.push(sql`UPPER(${dailyGames.sport}) = ${sport.toUpperCase()}`);
    }

    // Deduplicate by homeTeam, awayTeam, and startTime (within 5 min tolerance)
    // This handles legacy MySportsFeeds records (gameId starting with 18447) coexisting
    // with BallDontLie records (6-digit gameIds) for the same games.
    return await db
      .select()
      .from(dailyGames)
      .where(and(...conditions))
      .orderBy(asc(dailyGames.startTime))
      .then((games) => {
        const seen = new Map<string, DailyGame>();

        for (const game of games) {
          // Create a dedupe key using teams and startTime rounded to 5-min intervals
          const gameTime = new Date(game.startTime);
          const roundedTime = new Date(
            Math.round(gameTime.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000),
          );
          const key = `${game.homeTeam}-${game.awayTeam}-${roundedTime.toISOString()}`;

          const existing = seen.get(key);
          if (!existing) {
            seen.set(key, game);
            continue;
          }

          // Prefer canonical BDL records when both exist (prevents joins/settlement from using legacy IDs)
          seen.set(key, choosePreferredDailyGame(existing, game));
        }

        return Array.from(seen.values()).sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );
      });
  }

  async getDailyGameByGameId(gameId: string): Promise<DailyGame | undefined> {
    const [game] = await db.select().from(dailyGames).where(eq(dailyGames.gameId, gameId));
    return game || undefined;
  }

  async createDailyGame(game: InsertDailyGame): Promise<DailyGame> {
    const [created] = await db.insert(dailyGames).values(game).returning();
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
    const [created] = await db.insert(jobExecutionLogs).values(log).returning();
    return created;
  }

  async updateJobLog(id: string, updates: Partial<JobExecutionLog>): Promise<void> {
    await db.update(jobExecutionLogs).set(updates).where(eq(jobExecutionLogs.id, id));
  }

  async getRecentJobLogs(jobName?: string, limit: number = 50): Promise<JobExecutionLog[]> {
    let query = db.select().from(jobExecutionLogs).$dynamic();

    if (jobName) {
      query = query.where(eq(jobExecutionLogs.jobName, jobName));
    }

    return await query.orderBy(desc(jobExecutionLogs.scheduledFor)).limit(limit);
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
        and(eq(playerGameStats.playerId, stats.playerId), eq(playerGameStats.gameId, stats.gameId)),
      );

    if (existing) {
      const [updated] = await db
        .update(playerGameStats)
        .set({ ...stats, lastFetchedAt: new Date() })
        .where(eq(playerGameStats.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(playerGameStats).values(stats).returning();
      return created;
    }
  }

  async getPlayerGameStats(playerId: string, gameId: string): Promise<PlayerGameStats | undefined> {
    const [stats] = await db
      .select()
      .from(playerGameStats)
      .where(and(eq(playerGameStats.playerId, playerId), eq(playerGameStats.gameId, gameId)));
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
    return await db.select().from(playerGameStats).where(eq(playerGameStats.gameId, gameId));
  }

  async getPlayerGameStatsByGameAndHomeAway(
    gameId: string,
    homeAway: "home" | "away",
  ): Promise<PlayerGameStats[]> {
    return await db
      .select()
      .from(playerGameStats)
      .where(and(eq(playerGameStats.gameId, gameId), eq(playerGameStats.homeAway, homeAway)));
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
          lte(playerGameStats.gameDate, endOfDay),
        ),
      );

    return result[0]?.count || 0;
  }

  async getPlayerSeasonStatsFromLogs(playerId: string): Promise<any | null> {
    // Filter by current competitive season (regular + playoffs combined for rolling average)
    const [playerRow] = await db
      .select({ sport: players.sport })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    const currentSeasons = getCurrentCompetitiveSeasons(playerRow?.sport || "NBA");

    const gameLogs = await db
      .select()
      .from(playerGameStats)
      .where(
        and(
          eq(playerGameStats.playerId, playerId),
          inArray(playerGameStats.season, currentSeasons),
        ),
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

    if (sport === "NFL") {
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
        const stats = (log.statsJson as Record<string, any>) || {};
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
        sport: "NFL",
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
    } else if (sport === "MLB") {
      let totalAtBats = 0;
      let totalHits = 0;
      let totalRuns = 0;
      let totalRunsBattedIn = 0;
      let totalHomeRuns = 0;
      let totalStolenBases = 0;
      let totalWalks = 0;
      let totalStrikeoutsBatting = 0;
      let totalInningsPitched = 0;
      let totalPitchingStrikeouts = 0;
      let totalEarnedRuns = 0;
      let totalWins = 0;
      let totalSaves = 0;

      for (const log of gameLogs) {
        const stats = (log.statsJson as Record<string, any>) || {};
        totalFantasyPoints += parseFloat(log.fantasyPoints);

        totalAtBats += Number(stats.at_bats || 0);
        totalHits += Number(stats.hits || 0);
        totalRuns += Number(stats.runs || 0);
        totalRunsBattedIn += Number(stats.runs_batted_in || 0);
        totalHomeRuns += Number(stats.home_runs || 0);
        totalStolenBases += Number(stats.stolen_bases || 0);
        totalWalks += Number(stats.walks || 0);
        totalStrikeoutsBatting += Number(stats.strikeouts_batting || 0);
        totalInningsPitched += Number(stats.innings_pitched || 0);
        totalPitchingStrikeouts += Number(stats.pitching_strikeouts || 0);
        totalEarnedRuns += Number(stats.earned_runs || 0);
        totalWins += Number(stats.wins || 0);
        totalSaves += Number(stats.saves || 0);
      }

      const battingAverage = totalAtBats > 0 ? (totalHits / totalAtBats).toFixed(3) : "0.000";

      return {
        sport: "MLB",
        gamesPlayed,
        avgFantasyPointsPerGame: (totalFantasyPoints / gamesPlayed).toFixed(2),
        battingAverage,
        atBats: totalAtBats,
        hits: totalHits,
        runs: totalRuns,
        runsBattedIn: totalRunsBattedIn,
        homeRuns: totalHomeRuns,
        stolenBases: totalStolenBases,
        walks: totalWalks,
        strikeouts: totalStrikeoutsBatting,
        inningsPitched: Number(totalInningsPitched.toFixed(1)),
        pitchingStrikeouts: totalPitchingStrikeouts,
        earnedRuns: totalEarnedRuns,
        wins: totalWins,
        saves: totalSaves,
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

      const fieldGoalPct =
        totalFieldGoalsAttempted > 0
          ? ((totalFieldGoalsMade / totalFieldGoalsAttempted) * 100).toFixed(1)
          : "0.0";
      const threePointPct =
        totalThreePointersAttempted > 0
          ? ((totalThreePointersMade / totalThreePointersAttempted) * 100).toFixed(1)
          : "0.0";
      const freeThrowPct =
        totalFreeThrowsAttempted > 0
          ? ((totalFreeThrowsMade / totalFreeThrowsAttempted) * 100).toFixed(1)
          : "0.0";

      return {
        sport: "NBA",
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
  async getBatchPlayerSeasonStatsFromLogs(playerIds: string[]): Promise<
    Map<
      string,
      {
        gamesPlayed: number;
        avgFantasyPointsPerGame: string;
      }
    >
  > {
    if (playerIds.length === 0) {
      return new Map();
    }

    const playerRows = await db
      .select({ id: players.id, sport: players.sport })
      .from(players)
      .where(inArray(players.id, playerIds));

    const playerSportMap = new Map<string, string>();
    const playerIdsBySport = new Map<string, string[]>();
    for (const row of playerRows) {
      const sport = (row.sport || "NBA").toUpperCase();
      playerSportMap.set(row.id, sport);

      const sportPlayerIds = playerIdsBySport.get(sport) || [];
      sportPlayerIds.push(row.id);
      playerIdsBySport.set(sport, sportPlayerIds);
    }

    const currentSeasonBySport = new Map<string, Set<string>>();
    for (const sportName of new Set(Array.from(playerSportMap.values()))) {
      currentSeasonBySport.set(
        sportName.toUpperCase(),
        new Set(getCurrentCompetitiveSeasons(sportName)),
      );
    }

    const seasonScopedFilters = Array.from(playerIdsBySport.entries())
      .map(([sport, sportPlayerIds]) => {
        const seasons = Array.from(
          currentSeasonBySport.get(sport) || new Set(getCurrentCompetitiveSeasons(sport)),
        );
        if (sportPlayerIds.length === 0 || seasons.length === 0) return null;

        return and(
          inArray(playerGameStats.playerId, sportPlayerIds),
          inArray(playerGameStats.season, seasons),
        );
      })
      .filter(Boolean);

    // Fetch relevant game logs for all target players in one SQL query with season filtering.
    const filteredGameLogs =
      seasonScopedFilters.length > 0
        ? await db
            .select()
            .from(playerGameStats)
            .where(
              or(...(seasonScopedFilters as NonNullable<(typeof seasonScopedFilters)[number]>[])),
            )
        : [];

    const statsMap = new Map<
      string,
      {
        gamesPlayed: number;
        avgFantasyPointsPerGame: string;
      }
    >();

    for (const playerId of playerIds) {
      const playerLogs = filteredGameLogs.filter((log) => log.playerId === playerId);

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

    return gameLogs.map((log) => ({
      game: {
        id: (() => {
          const rawGameId = String(log.gameId || "");
          const numericId = rawGameId.includes("_")
            ? rawGameId.split("_").pop() || rawGameId
            : rawGameId;
          const parsed = Number.parseInt(numericId, 10);
          return Number.isFinite(parsed) ? parsed : 0;
        })(),
        date: log.gameDate.toISOString(),
        opponent: log.opponentTeam || "UNK",
        isHome: log.homeAway === "home",
      },
      stats:
        log.sport === "NFL"
          ? {
              // NFL Stats
              passingYards: (log.statsJson as any)?.passing_yards || 0,
              passingTouchdowns: (log.statsJson as any)?.passing_touchdowns || 0,
              rushingYards: (log.statsJson as any)?.rushing_yards || 0,
              rushingTouchdowns: (log.statsJson as any)?.rushing_touchdowns || 0,
              receivingYards: (log.statsJson as any)?.receiving_yards || 0,
              receivingTouchdowns: (log.statsJson as any)?.receiving_touchdowns || 0,
              fantasyPoints: parseFloat(log.fantasyPoints),
            }
          : log.sport === "MLB"
            ? {
                // MLB Stats
                atBats: (log.statsJson as any)?.at_bats || 0,
                hits: (log.statsJson as any)?.hits || 0,
                runs: (log.statsJson as any)?.runs || 0,
                runsBattedIn: (log.statsJson as any)?.runs_batted_in || 0,
                homeRuns: (log.statsJson as any)?.home_runs || 0,
                stolenBases: (log.statsJson as any)?.stolen_bases || 0,
                walks: (log.statsJson as any)?.walks || 0,
                strikeoutsBatting: (log.statsJson as any)?.strikeouts_batting || 0,
                inningsPitched: (log.statsJson as any)?.innings_pitched || 0,
                pitchingStrikeouts: (log.statsJson as any)?.pitching_strikeouts || 0,
                earnedRuns: (log.statsJson as any)?.earned_runs || 0,
                wins: (log.statsJson as any)?.wins || 0,
                saves: (log.statsJson as any)?.saves || 0,
                fantasyPoints: parseFloat(log.fantasyPoints),
              }
            : {
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
  async getBlogPosts(options: {
    limit: number;
    offset: number;
    publishedOnly: boolean;
  }): Promise<{ posts: BlogPost[]; total: number }> {
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
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.slug, slug));
    return post || undefined;
  }

  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const [created] = await db.insert(blogPosts).values(post).returning();
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
  async getAllUsersForRanking(): Promise<
    Array<{ userId: string; balance: string; portfolioValue: number }>
  > {
    const result: any = await db.execute(sql`
      SELECT
        u.id AS user_id,
        u.balance AS balance,
        COALESCE(
          SUM(pos.effective_shares * COALESCE(p.last_trade_price::numeric, 0)),
          0
        )::text AS portfolio_value
      FROM ${users} u
      LEFT JOIN (
        SELECT
          ${holdings.userId} AS user_id,
          ${holdings.assetId} AS player_id,
          ${holdings.quantity}::numeric AS effective_shares
        FROM ${holdings}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0

        UNION ALL

        SELECT
          ${playerMultipliers.userId} AS user_id,
          ${playerMultipliers.playerId} AS player_id,
          ${playerMultipliers.multiplier}::numeric AS effective_shares
        FROM ${playerMultipliers}
        WHERE ${playerMultipliers.multiplier} > 0
      ) pos
        ON pos.user_id = u.id
      LEFT JOIN ${players} p
        ON p.id = pos.player_id
      GROUP BY u.id, u.balance
    `);

    const rows = result?.rows ?? result;
    return rows.map((row: any) => ({
      userId: row.user_id ?? row.userId,
      balance: row.balance,
      portfolioValue: parseFloat(row.portfolio_value ?? row.portfolioValue ?? "0"),
    }));
  }

  async getUserTradingVolumeSince(startDate: Date): Promise<Map<string, number>> {
    const result: any = await db.execute(sql`
      SELECT
        user_id,
        COALESCE(SUM(volume), 0)::text AS volume
      FROM (
        SELECT
          ${trades.buyerId} AS user_id,
          (${trades.quantity}::numeric * ${trades.price}::numeric) AS volume
        FROM ${trades}
        WHERE ${trades.executedAt} >= ${startDate}
          AND ${trades.buyerId} <> 'pool'

        UNION ALL

        SELECT
          ${trades.sellerId} AS user_id,
          (${trades.quantity}::numeric * ${trades.price}::numeric) AS volume
        FROM ${trades}
        WHERE ${trades.executedAt} >= ${startDate}
          AND ${trades.sellerId} <> 'pool'
      ) user_trade_volume
      GROUP BY user_id
    `);

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    return new Map(
      rows.map((row: { user_id: string; volume: string }) => [
        row.user_id,
        parseFloat(row.volume || "0"),
      ]),
    );
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
          lte(portfolioSnapshots.snapshotDate, endOfDay),
        ),
      )
      .orderBy(desc(portfolioSnapshots.snapshotDate))
      .limit(1);
    return snapshot || undefined;
  }

  async getLatestSnapshotRanks(): Promise<
    Map<
      string,
      { cashRank: number | null; portfolioRank: number | null; netWorthRank: number | null }
    >
  > {
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
        netWorthRank: snapshot.netWorthRank,
      });
    }

    return rankMap;
  }

  async getPortfolioSnapshotsInRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PortfolioSnapshot[]> {
    const snapshots = await db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.userId, userId),
          gte(portfolioSnapshots.snapshotDate, startDate),
          lte(portfolioSnapshots.snapshotDate, endDate),
        ),
      )
      .orderBy(asc(portfolioSnapshots.snapshotDate));
    return snapshots;
  }

  async createPortfolioSnapshot(snapshot: InsertPortfolioSnapshot): Promise<PortfolioSnapshot> {
    const [created] = await db.insert(portfolioSnapshots).values(snapshot).returning();
    return created;
  }

  // Analytics methods
  async getMarketHealthStats(
    startDate: Date,
    endDate: Date,
  ): Promise<{
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
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as("volume"),
      })
      .from(trades)
      .where(and(gte(trades.executedAt, startDate), lte(trades.executedAt, endDate)));

    // Previous period trades
    const prevTrades = await db
      .select({
        count: count(),
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as("volume"),
      })
      .from(trades)
      .where(and(gte(trades.executedAt, prevStartDate), lte(trades.executedAt, prevEndDate)));

    // Total market cap = sum of (all shares held * last trade price)
    const marketCapResult: any = await db.execute(sql`
      SELECT
        COALESCE(
          SUM(pos.effective_shares * COALESCE(p.last_trade_price::numeric, p.current_price::numeric, 0)),
          0
        )::text AS market_cap
      FROM (
        SELECT
          ${holdings.assetId} AS player_id,
          ${holdings.quantity}::numeric AS effective_shares
        FROM ${holdings}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0

        UNION ALL

        SELECT
          ${playerMultipliers.playerId} AS player_id,
          ${playerMultipliers.multiplier}::numeric AS effective_shares
        FROM ${playerMultipliers}
        WHERE ${playerMultipliers.multiplier} > 0
      ) pos
      INNER JOIN ${players} p ON p.id = pos.player_id
    `);
    const marketCapRows = marketCapResult?.rows ?? marketCapResult;

    // Get previous period's market cap from snapshots
    const prevMarketCapSnapshot = await db
      .select({
        marketCap: marketSnapshots.marketCap,
      })
      .from(marketSnapshots)
      .where(lte(marketSnapshots.snapshotDate, prevStartDate))
      .orderBy(desc(marketSnapshots.snapshotDate))
      .limit(1);

    return {
      transactionCount: currentTrades[0]?.count || 0,
      totalVolume: parseFloat(currentTrades[0]?.volume || "0"),
      totalMarketCap: parseFloat(
        marketCapRows[0]?.market_cap ?? marketCapRows[0]?.marketCap ?? "0",
      ),
      prevTransactionCount: prevTrades[0]?.count || 0,
      prevTotalVolume: parseFloat(prevTrades[0]?.volume || "0"),
      prevTotalMarketCap: prevMarketCapSnapshot[0]
        ? parseFloat(prevMarketCapSnapshot[0].marketCap)
        : parseFloat(marketCapRows[0]?.market_cap ?? marketCapRows[0]?.marketCap ?? "0"), // Fallback to current if no historical data
    };
  }

  async getMarketHealthTimeSeries(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      date: string;
      transactions: number;
      volume: number;
      marketCap: number;
    }>
  > {
    // Group trades by day
    const dailyStats = await db
      .select({
        date: sql<string>`DATE(${trades.executedAt})`.as("date"),
        transactions: count(),
        volume: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`.as("volume"),
      })
      .from(trades)
      .where(and(gte(trades.executedAt, startDate), lte(trades.executedAt, endDate)))
      .groupBy(sql`DATE(${trades.executedAt})`)
      .orderBy(sql`DATE(${trades.executedAt})`);

    // Get current market cap (we don't have historical snapshots yet)
    const marketCapResult: any = await db.execute(sql`
      SELECT
        COALESCE(
          SUM(pos.effective_shares * COALESCE(p.last_trade_price::numeric, p.current_price::numeric, 0)),
          0
        )::text AS market_cap
      FROM (
        SELECT
          ${holdings.assetId} AS player_id,
          ${holdings.quantity}::numeric AS effective_shares
        FROM ${holdings}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0

        UNION ALL

        SELECT
          ${playerMultipliers.playerId} AS player_id,
          ${playerMultipliers.multiplier}::numeric AS effective_shares
        FROM ${playerMultipliers}
        WHERE ${playerMultipliers.multiplier} > 0
      ) pos
      INNER JOIN ${players} p ON p.id = pos.player_id
    `);
    const marketCapRows = marketCapResult?.rows ?? marketCapResult;
    const currentMarketCap = parseFloat(
      marketCapRows[0]?.market_cap ?? marketCapRows[0]?.marketCap ?? "0",
    );

    return dailyStats.map((row) => ({
      date: row.date,
      transactions: row.transactions,
      volume: parseFloat(row.volume || "0"),
      marketCap: currentMarketCap, // Same for all days (no historical tracking)
    }));
  }

  async getPlayerSharesOutstanding(playerIds?: string[]): Promise<Map<string, number>> {
    const filterClause =
      playerIds && playerIds.length > 0 ? sql`WHERE player_id = ANY(${playerIds})` : sql``;

    const results: any = await db.execute(sql`
      SELECT
        player_id,
        COALESCE(SUM(effective_shares), 0)::text AS total_shares
      FROM (
        SELECT
          ${holdings.assetId} AS player_id,
          ${holdings.quantity}::numeric AS effective_shares
        FROM ${holdings}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0

        UNION ALL

        SELECT
          ${playerMultipliers.playerId} AS player_id,
          ${playerMultipliers.multiplier}::numeric AS effective_shares
        FROM ${playerMultipliers}
        WHERE ${playerMultipliers.multiplier} > 0
      ) player_positions
      ${filterClause}
      GROUP BY player_id
    `);
    const sharesMap = new Map<string, number>();
    const rows = results?.rows ?? results;
    for (const row of rows) {
      sharesMap.set(
        row.player_id ?? row.playerId,
        parseInt(row.total_shares ?? row.totalShares) || 0,
      );
    }
    return sharesMap;
  }

  async getHotColdPlayers(limit: number): Promise<{ hot: Player[]; cold: Player[] }> {
    // Hot players: biggest positive price change
    const hotPlayers = await db
      .select()
      .from(players)
      .where(and(eq(players.isActive, true), sql`${players.priceChange24h} > 0`))
      .orderBy(desc(players.priceChange24h))
      .limit(limit);

    // Cold players: biggest negative price change
    const coldPlayers = await db
      .select()
      .from(players)
      .where(and(eq(players.isActive, true), sql`${players.priceChange24h} < 0`))
      .orderBy(asc(players.priceChange24h))
      .limit(limit);

    return { hot: hotPlayers, cold: coldPlayers };
  }

  async getHeatmapData(): Promise<
    Array<{
      team: string;
      position: string;
      avgPriceChange: number;
      playerCount: number;
      topPlayer: string;
    }>
  > {
    // Aggregate price changes by team and position
    const heatmapData = await db
      .select({
        team: players.team,
        position: players.position,
        avgPriceChange: sql<string>`AVG(${players.priceChange24h})`.as("avg_price_change"),
        playerCount: count(),
        topPlayer: sql<string>`(
          SELECT CONCAT(p2.first_name, ' ', p2.last_name)
          FROM players p2
          WHERE p2.team = ${players.team} AND p2.position = ${players.position} AND p2.is_active = true
          ORDER BY p2.price_change_24h DESC
          LIMIT 1
        )`.as("top_player"),
      })
      .from(players)
      .where(eq(players.isActive, true))
      .groupBy(players.team, players.position)
      .orderBy(players.team, players.position);

    return heatmapData.map((row) => ({
      team: row.team,
      position: row.position,
      avgPriceChange: parseFloat(row.avgPriceChange || "0"),
      playerCount: row.playerCount,
      topPlayer: row.topPlayer || "N/A",
    }));
  }

  async getPowerRankings(limit: number = 50): Promise<
    Array<{
      playerId: string;
      name: string;
      team: string;
      position: string;
      price: number;
      priceChange7d: number;
      volume: number;
      avgFantasyPoints: number;
      compositeScore: number;
    }>
  > {
    // Get active players with their stats
    const activePlayers = await db.select().from(players).where(eq(players.isActive, true));

    // Get fantasy points averages for each player
    const fantasyStats = await db
      .select({
        playerId: playerGameStats.playerId,
        avgFantasyPoints: sql<string>`AVG(${playerGameStats.fantasyPoints})`.as("avg_fantasy"),
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
    const rankings = activePlayers.map((player) => {
      const fantasyData = fantasyMap.get(player.id) || { avgFantasy: 0, gamesPlayed: 0 };

      // Normalize values (0-100 scale)
      const priceChange = parseFloat(player.priceChange24h || "0");
      const volume = player.volume24h || 0;
      const avgFantasy = fantasyData.avgFantasy;

      // Simple normalization (can be improved with z-scores)
      const priceMomentumScore = Math.min(Math.max(((priceChange + 20) / 40) * 100, 0), 100); // -20% to +20% mapped to 0-100
      const volumeScore = Math.min((volume / 100) * 100, 100); // 0-100+ shares mapped to 0-100
      const fantasyScore = Math.min((avgFantasy / 50) * 100, 100); // 0-50 fantasy pts mapped to 0-100

      const compositeScore = priceMomentumScore * 0.4 + volumeScore * 0.3 + fantasyScore * 0.3;

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
    return rankings.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, limit);
  }

  async getShareEconomyStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalSharesVested: number;
    totalSharesScouted: number;
    totalSharesBurned: number;
    totalSharesInEconomy: number;
    periodSharesVested: number;
    periodSharesScouted: number;
    periodsharesVested: number;
    periodSharesBurned: number;
  }> {
    // Total shares vested all time (vesting claims from automatic vesting)
    const totalVestedResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as("total"),
      })
      .from(vestingClaims);
    const totalSharesVested = parseInt(totalVestedResult[0]?.total || "0");

    // Total shares scouted all time (active scout distributions)
    const totalScoutedResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as("total"),
      })
      .from(scoutDistributions);
    const totalSharesScouted = Math.floor(parseFloat(totalScoutedResult[0]?.total || "0"));

    // Total shares in economy (all holdings)
    const totalHoldingsResult: any = await db.execute(sql`
      SELECT
        COALESCE(SUM(effective_shares), 0)::text AS total
      FROM (
        SELECT ${holdings.quantity}::numeric AS effective_shares
        FROM ${holdings}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0

        UNION ALL

        SELECT ${playerMultipliers.multiplier}::numeric AS effective_shares
        FROM ${playerMultipliers}
        WHERE ${playerMultipliers.multiplier} > 0
      ) player_positions
    `);
    const totalHoldingsRows = totalHoldingsResult?.rows ?? totalHoldingsResult;
    const totalSharesInEconomy = parseInt(totalHoldingsRows[0]?.total || "0");

    // Total shares burned = shares used in Daily Boosts that have started processing.
    const totalBurnedBoostsResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${dailyBoosts.sharesEntered}), 0)`.as("total"),
      })
      .from(dailyBoosts)
      .where(inArray(dailyBoosts.status, ["locked", "processed"]));
    const totalSharesBurned = parseInt(totalBurnedBoostsResult[0]?.total || "0");

    // Period stats (if dates provided)
    let periodSharesVested = 0;
    let periodSharesScouted = 0;
    let periodSharesBurned = 0;

    if (startDate && endDate) {
      const periodVestedResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as("total"),
        })
        .from(vestingClaims)
        .where(and(gte(vestingClaims.claimedAt, startDate), lte(vestingClaims.claimedAt, endDate)));
      periodSharesVested = parseInt(periodVestedResult[0]?.total || "0");

      const periodScoutedResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as("total"),
        })
        .from(scoutDistributions)
        .where(
          and(
            gte(scoutDistributions.hourTimestamp, startDate),
            lte(scoutDistributions.hourTimestamp, endDate),
          ),
        );
      periodSharesScouted = Math.floor(parseFloat(periodScoutedResult[0]?.total || "0"));

      const periodBurnedBoostsResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${dailyBoosts.sharesEntered}), 0)`.as("total"),
        })
        .from(dailyBoosts)
        .where(
          and(
            inArray(dailyBoosts.status, ["locked", "processed"]),
            gte(dailyBoosts.boostDate, startDate),
            lte(dailyBoosts.boostDate, endDate),
          ),
        );

      periodSharesBurned = parseInt(periodBurnedBoostsResult[0]?.total || "0");
    }

    return {
      totalSharesVested,
      totalSharesScouted,
      totalSharesBurned,
      totalSharesInEconomy,
      periodSharesVested,
      periodSharesScouted,
      periodsharesVested: periodSharesVested,
      periodSharesBurned,
    };
  }

  async getShareEconomyTimeSeries(
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      date: string;
      sharesVested: number;
      sharesScouted: number;
      sharesBurned: number;
    }[]
  > {
    // Get shares vested by date
    const vestedByDate = await db
      .select({
        date: sql<string>`DATE(${vestingClaims.claimedAt})`.as("date"),
        shares: sql<string>`COALESCE(SUM(${vestingClaims.sharesClaimed}), 0)`.as("shares"),
      })
      .from(vestingClaims)
      .where(and(gte(vestingClaims.claimedAt, startDate), lte(vestingClaims.claimedAt, endDate)))
      .groupBy(sql`DATE(${vestingClaims.claimedAt})`)
      .orderBy(sql`DATE(${vestingClaims.claimedAt})`);

    // Get shares scouted by date
    const scoutedByDate = await db
      .select({
        date: sql<string>`DATE(${scoutDistributions.hourTimestamp})`.as("date"),
        shares: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as("shares"),
      })
      .from(scoutDistributions)
      .where(
        and(
          gte(scoutDistributions.hourTimestamp, startDate),
          lte(scoutDistributions.hourTimestamp, endDate),
        ),
      )
      .groupBy(sql`DATE(${scoutDistributions.hourTimestamp})`)
      .orderBy(sql`DATE(${scoutDistributions.hourTimestamp})`);

    // Get shares burned by Daily Boost date in current system (locked/processed only)
    const burnedByDate = await db
      .select({
        date: sql<string>`DATE(${dailyBoosts.boostDate})`.as("date"),
        shares: sql<string>`COALESCE(SUM(${dailyBoosts.sharesEntered}), 0)`.as("shares"),
      })
      .from(dailyBoosts)
      .where(
        and(
          inArray(dailyBoosts.status, ["locked", "processed"]),
          gte(dailyBoosts.boostDate, startDate),
          lte(dailyBoosts.boostDate, endDate),
        ),
      )
      .groupBy(sql`DATE(${dailyBoosts.boostDate})`)
      .orderBy(sql`DATE(${dailyBoosts.boostDate})`);

    // Add all vested dates
    const dateMap = new Map<
      string,
      { sharesVested: number; sharesScouted: number; sharesBurned: number }
    >();
    for (const row of vestedByDate) {
      const dateStr = row.date;
      dateMap.set(dateStr, {
        sharesVested: parseInt(row.shares || "0"),
        sharesScouted: 0,
        sharesBurned: 0,
      });
    }

    // Add/merge scouted dates
    for (const row of scoutedByDate) {
      const dateStr = row.date;
      const existing = dateMap.get(dateStr) || {
        sharesVested: 0,
        sharesScouted: 0,
        sharesBurned: 0,
      };
      existing.sharesScouted += Math.floor(parseFloat(row.shares || "0"));
      dateMap.set(dateStr, existing);
    }

    // Add/merge burned dates
    for (const row of burnedByDate) {
      const dateStr = row.date;
      const existing = dateMap.get(dateStr) || {
        sharesVested: 0,
        sharesScouted: 0,
        sharesBurned: 0,
      };
      existing.sharesBurned += parseInt(row.shares || "0");
      dateMap.set(dateStr, existing);
    }

    // Sort by date and convert to array
    const sortedDates = Array.from(dateMap.keys()).sort();
    return sortedDates.map((date) => ({
      date,
      sharesVested: dateMap.get(date)?.sharesVested || 0,
      sharesScouted: dateMap.get(date)?.sharesScouted || 0,
      sharesBurned: dateMap.get(date)?.sharesBurned || 0,
    }));
  }

  // Premium checkout session methods
  async createPremiumCheckoutSession(session: {
    userId: string;
    planId: string;
    quantity: number;
    amountCents: number;
    whopSessionId?: string;
  }): Promise<PremiumCheckoutSession> {
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

  async getPremiumCheckoutSessionByReceipt(
    receiptId: string,
  ): Promise<PremiumCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(premiumCheckoutSessions)
      .where(eq(premiumCheckoutSessions.receiptId, receiptId));
    return session || undefined;
  }

  async completePremiumCheckoutSession(
    id: string,
    receiptId: string,
  ): Promise<PremiumCheckoutSession | undefined> {
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
  async createCommunityCheckoutSession(session: {
    userId: string;
    planId: string;
    quantity: number;
    amountCents: number;
    whopSessionId?: string;
  }): Promise<CommunityCheckoutSession> {
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

  async getCommunityCheckoutSessionByReceipt(
    receiptId: string,
  ): Promise<CommunityCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(communityCheckoutSessions)
      .where(eq(communityCheckoutSessions.receiptId, receiptId));
    return session || undefined;
  }

  async completeCommunityCheckoutSession(
    id: string,
    receiptId: string,
  ): Promise<CommunityCheckoutSession | undefined> {
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

  // Premium market data (read-only)
  async getPremiumTradesInRange(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      buyerId: string;
      sellerId: string;
      quantity: number;
      price: string;
      executedAt: Date;
    }>
  > {
    const trades = await db
      .select()
      .from(premiumTrades)
      .where(and(gte(premiumTrades.executedAt, startDate), lte(premiumTrades.executedAt, endDate)))
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
      .where(
        and(
          eq(whopPayments.email, email.toLowerCase()),
          eq(whopPayments.whopStatus, "paid"),
          sql`${whopPayments.creditedAt} IS NULL`,
        ),
      )
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
      .where(and(eq(whopPayments.paymentId, paymentId), sql`${whopPayments.creditedAt} IS NULL`))
      .returning();
    return updated || undefined;
  }

  async revokeWhopPayment(
    paymentId: string,
    revokedQuantity: number,
    liabilityQuantity?: number,
  ): Promise<WhopPayment | undefined> {
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

  async updateWhopPaymentStatus(
    paymentId: string,
    whopStatus: string,
  ): Promise<WhopPayment | undefined> {
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

    // AMM-only sentiment: compute from executed trades against the pool.
    // - User BUYs shares when sellerId === 'pool'
    // - User SELLs shares when buyerId === 'pool'
    const [sentimentRow] = await db
      .select({
        buyVol: sql<number>`SUM(CASE WHEN ${trades.sellerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
        sellVol: sql<number>`SUM(CASE WHEN ${trades.buyerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
      })
      .from(trades)
      .where(and(eq(trades.playerId, playerId), gte(trades.executedAt, twentyFourHoursAgo)));

    const buyVol = Number(sentimentRow?.buyVol || 0);
    const sellVol = Number(sentimentRow?.sellVol || 0);
    const totalVol = buyVol + sellVol;
    const buyPressure = totalVol > 0 ? (buyVol / totalVol) * 100 : 50; // Default to neutral 50

    let sentimentTrend: "bullish" | "bearish" | "neutral" = "neutral";
    if (buyPressure >= 60) sentimentTrend = "bullish";
    else if (buyPressure <= 40) sentimentTrend = "bearish";

    // --- HEAT CHECK ---
    const recentGames = await this.getPlayerRecentGamesFromLogs(playerId, 5);
    let l5Avg = 0;
    if (recentGames.length > 0) {
      const sum = recentGames.reduce((acc, g) => acc + Number(g.fantasyPoints), 0);
      l5Avg = sum / recentGames.length;
    }

    let heatStatus: "fire" | "ice" | "neutral" = "neutral";
    if (avgFantasyPoints > 0) {
      const diff = (l5Avg - avgFantasyPoints) / avgFantasyPoints;
      if (diff >= 0.15)
        heatStatus = "fire"; // 15% better than season avg
      else if (diff <= -0.15) heatStatus = "ice"; // 15% worse
    }

    // --- MARKET CAP RANK ---
    // Simple heuristic for now until we have global rank query
    // Top tier > $100k cap (assuming lots of shares * price)
    // This is a placeholder logic that should eventually be a percentile query
    const totalShares = await this.getTotalSharesForPlayer(playerId);
    const mktCap = totalShares * currentPrice;

    let tier: "blue_chip" | "mid_cap" | "moonshot" = "mid_cap";
    if (mktCap > 50000) tier = "blue_chip";
    else if (mktCap < 5000) tier = "moonshot";

    // Mock percentile for now
    const percentile = 50;

    return {
      peRatio,
      valueIndex,
      isUndervalued,
      sentiment: {
        buyPressure,
        totalVolume24h: totalVol,
        trend: sentimentTrend,
      },
      heatCheck: {
        l5Avg,
        seasonAvg: avgFantasyPoints,
        status: heatStatus,
      },
      marketCapRank: {
        tier,
        percentile,
      },
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
        count: sql<string>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)`.as("total_scouts"),
      })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(
        and(
          inArray(scoutAssignments.playerId, playerIds),
          gte(users.lastActiveAt, twentyFourHoursAgo),
        ),
      )
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
    const ammSpotPriceNumericExpr = sql<number>`CASE
      WHEN ${playerPools.shares} > 0 THEN (${playerPools.playMoney} / ${playerPools.shares})
      ELSE NULL
    END`;
    const ammSpotPriceTextExpr = sql<string>`(${ammSpotPriceNumericExpr})::text`;

    const whereClause =
      normalizedSport === "ALL"
        ? and(
            eq(players.isActive, true),
            sql`${playerPools.playerId} IS NOT NULL`,
            gt(playerPools.shares, "0"),
            gt(playerPools.playMoney, "0"),
          )
        : and(
            eq(players.isActive, true),
            sql`${playerPools.playerId} IS NOT NULL`,
            gt(playerPools.shares, "0"),
            gt(playerPools.playMoney, "0"),
            sql`UPPER(${players.sport}) = ${normalizedSport}`,
          );

    const activePlayers = await db
      .select({
        id: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        position: players.position,
        sport: players.sport,
        currentPrice: ammSpotPriceTextExpr,
        lastTradePrice: sql<string>`COALESCE(${players.lastTradePrice}, ${ammSpotPriceNumericExpr})::text`,
        volume24h: players.volume24h,
        priceChange24h: players.priceChange24h,
        marketCap: players.marketCap,
        avgPoints: sql<string>`AVG(CAST(${playerGameStats.fantasyPoints} AS numeric))`,
      })
      .from(players)
      .leftJoin(playerPools, eq(playerPools.playerId, players.id))
      .leftJoin(playerGameStats, eq(players.id, playerGameStats.playerId))
      .where(whereClause)
      .groupBy(players.id, playerPools.playerId, playerPools.shares, playerPools.playMoney);

    // 2. Bulk Fetch Sentiment (AMM-only) based on executed pool trades in last 24h
    const sentimentStats = await db
      .select({
        playerId: trades.playerId,
        buyVol: sql<number>`SUM(CASE WHEN ${trades.sellerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
        sellVol: sql<number>`SUM(CASE WHEN ${trades.buyerId} = 'pool' THEN ${trades.quantity} ELSE 0 END)`,
      })
      .from(trades)
      .where(gte(trades.executedAt, sql`NOW() - INTERVAL '24 hours'`))
      .groupBy(trades.playerId);

    const sentimentMap = new Map(sentimentStats.map((s) => [s.playerId, s]));

    // 3. Process Metrics
    const LEAGUE_AVG_PE = 0.43;
    const processed = activePlayers.map((p) => {
      const price = parseFloat(p.lastTradePrice as string);
      const avgFP = p.avgPoints ? parseFloat(p.avgPoints) : 0;
      const peRatio = avgFP > 0 ? price / avgFP : 0;
      const valueIndex = LEAGUE_AVG_PE > 0 ? (peRatio / LEAGUE_AVG_PE) * 100 : 0;

      const sent = sentimentMap.get(p.id);
      const buyVol = Number(sent?.buyVol || 0);
      const sellVol = Number(sent?.sellVol || 0);
      const totalVol = buyVol + sellVol;
      const buyPressure = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;

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
            totalVolume24h: totalVol,
            trend: buyPressure >= 60 ? "bullish" : buyPressure <= 40 ? "bearish" : "neutral",
          } as any,
          heatCheck: { status: "neutral" } as any,
          marketCapRank: { tier: "mid_cap" } as any,
        },
      };
    });

    // 4. Sort and Slice
    const undervalued = processed
      .filter((x) => x.metrics.valueIndex > 0 && x.metrics.valueIndex < 100)
      .sort((a, b) => a.metrics.valueIndex - b.metrics.valueIndex)
      .slice(0, 10);

    const premium = processed
      .filter((x) => x.metrics.valueIndex > 100)
      .sort((a, b) => b.metrics.valueIndex - a.metrics.valueIndex)
      .slice(0, 10);

    const sentiment = processed
      .filter((x) => x.metrics.sentiment.totalVolume24h > 10)
      .sort((a, b) => b.metrics.sentiment.buyPressure - a.metrics.sentiment.buyPressure)
      .slice(0, 10);

    const momentum = processed
      .sort((a, b) => parseFloat(b.player.priceChange24h) - parseFloat(a.player.priceChange24h))
      .slice(0, 10);

    return { undervalued, premium, sentiment, momentum };
  }
  async getTradeHistory(userId: string): Promise<Trade[]> {
    return await db
      .select()
      .from(trades)
      .where(or(eq(trades.buyerId, userId), eq(trades.sellerId, userId)))
      .orderBy(desc(trades.executedAt))
      .limit(100);
  }

  async getWatchList(userId: string): Promise<string[]> {
    // Returns all player IDs across all watchlists for the user
    const results = await db
      .select({ playerId: watchList.playerId })
      .from(watchList)
      .where(eq(watchList.userId, userId));
    return results.map((r) => r.playerId);
  }

  async addToWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void> {
    // If no watchlistId provided, use the default "Favorites" watchlist
    let targetWatchlistId = watchlistId;
    if (!targetWatchlistId) {
      targetWatchlistId = await this.ensureDefaultWatchlist(userId);
    }

    // Check if already in this watchlist to avoid duplicates
    const [exists] = await db
      .select()
      .from(watchList)
      .where(
        and(
          eq(watchList.userId, userId),
          eq(watchList.playerId, playerId),
          eq(watchList.watchlistId, targetWatchlistId),
        ),
      )
      .limit(1);
    if (exists) return;

    await db.insert(watchList).values({ userId, playerId, watchlistId: targetWatchlistId });
  }

  async removeFromWatchList(userId: string, playerId: string, watchlistId?: string): Promise<void> {
    if (watchlistId) {
      // Remove from specific watchlist
      await db
        .delete(watchList)
        .where(
          and(
            eq(watchList.userId, userId),
            eq(watchList.playerId, playerId),
            eq(watchList.watchlistId, watchlistId),
          ),
        );
    } else {
      // Remove from all watchlists
      await db
        .delete(watchList)
        .where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId)));
    }
  }

  async isOnWatchList(userId: string, playerId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(watchList)
      .where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId)))
      .limit(1);
    return !!result;
  }

  async getWatchlists(
    userId: string,
  ): Promise<
    { id: string; name: string; isDefault: boolean; color: string | null; itemCount: number }[]
  > {
    const results = await db
      .select({
        id: watchlists.id,
        name: watchlists.name,
        isDefault: watchlists.isDefault,
        color: watchlists.color,
        itemCount:
          sql<number>`(SELECT COUNT(*) FROM watch_list WHERE watchlist_id = watchlists.id)`.as(
            "item_count",
          ),
      })
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(desc(watchlists.isDefault), watchlists.name);

    return results;
  }

  async createWatchlist(
    userId: string,
    name: string,
    isDefault?: boolean,
    color?: string,
  ): Promise<{ id: string; name: string }> {
    const [result] = await db
      .insert(watchlists)
      .values({
        userId,
        name,
        isDefault: isDefault || false,
        color,
      })
      .returning({ id: watchlists.id, name: watchlists.name });
    return result;
  }

  async updateWatchlist(
    watchlistId: string,
    updates: { name?: string; color?: string },
  ): Promise<void> {
    await db.update(watchlists).set(updates).where(eq(watchlists.id, watchlistId));
  }

  async deleteWatchlist(watchlistId: string): Promise<void> {
    // Items will cascade delete due to FK constraint
    await db.delete(watchlists).where(eq(watchlists.id, watchlistId));
  }

  async ensureDefaultWatchlist(userId: string): Promise<string> {
    // Check if user has a default watchlist
    const [existing] = await db
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)))
      .limit(1);

    if (existing) return existing.id;

    // Create default "Favorites" watchlist
    const [created] = await db
      .insert(watchlists)
      .values({
        userId,
        name: "Favorites",
        isDefault: true,
      })
      .returning({ id: watchlists.id });

    return created.id;
  }

  async getWatchlistItems(watchlistId: string): Promise<string[]> {
    const results = await db
      .select({ playerId: watchList.playerId })
      .from(watchList)
      .where(eq(watchList.watchlistId, watchlistId));
    return results.map((r) => r.playerId);
  }

  async getPlayerWatchlists(userId: string, playerId: string): Promise<string[]> {
    const results = await db
      .select({ watchlistId: watchList.watchlistId })
      .from(watchList)
      .where(and(eq(watchList.userId, userId), eq(watchList.playerId, playerId)));
    return results.map((r) => r.watchlistId).filter((id): id is string => id !== null);
  }

  // Daily Boosts methods
  async getDailyBoosts(userId: string, sport: string, date: Date): Promise<DailyBoost[]> {
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    return await db
      .select()
      .from(dailyBoosts)
      .where(
        and(
          eq(dailyBoosts.userId, userId),
          eq(dailyBoosts.sport, sport),
          gte(dailyBoosts.boostDate, startOfDay),
          lte(dailyBoosts.boostDate, endOfDay),
        ),
      )
      .orderBy(desc(dailyBoosts.slotTier));
  }

  async getDailyBoostsAllSports(userId: string, date: Date): Promise<DailyBoost[]> {
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    return await db
      .select()
      .from(dailyBoosts)
      .where(
        and(
          eq(dailyBoosts.userId, userId),
          gte(dailyBoosts.boostDate, startOfDay),
          lte(dailyBoosts.boostDate, endOfDay),
        ),
      )
      .orderBy(desc(dailyBoosts.slotTier));
  }

  async getDailyBoostsByStatus(status: string): Promise<DailyBoost[]> {
    return await db.select().from(dailyBoosts).where(eq(dailyBoosts.status, status));
  }

  async getAllHoldingsWithPlayers(userId: string): Promise<HoldingWithPlayerSummary[]> {
    const [regularHoldings, multiplierRows] = await Promise.all([
      db
        .select()
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player"))),
      db
        .select({
          multiplier: playerMultipliers,
          player: players,
        })
        .from(playerMultipliers)
        .innerJoin(players, eq(playerMultipliers.playerId, players.id))
        .where(eq(playerMultipliers.userId, userId)),
    ]);

    return [
      ...regularHoldings.map((row) => ({
        ...buildHoldingSummary(row.holdings),
        player: row.players,
      })),
      ...multiplierRows.map((row) => ({
        ...buildStackedShareSummary(row.multiplier),
        player: row.player,
      })),
    ];
  }

  async getEligiblePlayersForBoost(
    userId: string,
    sport: string,
    date: Date,
  ): Promise<BoostEligibleHolding[]> {
    // Get holdings for players in the specified sport with games today
    // Use Eastern Time boundaries for consistent game day matching (same as dashboard)
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    const [regularHoldings, multiplierRows] = await Promise.all([
      db
        .select()
        .from(holdings)
        .innerJoin(players, eq(holdings.assetId, players.id))
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(players.sport, sport),
          ),
        ),
      db
        .select({
          multiplier: playerMultipliers,
          player: players,
        })
        .from(playerMultipliers)
        .innerJoin(players, eq(playerMultipliers.playerId, players.id))
        .where(and(eq(playerMultipliers.userId, userId), eq(players.sport, sport))),
    ]);

    // Get canonical games today for this sport using startTime (consistent with dashboard)
    // (Deduped to avoid legacy MySportsFeeds gameIds causing settlement joins to miss.)
    const todaysGames = await this.getDailyGamesBySport(sport, startOfDay, endOfDay);

    // Build a map of team -> game info
    const teamGameMap = new Map<string, { gameId: string; startTime: Date }>();
    for (const game of todaysGames) {
      teamGameMap.set(game.homeTeam, { gameId: game.gameId, startTime: new Date(game.startTime) });
      teamGameMap.set(game.awayTeam, { gameId: game.gameId, startTime: new Date(game.startTime) });
    }

    // For each holding, check if player's team has a game today and calculate available shares
    const result: BoostEligibleHolding[] = [];

    // Get active boosts for this user/sport/date to ensure they show up even if shares are 0
    // Get active boosts for this user/sport/date to ensure they show up even if shares are 0
    const currentBoosts = await this.getDailyBoosts(userId, sport, date);

    const boostedPlayerIds = new Set(currentBoosts.map((b) => b.playerId));

    for (const h of regularHoldings) {
      const holding = h.holdings;
      const player = h.players;
      const teamGame = teamGameMap.get(player.team);

      if (!teamGame) continue; // Player's team doesn't have a game today

      // Calculate available shares (total - locked)
      const totalLocked = await this.getTotalLockedQuantity(userId, "player", player.id);
      const availableShares = parseFloat(holding.quantity) - totalLocked;

      const effectiveShares = holding.quantity || "0.00";

      // Check if player is already boosted today
      const isBoosted = boostedPlayerIds.has(player.id);

      // Player is eligible if they have either:
      // 1. Available raw shares
      // 2. Effective shares on the holding
      // 3. An active boost for today (so we can show the "Boosted" / "Game Started" status)
      const hasEffectiveShares = parseFloat(effectiveShares) > 0;

      if (availableShares <= 0 && !hasEffectiveShares && !isBoosted) continue;

      result.push({
        ...buildHoldingSummary(holding),
        player,
        availableShares,
        gameId: teamGame.gameId,
        gameStartTime: teamGame.startTime,
      });
    }

    for (const row of multiplierRows) {
      const holding = buildStackedShareSummary(row.multiplier);
      const player = row.player;
      const teamGame = teamGameMap.get(player.team);

      if (!teamGame) continue;

      const isBoosted = boostedPlayerIds.has(player.id);
      const availableShares = 1;

      if (availableShares <= 0 && !isBoosted) continue;

      result.push({
        ...holding,
        player,
        availableShares,
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
    await db.update(dailyBoosts).set(updates).where(eq(dailyBoosts.id, boostId));
  }

  async deleteDailyBoost(boostId: string): Promise<void> {
    // First release any locked shares
    await this.unlockBoostShares(boostId);
    // Then delete the boost
    await db.delete(dailyBoosts).where(eq(dailyBoosts.id, boostId));
  }

  async getBoostPayoutHistory(userId: string, limit: number = 50): Promise<BoostPayout[]> {
    return await db
      .select()
      .from(boostPayouts)
      .where(eq(boostPayouts.userId, userId))
      .orderBy(desc(boostPayouts.createdAt))
      .limit(limit);
  }

  async createBoostPayout(payout: InsertBoostPayout): Promise<BoostPayout> {
    const [created] = await db.insert(boostPayouts).values(payout).returning();
    return created;
  }

  async createSharePayout(payout: InsertSharePayout): Promise<SharePayout> {
    const [created] = await db.insert(sharePayouts).values(payout).returning();
    return created;
  }

  async createSharePayoutSnapshotsForGame(
    game: Pick<DailyGame, "gameId" | "sport" | "homeTeam" | "awayTeam">,
    baseRate: string,
  ): Promise<number> {
    const result: any = await db.execute(sql`
      WITH earning_positions AS (
        SELECT
          ${holdings.userId} AS user_id,
          ${holdings.assetId} AS player_id,
          ${holdings.quantity}::numeric AS earning_units
        FROM ${holdings}
        INNER JOIN ${players} ON ${players.id} = ${holdings.assetId}
        WHERE ${holdings.assetType} = 'player'
          AND ${holdings.quantity}::numeric > 0
          AND ${holdings.userId} <> 'market_maker'
          AND UPPER(${players.sport}) = ${game.sport.toUpperCase()}
          AND (${players.team} = ${game.homeTeam} OR ${players.team} = ${game.awayTeam})

        UNION ALL

        SELECT
          ${playerMultipliers.userId} AS user_id,
          ${playerMultipliers.playerId} AS player_id,
          ${playerMultipliers.multiplier}::numeric AS earning_units
        FROM ${playerMultipliers}
        INNER JOIN ${players} ON ${players.id} = ${playerMultipliers.playerId}
        WHERE ${playerMultipliers.multiplier}::numeric > 0
          AND ${playerMultipliers.userId} <> 'market_maker'
          AND UPPER(${players.sport}) = ${game.sport.toUpperCase()}
          AND (${players.team} = ${game.homeTeam} OR ${players.team} = ${game.awayTeam})
      )
      INSERT INTO ${sharePayouts} (
        user_id,
        player_id,
        game_id,
        earning_units,
        earning_model,
        base_rate,
        status
      )
      SELECT
        earning_positions.user_id,
        earning_positions.player_id,
        ${game.gameId},
        ROUND(SUM(COALESCE(earning_positions.earning_units, 0)), 2)::numeric(12, 2),
        'effective_shares',
        ${baseRate}::numeric,
        'pending'
      FROM earning_positions
      GROUP BY earning_positions.user_id, earning_positions.player_id
      HAVING SUM(COALESCE(earning_positions.earning_units, 0)) > 0
      ON CONFLICT (user_id, player_id, game_id) DO NOTHING;
    `);

    return typeof result?.rowCount === "number" ? result.rowCount : 0;
  }

  async getPendingSharePayouts(limit: number = 1000): Promise<SharePayout[]> {
    return await db
      .select()
      .from(sharePayouts)
      .where(eq(sharePayouts.status, "pending"))
      .orderBy(asc(sharePayouts.createdAt))
      .limit(limit);
  }

  async processSharePayoutCredit(
    payoutId: string,
    userId: string,
    fantasyPoints: string,
    payoutAmount: string,
  ): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [pendingPayout] = await tx
        .select()
        .from(sharePayouts)
        .where(and(eq(sharePayouts.id, payoutId), eq(sharePayouts.status, "pending")))
        .for("update");

      if (!pendingPayout) return false;

      const [user] = await tx
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) return false;

      const newBalance = (parseFloat(user.balance) + parseFloat(payoutAmount)).toFixed(2);

      await tx.update(users).set({ balance: newBalance }).where(eq(users.id, userId));

      await tx
        .update(sharePayouts)
        .set({
          status: "processed",
          fantasyPoints,
          payoutAmount,
          processedAt: new Date(),
        })
        .where(eq(sharePayouts.id, payoutId));

      return true;
    });
  }

  async lockBoostShares(boostId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [boost] = await tx
        .select()
        .from(dailyBoosts)
        .where(eq(dailyBoosts.id, boostId))
        .for("update");
      if (!boost) throw new Error(`Boost ${boostId} not found`);

      if (boost.sharesEntered !== 1) {
        console.error(
          `[BOOST] Refusing to burn shares for boost ${boostId}: sharesEntered=${boost.sharesEntered} (expected 1)`,
        );
        await tx
          .update(dailyBoosts)
          .set({ status: "cancelled" })
          .where(eq(dailyBoosts.id, boostId));
        return;
      }

      const snapshotMultiplier = Math.max(1, toHoldingNumber(boost.shareMultiplier ?? "1"));
      const sourceType =
        boost.shareSourceType === "stacked" || snapshotMultiplier > 1 ? "stacked" : "regular";

      if (sourceType === "stacked") {
        const [multiplierRow] = await tx
          .select()
          .from(playerMultipliers)
          .where(
            and(
              eq(playerMultipliers.userId, boost.userId),
              eq(playerMultipliers.playerId, boost.playerId),
            ),
          )
          .for("update");

        if (!multiplierRow) {
          throw new Error(
            `No stacked share found for user ${boost.userId} player ${boost.playerId}`,
          );
        }

        const burnedMultiplier = Math.max(0, Number(multiplierRow.multiplier || 0));

        await tx.delete(playerMultipliers).where(eq(playerMultipliers.id, multiplierRow.id));
        await tx.insert(playerMultiplierEvents).values({
          userId: boost.userId,
          playerId: boost.playerId,
          eventType: "boost_burn",
          sharesConsumed: 1,
          effectiveSharesBurned: burnedMultiplier,
          multiplierDelta: -burnedMultiplier,
          multiplierAfter: 0,
          consumedTotalCostBasis: multiplierRow.totalCostBasis,
          retainedTotalCostBasis: "0.00",
          boostId,
        } satisfies InsertPlayerMultiplierEvent);
        await tx
          .update(players)
          .set({
            totalShares: sql`GREATEST(${players.totalShares} - ${burnedMultiplier}, 0)`,
            lastUpdated: new Date(),
          })
          .where(eq(players.id, boost.playerId));
        await tx
          .update(dailyBoosts)
          .set({
            status: "locked",
            shareMultiplier: toFixedString(burnedMultiplier, 2),
            shareSourceType: "stacked",
          })
          .where(eq(dailyBoosts.id, boostId));

        console.log(
          `[BOOST] Burned stacked share of player ${boost.playerId} from user ${boost.userId} (${burnedMultiplier.toFixed(2)} effective shares removed)`,
        );
        return;
      }

      const [holding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, boost.userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, boost.playerId),
          ),
        )
        .for("update");

      if (!holding) {
        throw new Error(
          `No regular holding found for user ${boost.userId} player ${boost.playerId}`,
        );
      }

      const sharesToBurn = 1;
      const newQuantity = parseFloat(holding.quantity) - sharesToBurn;
      if (newQuantity < 0) {
        throw new Error(`Cannot burn ${sharesToBurn} shares - only ${holding.quantity} available`);
      }

      const avgCostParsed = parseFloat(holding.avgCostBasis);
      const avgCostNormalized = isNaN(avgCostParsed) ? "0.0000" : avgCostParsed.toFixed(4);
      const totalCost = (parseFloat(avgCostNormalized) * newQuantity).toFixed(2);

      if (newQuantity <= 0) {
        await tx.delete(holdings).where(eq(holdings.id, holding.id));
      } else {
        await tx
          .update(holdings)
          .set({
            quantity: newQuantity.toString(),
            avgCostBasis: avgCostNormalized,
            totalCostBasis: totalCost,
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, holding.id));
      }

      await tx
        .update(players)
        .set({
          totalShares: sql`GREATEST(${players.totalShares} - 1, 0)`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, boost.playerId));
      await tx
        .update(dailyBoosts)
        .set({
          status: "locked",
          shareMultiplier: "1.00",
          shareSourceType: "regular",
        })
        .where(eq(dailyBoosts.id, boostId));

      console.log(
        `[BOOST] Burned 1 regular share of player ${boost.playerId} from user ${boost.userId} (holding ${holding.id}: ${holding.quantity} -> ${newQuantity})`,
      );
    });
  }

  async unlockBoostShares(boostId: string): Promise<void> {
    // Release the lock by reference ID
    await this.releaseSharesByReference(boostId);
  }

  async ensureHoldingConsistency(holdingId: string): Promise<void> {
    const [holding] = await db.select().from(holdings).where(eq(holdings.id, holdingId));
    if (!holding) return;

    if (parseFloat(holding.quantity) <= 0) {
      await db.delete(holdings).where(eq(holdings.id, holdingId));
      console.log(`[CONSISTENCY] Removed empty holding ${holdingId}`);
    }
  }

  async getPlayerGameForDate(
    playerId: string,
    sport: string,
    date: Date,
  ): Promise<DailyGame | undefined> {
    // Get the player's team
    const [player] = await db.select().from(players).where(eq(players.id, playerId));
    if (!player) return undefined;

    // Use ET boundaries for consistent game day matching (same as getEligiblePlayersForBoost)
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    // Use startTime windows (authoritative) and dedupe to prefer canonical BDL records.
    const games = await this.getDailyGamesBySport(sport, startOfDay, endOfDay);
    return games.find((g) => g.homeTeam === player.team || g.awayTeam === player.team);
  }
  async getCommunityBoostsForDate(
    sport: string,
    date: Date,
  ): Promise<(CommunityBoost & { creator: User; player: Player })[]> {
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    const boosts = await db
      .select({
        boost: communityBoosts,
        creator: users,
        player: players,
      })
      .from(communityBoosts)
      .innerJoin(users, eq(communityBoosts.creatorId, users.id))
      .innerJoin(players, eq(communityBoosts.playerId, players.id))
      .where(
        and(
          eq(communityBoosts.sport, sport),
          gte(communityBoosts.boostDate, startOfDay),
          lte(communityBoosts.boostDate, endOfDay),
          ne(communityBoosts.status, "cancelled"),
        ),
      );

    return boosts.map((b) => ({
      ...b.boost,
      creator: b.creator,
      player: b.player,
    }));
  }

  async getCommunityBoostsAllSports(
    date: Date,
  ): Promise<(CommunityBoost & { creator: User; player: Player })[]> {
    const dateStr = getGameDay(date);
    const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

    const boosts = await db
      .select({
        boost: communityBoosts,
        creator: users,
        player: players,
      })
      .from(communityBoosts)
      .innerJoin(users, eq(communityBoosts.creatorId, users.id))
      .innerJoin(players, eq(communityBoosts.playerId, players.id))
      .where(
        and(
          gte(communityBoosts.boostDate, startOfDay),
          lte(communityBoosts.boostDate, endOfDay),
          ne(communityBoosts.status, "cancelled"),
        ),
      );

    return boosts.map((b) => ({
      ...b.boost,
      creator: b.creator,
      player: b.player,
    }));
  }

  async createCommunityBoost(boost: InsertCommunityBoost): Promise<CommunityBoost> {
    // 1. Get user's community holdings
    const [communityHolding] = await db
      .select()
      .from(holdings)
      .where(and(eq(holdings.userId, boost.creatorId), eq(holdings.assetType, "community")));

    if (!communityHolding || parseFloat(communityHolding.quantity) < 1) {
      throw new Error("Insufficient community shares to create community boost");
    }

    // 2. Transact: Deduct share and create boost
    return await db.transaction(async (tx) => {
      // Deduct 1 community share
      await tx
        .update(holdings)
        .set({
          quantity: sql`${holdings.quantity} - '1'`,
          lastUpdated: new Date(),
        })
        .where(and(eq(holdings.userId, boost.creatorId), eq(holdings.assetType, "community")));

      // Create boost
      const [newBoost] = await tx.insert(communityBoosts).values(boost).returning();

      return newBoost;
    });
  }

  async getCommunityBoostBeneficiaries(playerId: string): Promise<(Holding & { user: User })[]> {
    const regularBeneficiaries = await db
      .select({
        holding: holdings,
        user: users,
      })
      .from(holdings)
      .innerJoin(users, eq(holdings.userId, users.id))
      .where(
        and(
          eq(holdings.assetType, "player"),
          eq(holdings.assetId, playerId),
          gt(holdings.quantity, "0"),
        ),
      );

    return regularBeneficiaries.map((b) => ({
      ...b.holding,
      user: b.user,
    }));
  }

  async updateCommunityBoost(boostId: string, updates: Partial<CommunityBoost>): Promise<void> {
    await db.update(communityBoosts).set(updates).where(eq(communityBoosts.id, boostId));
  }

  async getCommunityBoostsByStatus(status: string): Promise<CommunityBoost[]> {
    return await db.select().from(communityBoosts).where(eq(communityBoosts.status, status));
  }
  // Scout Status
  async getScoutStatus(
    userId: string,
  ): Promise<{ earnedMinutes: number; nextDistribution: Date; perPlayer: Record<string, number> }> {
    const now = new Date();
    // Calculate last distribution time (Top of Hour XX:00)
    let lastDist = new Date(now);
    lastDist.setMinutes(0);
    lastDist.setSeconds(0);
    lastDist.setMilliseconds(0);

    const nextDistribution = new Date(lastDist);
    nextDistribution.setHours(nextDistribution.getHours() + 1);

    console.log(
      `[getScoutStatus] User: ${userId}, Window: ${lastDist.toISOString()} to ${now.toISOString()}`,
    );

    try {
      // Calculate earned minutes since last distribution, grouped by player
      // Fetch raw history rows that overlap with the window to calculate in JS (avoids Timezone/SQL calc issues)
      const [history, activeAssignments] = await Promise.all([
        db
          .select()
          .from(scoutHistory)
          .where(
            and(
              eq(scoutHistory.userId, userId),
              or(isNull(scoutHistory.endedAt), gt(scoutHistory.endedAt, lastDist)),
              lt(scoutHistory.startedAt, now),
            ),
          ),
        db.select().from(scoutAssignments).where(eq(scoutAssignments.userId, userId)),
      ]);

      const perPlayer: Record<string, number> = {};
      let totalEarnedMinutes = 0;

      // SELF-HEALING: Check for active assignments that don't have an open history record
      // This handles legacy data or cases where history failed to write
      const openHistoryMap = new Set(history.filter((h) => !h.endedAt).map((h) => h.playerId));

      for (const assignment of activeAssignments) {
        if (assignment.scoutCount > 0 && !openHistoryMap.has(assignment.playerId)) {
          console.log(
            `[getScoutStatus] Found ghost assignment for player ${assignment.playerId} (Count: ${assignment.scoutCount}). Backfilling...`,
          );
          // Treat as a history row that started at assignment.updatedAt (or lastDist if older)
          // We push it to the history array so the loop below processes it naturally
          // We construct a mock history object compatible with the loop
          history.push({
            id: "ghost",
            userId: assignment.userId,
            playerId: assignment.playerId,
            scoutCount: assignment.scoutCount,
            startedAt: assignment.updatedAt || lastDist, // If Attr missing, assume window start
            endedAt: null,
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
      Object.keys(perPlayer).forEach((k) => {
        perPlayer[k] = Math.floor(perPlayer[k] * 100) / 100;
      });
      totalEarnedMinutes = Math.floor(totalEarnedMinutes * 100) / 100;

      // Log for debugging
      console.log(
        `[getScoutStatus] Calculated ${totalEarnedMinutes} min for user ${userId} across ${history.length} history rows.`,
      );

      return {
        earnedMinutes: Math.floor(totalEarnedMinutes * 100) / 100,
        perPlayer, // Return the breakdown
        nextDistribution,
      };
    } catch (err: any) {
      console.error("[getScoutStatus] Query failed:", err.message);
      throw err;
    }
  }

  // Stack Shares methods
  // Stacking burns half the effective share count and creates/updates one stacked-share multiplier.
  async stackShares(
    userId: string,
    playerId: string,
    rawShareCount: number,
  ): Promise<{
    newMultiplier: string;
    sharesStacked: number;
    multiplier: string;
    effectiveSharesBurned: number;
  }> {
    if (rawShareCount < 4) {
      throw new Error("Minimum 4 shares required to stack");
    }
    if (rawShareCount % 2 !== 0) {
      throw new Error("Share count must be even");
    }

    const multiplierGained = rawShareCount / 2;
    const effectiveSharesBurned = rawShareCount - multiplierGained;

    return await db.transaction(async (tx) => {
      const [regularHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, playerId),
          ),
        )
        .for("update");

      if (!regularHolding) {
        throw new Error("No regular shares found to stack");
      }

      const [lockedResult] = await tx
        .select({ total: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)` })
        .from(holdingsLocks)
        .where(
          and(
            eq(holdingsLocks.userId, userId),
            eq(holdingsLocks.assetType, "player"),
            eq(holdingsLocks.assetId, playerId),
          ),
        );
      const lockedShares = Number(lockedResult?.total || 0);
      const availableShares = parseFloat(regularHolding.quantity) - lockedShares;

      if (availableShares < rawShareCount) {
        throw new Error(`Only ${availableShares} shares available (${lockedShares} locked)`);
      }

      const avgCostBasis = toHoldingNumber(regularHolding.avgCostBasis);
      const consumedTotalCostBasis = avgCostBasis * rawShareCount;
      const retainedTotalCostBasis = avgCostBasis * multiplierGained;
      const newRegularQuantity = parseFloat(regularHolding.quantity) - rawShareCount;
      const newRegularTotalCostBasis = avgCostBasis * newRegularQuantity;

      if (newRegularQuantity <= 0) {
        await tx.delete(holdings).where(eq(holdings.id, regularHolding.id));
      } else {
        await tx
          .update(holdings)
          .set({
            quantity: newRegularQuantity.toString(),
            totalCostBasis: newRegularTotalCostBasis.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, regularHolding.id));
      }

      const [existingMultiplier] = await tx
        .select()
        .from(playerMultipliers)
        .where(and(eq(playerMultipliers.userId, userId), eq(playerMultipliers.playerId, playerId)))
        .for("update");

      let multiplierAfter = multiplierGained;
      if (existingMultiplier) {
        const existingTotalCostBasis = toHoldingNumber(existingMultiplier.totalCostBasis);
        multiplierAfter = existingMultiplier.multiplier + multiplierGained;
        const nextTotalCostBasis = existingTotalCostBasis + retainedTotalCostBasis;
        const nextAvgCostBasis =
          multiplierAfter > 0 ? nextTotalCostBasis / multiplierAfter : avgCostBasis;
        await tx
          .update(playerMultipliers)
          .set({
            multiplier: multiplierAfter,
            avgCostBasis: nextAvgCostBasis.toFixed(4),
            totalCostBasis: nextTotalCostBasis.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(playerMultipliers.id, existingMultiplier.id));
      } else {
        await tx.insert(playerMultipliers).values({
          userId,
          playerId,
          multiplier: multiplierGained,
          avgCostBasis: toFixedString(avgCostBasis, 4),
          totalCostBasis: retainedTotalCostBasis.toFixed(2),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await tx.insert(playerMultiplierEvents).values({
        userId,
        playerId,
        eventType: "stack_shares",
        sharesConsumed: rawShareCount,
        effectiveSharesBurned,
        multiplierDelta: multiplierGained,
        multiplierAfter,
        consumedTotalCostBasis: consumedTotalCostBasis.toFixed(2),
        retainedTotalCostBasis: retainedTotalCostBasis.toFixed(2),
      } satisfies InsertPlayerMultiplierEvent);
      await tx
        .update(players)
        .set({
          totalShares: sql`GREATEST(${players.totalShares} - ${effectiveSharesBurned}, 0)`,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      console.log(
        `[stackShares] User ${userId} stacked ${rawShareCount} shares of ${playerId} into 1 stacked share at ${multiplierAfter.toFixed(2)}x`,
      );

      return {
        newMultiplier: multiplierAfter.toFixed(2),
        sharesStacked: rawShareCount,
        multiplier: multiplierAfter.toFixed(2),
        effectiveSharesBurned,
      };
    });
  }

  // Get regular + stacked-share view for a player.
  async getPlayerShareBreakdown(
    userId: string,
    playerId: string,
  ): Promise<{
    regular: typeof holdings.$inferSelect | null;
    stacked: HoldingSummary[];
  }> {
    const [regular, multiplier] = await Promise.all([
      this.getRegularHolding(userId, "player", playerId),
      this.getPlayerMultiplier(userId, playerId),
    ]);
    const stacked = multiplier ? [buildStackedShareSummary(multiplier)] : [];

    return { regular: regular ?? null, stacked };
  }

  // Get effective shares for a player (regular shares + stacked multiplier).
  async getTotalEffectiveShares(userId: string, playerId: string): Promise<number> {
    const [regular, multiplier] = await Promise.all([
      this.getRegularHolding(userId, "player", playerId),
      this.getPlayerMultiplier(userId, playerId),
    ]);

    return toHoldingNumber(regular?.quantity) + Number(multiplier?.multiplier || 0);
  }

  // Get user's community boost shares (from holdings table)
  async getUserCommunityBoostShares(userId: string): Promise<number> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, "community"),
          eq(holdings.assetId, "community"),
        ),
      );
    return holding ? parseFloat(holding.quantity) : 0;
  }

  // Get holding multiplier state for a specific player.
  async getHoldingMultiplierState(
    userId: string,
    playerId: string,
  ): Promise<HoldingMultiplierState | undefined> {
    const [regularHolding, multiplier] = await Promise.all([
      this.getRegularHolding(userId, "player", playerId),
      this.getPlayerMultiplier(userId, playerId),
    ]);

    if (!regularHolding && !multiplier) return undefined;

    const tradeableShares = await this.getRegularAvailableShares(userId, playerId);
    const regularQuantity = toHoldingNumber(regularHolding?.quantity);
    const multiplierValue = Number(multiplier?.multiplier || 0);
    const effectiveShares = regularQuantity + multiplierValue;
    const maxStackable = Math.floor(tradeableShares / 2) * 2;

    return {
      quantity: regularQuantity,
      availableShares: tradeableShares,
      effectiveShares,
      multiplier: multiplierValue.toFixed(2),
      hasStackedShare: multiplierValue > 0,
      canStackShares: tradeableShares >= 4,
      maxStackable,
      tradeableShares,
    };
  }

  // AMM / LP Methods
  async getPlayerPool(playerId: string) {
    const [pool] = await db.select().from(playerPools).where(eq(playerPools.playerId, playerId));
    return pool;
  }

  async getLpPosition(playerId: string, userId: string) {
    const [position] = await db
      .select()
      .from(lpPositions)
      .where(and(eq(lpPositions.userId, userId), eq(lpPositions.playerId, playerId)));
    return position;
  }

  async getUserLpPositions(userId: string) {
    return await db.select().from(lpPositions).where(eq(lpPositions.userId, userId));
  }

  async createLpPosition(position: any) {
    const [newPosition] = await db.insert(lpPositions).values(position).returning();
    return newPosition;
  }

  async updateLpPosition(id: string, updates: Partial<any>) {
    await db.update(lpPositions).set(updates).where(eq(lpPositions.id, id));
  }

  async deleteLpPosition(id: string) {
    await db.delete(lpPositions).where(eq(lpPositions.id, id));
  }

  async getLpTransactionHistory(userId: string, playerId?: string, limit: number = 50) {
    if (playerId) {
      return await db
        .select()
        .from(lpTransactions)
        .where(and(eq(lpTransactions.userId, userId), eq(lpTransactions.playerId, playerId)))
        .orderBy(desc(lpTransactions.timestamp))
        .limit(limit);
    }

    return await db
      .select()
      .from(lpTransactions)
      .where(eq(lpTransactions.userId, userId))
      .orderBy(desc(lpTransactions.timestamp))
      .limit(limit);
  }

  // Batch fetch pool data for multiple players (for marketplace performance)
  async getBatchPoolData(
    playerIds: string[],
  ): Promise<
    Map<string, { shares: number; playMoney: number; totalVolume: number; totalTrades: number }>
  > {
    if (playerIds.length === 0) {
      return new Map();
    }

    const pools = await db
      .select({
        playerId: playerPools.playerId,
        shares: playerPools.shares,
        playMoney: playerPools.playMoney,
        totalVolume: playerPools.totalVolume,
        totalTrades: playerPools.totalTrades,
      })
      .from(playerPools)
      .where(inArray(playerPools.playerId, playerIds));

    const poolMap = new Map<
      string,
      { shares: number; playMoney: number; totalVolume: number; totalTrades: number }
    >();
    for (const pool of pools) {
      poolMap.set(pool.playerId, {
        shares: parseFloat(pool.shares as string),
        playMoney: parseFloat(pool.playMoney as string),
        totalVolume: parseFloat(pool.totalVolume as string),
        totalTrades: pool.totalTrades,
      });
    }

    return poolMap;
  }
}

export const storage = new DatabaseStorage();
