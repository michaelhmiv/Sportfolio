import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { storage } from "./storage";
import { db } from "./db";
import type {
  InsertPlayer,
  Player,
  User,
  Holding,
  CommunityBoost,
  DailyGame,
  PlayerGameStats,
} from "@shared/schema";
import {
  holdings,
  marketSnapshots,
  portfolioSnapshots,
  premiumCheckoutSessions,
  tweetSettings,
  tweetHistory,
  users,
  scoutAssignments,
  scoutDistributions,
  scoutHistory,
  dailyGames,
  dailyBoosts,
  players,
  playerPools,
  playerGameStats,
  sharePayouts,
  holdingsLocks,
  communityCheckoutSessions,
  userCollections,
  userMilestones,
  trades,
  whopPayments,
  googlePlayPurchases,
  jobExecutionLogs,
} from "@shared/schema";
import {
  DEFAULT_ACTIVITY_FEED_CATEGORIES,
  USER_ACTIVITY_CATEGORIES,
  type UserActivityCategory,
} from "@shared/activity-feed";
import {
  MARKET_ACTIVITY_SIGNAL_TAGS,
  MARKET_ACTIVITY_SORTS,
  type MarketActivityGameStateFilter,
  type MarketActivitySideFilter,
  type MarketActivitySignalTag,
  type MarketActivitySort,
} from "@shared/market-activity";
import { getMarketplaceGameStatus, hasGameStartedForBoost } from "@shared/game-status";
import { sql, eq, desc, asc, and, gte, lte, inArray, lt, like, or } from "drizzle-orm";
import { jobScheduler } from "./jobs/scheduler";
import { addClient, removeClient, broadcast, getWebSocketStats } from "./websocket";
import { setupAuth, isAuthenticated, optionalAuth } from "./supabaseAuth";
import { getGameDay, getETDayBoundaries, getTodayETBoundaries, getTodayET } from "./lib/time";
import { getPerformanceEarningUnits } from "./lib/performance-earnings";
import { buildGameStatsPayload } from "./game-stats-response";
import { buildMlbGameplaySignals, type MlbGameplaySignal } from "./mlb-gameplay-signals";
import { buildMlbPlayerContextPayload } from "./mlb-player-context";
import { getOrCompute } from "./cache";
import {
  getMlbPregameInsightBundle,
  getMlbPitcherMatchupChip,
  getMlbPlayerPregameLookup,
  type MlbEnrichmentStatus,
  type MlbPregameInsight,
} from "./mlb-pregame-insights";
import { registerDomainRoutes } from "./routes/register-domain-routes";
import { buildMobileMarketOverview } from "./market-mobile-overview";
import {
  buildMarketActivityFeed,
  getMarketActivitySourceFetchWindow,
} from "./market-activity-feed";
import { registerMarketMobileRoutes } from "./routes/market-mobile";
import { registerPlayersRoutes } from "./routes/players";
import { normalizeEtDateParam } from "./routes/players-query";
import { getPool } from "./amm/pool";
import { normalizeSiteUrl } from "@shared/seo";
import {
  assignDailyBoostWithValidation,
  DailyBoostValidationError,
} from "./boosts/assign-daily-boost";
import { ensureSmsSchema } from "./sms-service";
import { ensureDiscordSchema } from "./discord-service";
import { ensureAccountDeletionSchema } from "./services/account-deletion";
import { redeemPremiumShare } from "./services/premium-redemption";
import { sendUserNotification } from "./services/notification-dispatcher";
import { loadUserEntitlements } from "./services/user-entitlements";
import {
  getApiHealthStaleThresholdMs,
  getLatestApiHealthReport,
  getRecentApiHealthReports,
  runApiHealthCheck,
  toApiHealthJobResult,
} from "./health/api-health-check";
import {
  clearPortfolioAgentByok,
  getAgentCapabilities,
  getPortfolioAgentProfile,
  savePortfolioAgentByok,
  updatePortfolioAgentProfile,
} from "./agent/service";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  ensureAgentThreadSchema,
  getAgentThread,
  getAgentQuestionLogs,
  listAgentThreadResearchSources,
  listAgentThreadMessages,
  listAgentThreads,
  sendAgentThreadMessage,
} from "./agent/thread-service";
import { getAgentThreadRuntimeDetails } from "./agent/thread-runtime";
import { agentTurnEventStreamManager } from "./agent/turn-events";
import {
  approveAgentSkillCandidate,
  listAdminAgentSkills,
  rejectAgentSkillCandidate,
} from "./agent/skills";
import {
  activateUserAgentStrategy,
  archiveUserAgentStrategy,
  createUserAgentStrategyFromThread,
  ensureUserAgentStrategySchema,
  getUserAgentStrategyDetail,
  listUserAgentStrategyEvents,
  listUserAgentStrategyRuns,
  listUserAgentStrategies,
  pauseUserAgentStrategy,
  reviewUserAgentStrategy,
  updateUserAgentStrategy,
} from "./agent/strategies";
import { runUserAgentStrategy } from "./agent/strategy-runner";
import {
  createUserMcpSource,
  deleteUserMcpSource,
  ensureUserMcpSourceSchema,
} from "./agent/mcp-sources";
import {
  getAgentDataSource,
  listAgentDataSources,
  updateAgentDataSource,
} from "./agent/data-sources";
import {
  ensureAgentSystemSettingsSchema,
  getAgentSystemSettings,
  updateAgentSystemSettings,
} from "./agent/system-settings";
import { getManagedProviderModelCatalog } from "./agent/model-catalog";
import { isManagedProviderKey } from "./agent/provider-registry";
import { ensureAgentSemanticSchema } from "./agent/semantic-router";
import { ensureUserApiTokenSchema } from "./api-token-auth";
import {
  buildLeaderboardWindow,
  getLeaderboardMeta,
  getLeaderboardRankChange,
  normalizeLeaderboardCategory,
  type LeaderboardCategory,
  type LeaderboardEntry,
} from "./leaderboards";
import { getBotRuntimeStatus, getBotStats, runBotEngineTick } from "./bot/bot-engine";
import { buildStackSharesResponsePayload } from "./lib/stack-shares-response";

const SUPPORTED_SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;
function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveEtDateOrToday(value: unknown): string {
  const normalizedDate = normalizeEtDateParam(value);
  return normalizedDate ?? getTodayET();
}

function toNoonForEtDate(etDate: string): Date {
  const { startOfDay } = getETDayBoundaries(etDate);
  return new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
}

async function loadEffectiveUserState(userId: string) {
  return loadUserEntitlements(storage, userId);
}

function getClientPlatformFromRequest(req: Request): "ios" | "android" | "web" | "unknown" {
  const explicitPlatform = req.header("x-sportfolio-client-platform")?.trim().toLowerCase();
  if (explicitPlatform === "ios" || explicitPlatform === "android" || explicitPlatform === "web") {
    return explicitPlatform;
  }

  const runtime = req.header("x-sportfolio-client-runtime")?.trim().toLowerCase();
  if (runtime === "web") {
    return "web";
  }

  return "unknown";
}

function isNativeIOSRequest(req: Request): boolean {
  return getClientPlatformFromRequest(req) === "ios";
}

/**
 * Get boosts summary data for the dashboard
 */
async function getDashboardBoostData(userId: string) {
  try {
    const { startOfDay } = getTodayETBoundaries();
    const today = startOfDay;

    // Fetch all boosts across sports for today
    const boosts = await storage.getDailyBoostsAllSports(userId, today);

    // Get community boosts count
    const communityBoosts = await storage.getCommunityBoostsAllSports(today);
    const communityBoostCount = communityBoosts.length;

    // Get user community shares (for premium share count)
    const userCommunityShares = await storage.getUserCommunityBoostShares(userId);

    // Calculate totals
    const activeBoosts = boosts.filter((b) => b.status === "active").length;
    const lockedBoosts = boosts.filter((b) => b.status === "locked").length;
    const processedBoosts = boosts.filter((b) => b.status === "processed").length;

    // Get total estimated payout for live boosts
    let totalLivePayout = "0.00";
    if (lockedBoosts > 0) {
      for (const boost of boosts.filter((b) => b.status === "locked")) {
        if (boost.fantasyPoints && boost.payout) {
          totalLivePayout = (parseFloat(totalLivePayout) + parseFloat(boost.payout)).toFixed(2);
        }
      }
    }

    // Get total processed payout
    let totalProcessedPayout = "0.00";
    if (processedBoosts > 0) {
      for (const boost of boosts.filter((b) => b.status === "processed")) {
        if (boost.payout) {
          totalProcessedPayout = (
            parseFloat(totalProcessedPayout) + parseFloat(boost.payout)
          ).toFixed(2);
        }
      }
    }

    // Get slots info
    const slotsRemaining = 4 - boosts.length;
    const availableSlots = [5, 4, 3, 2].filter((tier) => !boosts.some((b) => b.slotTier === tier));

    return {
      activeBoosts,
      lockedBoosts,
      processedBoosts,
      totalBoosts: boosts.length,
      slotsRemaining,
      availableSlots,
      communityBoostCount,
      userCommunityShares,
      totalLivePayout,
      totalProcessedPayout,
      boosts: boosts.slice(0, 4), // Include top boosts for preview
    };
  } catch (error: any) {
    console.error("[getDashboardBoostData] Error:", error.message);
    return {
      activeBoosts: 0,
      lockedBoosts: 0,
      processedBoosts: 0,
      totalBoosts: 0,
      slotsRemaining: 4,
      availableSlots: [5, 4, 3, 2],
      communityBoostCount: 0,
      userCommunityShares: 0,
      totalLivePayout: "0.00",
      totalProcessedPayout: "0.00",
      boosts: [],
    };
  }
}

type GameInsightLeader = {
  playerId: string;
  name: string;
  team: string;
  avgFantasyPointsPerGame: number;
  totalShares: number;
  scoutCount: number;
};

type GameInsightSlatePlayer = {
  playerId: string;
  name: string;
  team: string;
  gameId: string;
  startTime: Date;
  status: "scheduled" | "inprogress" | "completed" | "postponed";
  contextLabel: string;
  pregameValue: number | null;
  liveValue: number | null;
  finalValue: number | null;
};

const ADMIN_STATS_CACHE_TTL_MS = Math.max(
  5000,
  Number(process.env.ADMIN_STATS_CACHE_TTL_MS || 20000),
);

let adminStatsCache: {
  expiresAt: number;
  payload: Record<string, any>;
} | null = null;

function invalidateAdminStatsCache() {
  adminStatsCache = null;
}

type GameInsightUserContext = {
  eligibleCount: number;
  topMultiplierPlayers: Array<{
    playerId: string;
    name: string;
    team: string;
    multiplier: number;
    availableShares: number;
    totalShares: number;
    isBoosted: boolean;
  }>;
  ownedPlayers: Array<{
    playerId: string;
    name: string;
    team: string;
    multiplier: number;
    availableShares: number;
    totalShares: number;
    isBoosted: boolean;
  }>;
  liveEarned?: number | null;
  earningsStatus?: "scheduled" | "inprogress" | "completed" | "postponed";
};

type GameInsight = {
  gameId: string;
  sport: string;
  gameDay: string;
  status: string;
  startTime: Date;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  leaders: {
    fantasy: GameInsightLeader | null;
    shares: GameInsightLeader | null;
    scouts: GameInsightLeader | null;
  };
  userContext: GameInsightUserContext | null;
  liveMarketStatus?: string | null;
  mlbEnrichment?: MlbEnrichmentStatus | null;
  mlbPregame?: MlbPregameInsight | null;
  mlbSignals?: MlbGameplaySignal[];
};

const slatePlayerStatusPriority: Record<GameInsightSlatePlayer["status"], number> = {
  inprogress: 0,
  scheduled: 1,
  completed: 2,
  postponed: 3,
};

function getSlatePlayerSortValue(player: GameInsightSlatePlayer): number {
  if (player.status === "inprogress") {
    return player.liveValue ?? player.finalValue ?? player.pregameValue ?? 0;
  }

  if (player.status === "completed") {
    return player.finalValue ?? player.liveValue ?? player.pregameValue ?? 0;
  }

  return player.pregameValue ?? player.liveValue ?? player.finalValue ?? 0;
}

function sortSlateExposurePlayers(left: GameInsightSlatePlayer, right: GameInsightSlatePlayer) {
  const statusDelta =
    slatePlayerStatusPriority[left.status] - slatePlayerStatusPriority[right.status];
  if (statusDelta !== 0) return statusDelta;

  const valueDelta = getSlatePlayerSortValue(right) - getSlatePlayerSortValue(left);
  if (valueDelta !== 0) return valueDelta;

  return left.name.localeCompare(right.name);
}

type LiveEarningsPlayer = {
  playerId: string;
  fantasyPoints: number;
  name?: string;
  team?: string;
};

type NascarLiveStatsJson = {
  startingPosition?: number;
  startPosition?: number;
  runningPosition?: number;
  finishPosition?: number;
  positionDifferential?: number;
  positionImproved?: number | null;
  carNumber?: string;
  manufacturer?: string;
  lapsCompleted?: number;
  lapsLedCount?: number;
  lapsLed?: number;
  fastestLaps?: number;
  averageRunningPosition?: number;
  averageSpeed?: number;
  bestLap?: number;
  bestLapSpeed?: number;
  bestLapTime?: string;
  delta?: number;
  isOnTrack?: boolean;
  isOnDvp?: boolean;
  status?: string;
  points?: number;
  driverId?: number;
  driverName?: string;
  raceId?: number;
  trackName?: string;
  lapNumber?: number;
  lapsInRace?: number;
  lapsToGo?: number;
  flagState?: number;
  flagStateDescription?: string;
  runName?: string;
  runType?: number;
  seriesId?: number;
  runId?: number;
  stage?: { stage_num?: number; finish_at_lap?: number; laps_in_stage?: number } | null;
  numberOfCautionSegments?: number;
  numberOfLeadChanges?: number;
  numberOfLeaders?: number;
};

type NascarDriverStanding = {
  position: number;
  startingPosition: number;
  playerId: string;
  driverName: string;
  carNumber: string;
  manufacturer: string;
  lapsCompleted: number;
  lapsLed: number;
  fastestLaps: number;
  positionDifferential: number;
  averageRunningPosition: number | null;
  averageSpeed: number | null;
  bestLap: number | null;
  bestLapSpeed: number | null;
  bestLapTime: string | null;
  delta: number | null;
  isOnTrack: boolean | null;
  isOnDvp: boolean | null;
  status: string;
  fantasyPoints: number;
  providerPoints: number | null;
};

type NascarRaceStatsSnapshot = {
  status: "scheduled" | "inprogress" | "completed";
  lapInfo: {
    currentLap: number;
    totalLaps: number;
    lapsToGo: number;
    flagState: string;
    flagStateCode: number | null;
    stage: NascarLiveStatsJson["stage"] | null;
    runName: string | null;
    runType: number | null;
    cautions: number | null;
    leadChanges: number | null;
    leaders: number | null;
  } | null;
  driverStandings: NascarDriverStanding[];
  liveEarningsPlayers: LiveEarningsPlayer[];
};

type UserLiveEarningsSummary = {
  totalEstimatedEarnings: number;
  ownedPlayers: Array<{
    playerId: string;
    name: string;
    team: string;
    quantity: number;
    effectiveShares: number;
    fantasyPoints: number;
    estimatedEarnings: number;
  }>;
};

const parseLiveEarningsNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const getNascarStatsJson = (statsJson: unknown): NascarLiveStatsJson =>
  statsJson && typeof statsJson === "object" ? (statsJson as NascarLiveStatsJson) : {};

function isNascarStatsFinal(stats: NascarLiveStatsJson): boolean {
  const flagStateDescription = String(stats.flagStateDescription || "").toLowerCase();
  return (
    stats.flagState === 4 ||
    stats.flagState === 9 ||
    flagStateDescription === "checkered" ||
    flagStateDescription === "final" ||
    flagStateDescription === "finish" ||
    Number(stats.lapsToGo) === 0
  );
}

function getNascarStatsPosition(stats: NascarLiveStatsJson, gameStatus: string): number {
  if (gameStatus === "scheduled") {
    return Number(stats.startingPosition ?? stats.startPosition ?? 999);
  }
  return Number(stats.runningPosition ?? stats.finishPosition ?? 999);
}

async function buildNascarRaceStatsSnapshot(
  game: Pick<DailyGame, "gameId" | "status" | "sport" | "homeTeam" | "awayTeam">,
  raceStats: PlayerGameStats[],
): Promise<NascarRaceStatsSnapshot> {
  const sortedStats = [...raceStats].sort((left, right) => {
    const leftStats = getNascarStatsJson(left.statsJson);
    const rightStats = getNascarStatsJson(right.statsJson);
    return (
      getNascarStatsPosition(leftStats, game.status || "scheduled") -
      getNascarStatsPosition(rightStats, game.status || "scheduled")
    );
  });

  const playerIds = Array.from(
    new Set(sortedStats.map((stat) => String(stat.playerId || "").trim()).filter(Boolean)),
  );
  const playersById = new Map(
    playerIds.length > 0
      ? (await storage.getPlayersByIds(playerIds)).map((player) => [player.id, player])
      : [],
  );

  const driverStandings = sortedStats.map((stat) => {
    const stats = getNascarStatsJson(stat.statsJson);
    const player = playersById.get(stat.playerId);
    const position = Number(stats.runningPosition ?? stats.finishPosition ?? 0) || 0;
    const startingPosition = Number(stats.startingPosition ?? stats.startPosition ?? 0) || 0;

    return {
      position,
      startingPosition,
      playerId: stat.playerId,
      driverName:
        stats.driverName ||
        (player ? `${player.firstName} ${player.lastName}`.trim() : "") ||
        "Unknown",
      carNumber: String(stats.carNumber || ""),
      manufacturer: String(stats.manufacturer || ""),
      lapsCompleted: Number(stats.lapsCompleted || 0),
      lapsLed: Number(stats.lapsLedCount ?? stats.lapsLed ?? 0) || 0,
      fastestLaps: Number(stats.fastestLaps || 0),
      positionDifferential:
        Number(stats.positionDifferential) ||
        (startingPosition > 0 && position > 0 ? startingPosition - position : 0),
      averageRunningPosition:
        typeof stats.averageRunningPosition === "number" ? stats.averageRunningPosition : null,
      averageSpeed: typeof stats.averageSpeed === "number" ? stats.averageSpeed : null,
      bestLap: typeof stats.bestLap === "number" ? stats.bestLap : null,
      bestLapSpeed: typeof stats.bestLapSpeed === "number" ? stats.bestLapSpeed : null,
      bestLapTime: stats.bestLapTime || null,
      delta: typeof stats.delta === "number" ? stats.delta : null,
      isOnTrack: typeof stats.isOnTrack === "boolean" ? stats.isOnTrack : null,
      isOnDvp: typeof stats.isOnDvp === "boolean" ? stats.isOnDvp : null,
      status: stats.status || (stats.isOnTrack === false ? "Off Track" : "Running"),
      fantasyPoints: parseLiveEarningsNumber(stat.fantasyPoints),
      providerPoints: typeof stats.points === "number" ? stats.points : null,
    } satisfies NascarDriverStanding;
  });

  let status: NascarRaceStatsSnapshot["status"] =
    game.status === "inprogress" || game.status === "completed" ? game.status : "scheduled";
  const latestStat = sortedStats[0] || null;
  const latestStats = latestStat ? getNascarStatsJson(latestStat.statsJson) : {};

  if (latestStat && isNascarStatsFinal(latestStats)) {
    status = "completed";
  } else if (latestStat && status === "scheduled") {
    const statTime = new Date(latestStat.lastFetchedAt || latestStat.gameDate).getTime();
    if (Number.isFinite(statTime) && statTime > Date.now() - 60 * 60 * 1000) {
      status = "inprogress";
    }
  }

  const lapInfo =
    latestStat && (latestStats.lapNumber || latestStats.lapsInRace || latestStats.flagState)
      ? {
          currentLap: Number(latestStats.lapNumber || 0),
          totalLaps: Number(latestStats.lapsInRace || 0),
          lapsToGo: Number(latestStats.lapsToGo || 0),
          flagState: latestStats.flagStateDescription || "Unknown",
          flagStateCode: typeof latestStats.flagState === "number" ? latestStats.flagState : null,
          stage: latestStats.stage || null,
          runName: latestStats.runName || null,
          runType: typeof latestStats.runType === "number" ? latestStats.runType : null,
          cautions:
            typeof latestStats.numberOfCautionSegments === "number"
              ? latestStats.numberOfCautionSegments
              : null,
          leadChanges:
            typeof latestStats.numberOfLeadChanges === "number"
              ? latestStats.numberOfLeadChanges
              : null,
          leaders:
            typeof latestStats.numberOfLeaders === "number" ? latestStats.numberOfLeaders : null,
        }
      : null;

  return {
    status,
    lapInfo,
    driverStandings,
    liveEarningsPlayers: driverStandings.map((driver) => ({
      playerId: driver.playerId,
      name: driver.driverName,
      team: game.awayTeam,
      fantasyPoints: driver.fantasyPoints,
    })),
  };
}

const normalizeLiveEarningsName = (name: string) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getLiveEarningsNameTeamKey = (name: string, team?: string) =>
  `${String(team || "")
    .trim()
    .toUpperCase()}|${normalizeLiveEarningsName(name)}`;

const getLiveEarningsPlayerIdCandidates = (playerId: string, gameSport: string): string[] => {
  const rawId = String(playerId || "").trim();
  if (!rawId) return [];

  const ids = new Set<string>([rawId]);
  if (/^(nba_|nfl_|mlb_|nascar_)/i.test(rawId)) {
    ids.add(rawId.replace(/^(nba_|nfl_|mlb_|nascar_)/i, ""));
  } else {
    ids.add(`${String(gameSport || "NBA").toLowerCase()}_${rawId}`);
  }

  return Array.from(ids);
};

async function getStoredLiveEarningsPlayersForGame(game: Pick<DailyGame, "gameId" | "sport">) {
  let gameStats = await storage.getGameStatsByGameId(game.gameId);
  if ((!gameStats || gameStats.length === 0) && game.gameId.includes("_")) {
    const fallbackGameId = game.gameId.split("_").slice(1).join("_");
    if (fallbackGameId) {
      gameStats = await storage.getGameStatsByGameId(fallbackGameId);
    }
  }

  if (!gameStats || gameStats.length === 0) return [] as LiveEarningsPlayer[];

  return gameStats
    .map((stat) => ({
      playerId: String(stat.playerId || "").trim(),
      fantasyPoints: parseLiveEarningsNumber(stat.fantasyPoints),
    }))
    .filter((player) => player.playerId && Number.isFinite(player.fantasyPoints));
}

async function getProviderLiveEarningsPlayersForGame(
  game: DailyGame,
): Promise<LiveEarningsPlayer[]> {
  if (game.sport === "MLB") {
    const mlbGameIdStr = game.gameId.startsWith("mlb_") ? game.gameId.slice(4) : game.gameId;
    const mlbGameIdNum = Number(mlbGameIdStr);
    if (!Number.isSafeInteger(mlbGameIdNum) || mlbGameIdNum <= 0) return [];

    const normalizeTeamKey = (value: string | null | undefined): string =>
      String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    const {
      fetchGames,
      fetchGameStats,
      calculateMLBFantasyPoints,
      createMLBPlayerId,
      getMLBAwayTeam,
      getMLBHomeTeamName,
      getMLBAwayTeamName,
      getMLBTeamDisplayName,
      getMLBStatGameId,
      getMLBStatTeamAbbreviation,
      getMLBStatTeamName,
    } = await import("./mlb-statsapi");

    const gameStartTime = new Date(game.startTime);
    const lookupDates = Array.from(
      new Set([
        getGameDay(new Date(gameStartTime.getTime() - 24 * 60 * 60 * 1000)),
        getGameDay(gameStartTime),
        getGameDay(new Date(gameStartTime.getTime() + 24 * 60 * 60 * 1000)),
      ]),
    );

    const [mlbStats, mlbGames] = await Promise.all([
      fetchGameStats([mlbGameIdNum]),
      fetchGames({ dates: lookupDates }),
    ]);
    if (mlbStats.length === 0) return [];

    const apiGame =
      mlbGames.find((candidateGame: any) => Number(candidateGame.id) === mlbGameIdNum) || null;
    const liveHomeTeam = apiGame?.home_team?.abbreviation
      ? String(apiGame.home_team.abbreviation).toUpperCase()
      : game.homeTeam;
    const apiAwayTeam = apiGame ? getMLBAwayTeam(apiGame) : null;
    const liveAwayTeam = apiAwayTeam?.abbreviation
      ? String(apiAwayTeam.abbreviation).toUpperCase()
      : game.awayTeam;
    const homeAbbreviation = normalizeTeamKey(apiGame?.home_team?.abbreviation || liveHomeTeam);
    const awayAbbreviation = normalizeTeamKey(apiAwayTeam?.abbreviation || liveAwayTeam);

    const homeNameKeys = new Set(
      [
        game.homeTeam,
        liveHomeTeam,
        apiGame ? getMLBHomeTeamName(apiGame) : null,
        apiGame ? getMLBTeamDisplayName(apiGame.home_team) : null,
        apiGame?.home_team?.name,
        apiGame?.home_team?.display_name,
        apiGame?.home_team?.short_display_name,
      ]
        .map(normalizeTeamKey)
        .filter(Boolean),
    );
    const awayNameKeys = new Set(
      [
        game.awayTeam,
        liveAwayTeam,
        apiGame ? getMLBAwayTeamName(apiGame) : null,
        getMLBTeamDisplayName(apiAwayTeam),
        apiAwayTeam?.name,
        apiAwayTeam?.display_name,
        apiAwayTeam?.short_display_name,
      ]
        .map(normalizeTeamKey)
        .filter(Boolean),
    );

    const getStatSide = (stat: (typeof mlbStats)[number]): "home" | "away" | null => {
      const statGameId = getMLBStatGameId(stat);
      if (statGameId != null && statGameId !== mlbGameIdNum) return null;

      const statAbbreviation = normalizeTeamKey(getMLBStatTeamAbbreviation(stat));
      if (statAbbreviation) {
        if (homeAbbreviation && statAbbreviation === homeAbbreviation) return "home";
        if (awayAbbreviation && statAbbreviation === awayAbbreviation) return "away";
      }

      const statTeamName = normalizeTeamKey(getMLBStatTeamName(stat));
      if (!statTeamName) return null;
      if (homeNameKeys.has(statTeamName)) return "home";
      if (awayNameKeys.has(statTeamName)) return "away";

      return null;
    };

    return mlbStats.map((stat) => {
      const side = getStatSide(stat);
      return {
        playerId: createMLBPlayerId(stat.player.id),
        name: `${stat.player.first_name} ${stat.player.last_name}`.trim(),
        team:
          side === "home"
            ? liveHomeTeam || game.homeTeam
            : side === "away"
              ? liveAwayTeam || game.awayTeam
              : getMLBStatTeamAbbreviation(stat) || getMLBStatTeamName(stat) || "UNK",
        fantasyPoints: calculateMLBFantasyPoints(stat),
      };
    });
  }

  return [];
}

async function getLiveEarningsPlayersForGame(game: DailyGame): Promise<LiveEarningsPlayer[]> {
  const cacheKey = `live_earnings:players:${String(game.sport || "").toUpperCase()}:${game.gameId}`;
  const LIVE_EARNINGS_PROVIDER_CACHE_TTL_MS = 15 * 1000;

  return getOrCompute(
    cacheKey,
    async () => {
      try {
        const providerPlayers = await getProviderLiveEarningsPlayersForGame(game);
        if (providerPlayers.length > 0) {
          return providerPlayers;
        }
      } catch (error: any) {
        console.warn(
          `[live-earnings] Provider player stats unavailable for ${game.gameId}:`,
          error?.message || error,
        );
      }

      return getStoredLiveEarningsPlayersForGame(game);
    },
    LIVE_EARNINGS_PROVIDER_CACHE_TTL_MS,
  );
}

async function buildUserLiveEarningsSummary(params: {
  game: Pick<DailyGame, "sport" | "homeTeam" | "awayTeam">;
  userId?: string | null;
  livePlayers: LiveEarningsPlayer[];
  preloadedHoldings?: any[];
}): Promise<UserLiveEarningsSummary | null> {
  const { game, userId, livePlayers, preloadedHoldings } = params;
  if (!userId) return null;

  const holdingsWithPlayers =
    preloadedHoldings ?? (await storage.getAllHoldingsWithPlayers(userId));
  const liveByPlayerId = new Map<string, number>();
  const liveByNameAndTeam = new Map<string, number>();

  livePlayers.forEach((player) => {
    const rawId = String(player.playerId || "").trim();
    if (rawId) {
      getLiveEarningsPlayerIdCandidates(rawId, game.sport).forEach((candidateId) => {
        const existing = liveByPlayerId.get(candidateId) || 0;
        if (player.fantasyPoints > existing) {
          liveByPlayerId.set(candidateId, player.fantasyPoints);
        }
      });
    }

    if (player.name && player.team) {
      const key = getLiveEarningsNameTeamKey(player.name, player.team);
      const existing = liveByNameAndTeam.get(key) || 0;
      if (player.fantasyPoints > existing) {
        liveByNameAndTeam.set(key, player.fantasyPoints);
      }
    }
  });

  const aggregatedOwnedPlayers = holdingsWithPlayers
    .filter((entry: any) => {
      const holding = entry?.holding ?? entry;
      const player = entry?.player;
      if (!holding || !player) return false;
      if ((holding.assetType || "player") !== "player") return false;
      if ((player.sport || "").toUpperCase() !== String(game.sport || "").toUpperCase())
        return false;
      if (player.team !== game.homeTeam && player.team !== game.awayTeam) return false;
      return getPerformanceEarningUnits(holding) > 0;
    })
    .reduce((map: Map<string, any>, entry: any) => {
      const holding = entry?.holding ?? entry;
      const player = entry?.player;
      const playerId = String(player?.id || "").trim();
      if (!playerId) return map;

      const playerName = `${player?.firstName || ""} ${player?.lastName || ""}`.trim();
      const fantasyPointsById =
        getLiveEarningsPlayerIdCandidates(playerId, game.sport)
          .map((candidateId) => liveByPlayerId.get(candidateId) || 0)
          .find((value) => value > 0) || 0;
      const fantasyPointsByName =
        liveByNameAndTeam.get(getLiveEarningsNameTeamKey(playerName, player?.team)) || 0;
      const fantasyPoints = fantasyPointsById || fantasyPointsByName;
      const quantity = parseLiveEarningsNumber(holding.quantity);
      const effectiveShares = getPerformanceEarningUnits(holding);

      const existing = map.get(playerId);
      if (!existing) {
        map.set(playerId, {
          playerId,
          name: playerName,
          team: player.team,
          quantity,
          effectiveShares,
          fantasyPoints,
        });
        return map;
      }

      existing.quantity += quantity;
      existing.effectiveShares += effectiveShares;
      return map;
    }, new Map<string, any>());

  const ownedPlayers = Array.from(aggregatedOwnedPlayers.values())
    .map((player) => {
      const estimatedEarnings = player.fantasyPoints * player.effectiveShares;

      return {
        playerId: player.playerId,
        name: player.name,
        team: player.team,
        quantity: parseFloat(player.quantity.toFixed(4)),
        effectiveShares: parseFloat(player.effectiveShares.toFixed(2)),
        fantasyPoints: parseFloat(player.fantasyPoints.toFixed(2)),
        estimatedEarnings: parseFloat(estimatedEarnings.toFixed(2)),
      };
    })
    .sort((a, b) => {
      if (b.estimatedEarnings !== a.estimatedEarnings) {
        return b.estimatedEarnings - a.estimatedEarnings;
      }
      if (b.fantasyPoints !== a.fantasyPoints) {
        return b.fantasyPoints - a.fantasyPoints;
      }
      return a.name.localeCompare(b.name);
    });

  if (ownedPlayers.length === 0) {
    return null;
  }

  const totalEstimatedEarnings = ownedPlayers.reduce(
    (sum, player) => sum + player.estimatedEarnings,
    0,
  );

  return {
    totalEstimatedEarnings: parseFloat(totalEstimatedEarnings.toFixed(2)),
    ownedPlayers,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication middleware
  await setupAuth(app);

  // Legacy player order-book mode is archived; player trading is AMM-only.
  const isAmmOnlyMode = true;
  const configuredSiteUrl = normalizeSiteUrl(
    process.env.PUBLIC_SITE_URL?.trim() ||
      process.env.SITE_URL?.trim() ||
      process.env.VITE_PUBLIC_SITE_URL?.trim(),
  );
  const publicApiVersion =
    process.env.PUBLIC_API_VERSION?.trim() ||
    process.env.APP_VERSION?.trim() ||
    process.env.npm_package_version?.trim() ||
    "2026-02-25";

  const getCanonicalSiteUrl = (req: Request): string => {
    if (
      process.env.PUBLIC_SITE_URL?.trim() ||
      process.env.SITE_URL?.trim() ||
      process.env.VITE_PUBLIC_SITE_URL?.trim()
    ) {
      return configuredSiteUrl;
    }

    if (process.env.NODE_ENV === "production") {
      return "https://www.sportfolio.market";
    }

    const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.get("host");
    const proto = forwardedProto || req.protocol || "https";

    if (!host) return configuredSiteUrl;
    return normalizeSiteUrl(`${proto}://${host}`);
  };

  const setPublicDataHeaders = (
    res: Response,
    options?: {
      generatedAt?: Date;
      lastModifiedAt?: Date;
      maxAgeSeconds?: number;
      sharedMaxAgeSeconds?: number;
    },
  ) => {
    const generatedAt = options?.generatedAt || new Date();
    const lastModifiedAt = options?.lastModifiedAt || generatedAt;
    const maxAge = options?.maxAgeSeconds ?? 60;
    const sharedMaxAge = options?.sharedMaxAgeSeconds ?? maxAge;

    res.setHeader("Cache-Control", `public, max-age=${maxAge}, s-maxage=${sharedMaxAge}`);
    res.setHeader("Last-Modified", lastModifiedAt.toUTCString());
    res.setHeader("X-Public-Data-Version", publicApiVersion);
    res.setHeader("X-Data-Generated-At", generatedAt.toISOString());
  };

  const withPublicDataHeaders = <T>(
    res: Response,
    data: T,
    options?: {
      generatedAt?: Date;
      lastModifiedAt?: Date;
      maxAgeSeconds?: number;
      sharedMaxAgeSeconds?: number;
    },
  ) => {
    setPublicDataHeaders(res, options);
    return data;
  };

  // Best-effort: ensure LP fee-growth columns exist.
  // This project historically applies SQL migrations manually; if prod misses a migration,
  // a single missing column can break market carousels and AMM reads.
  // Safe to re-run due to IF NOT EXISTS.
  const ensureLpFeeGrowthColumns = async () => {
    try {
      await db.execute(sql`
        ALTER TABLE player_pools
          ADD COLUMN IF NOT EXISTS fee_growth_per_lp_share numeric(24, 12) NOT NULL DEFAULT 0;
      `);
      await db.execute(sql`
        ALTER TABLE lp_positions
          ADD COLUMN IF NOT EXISTS fee_growth_snapshot numeric(24, 12) NOT NULL DEFAULT 0;
      `);
      await db.execute(sql`
        ALTER TABLE lp_positions
          ADD COLUMN IF NOT EXISTS fees_earned_total numeric(12, 2) NOT NULL DEFAULT 0;
      `);
    } catch (err: any) {
      // If permissions are restricted, continue running; endpoints that don't need these columns still work.
      console.warn("[DB] Could not ensure LP fee-growth columns:", err?.message || err);
    }
  };

  const ensurePremiumActivitySchema = async () => {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS premium_activity_events (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event_type text NOT NULL,
          quantity_delta integer NOT NULL DEFAULT 0,
          amount_cents integer,
          days_granted integer,
          premium_expires_at_after timestamp,
          reference_id varchar,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamp NOT NULL DEFAULT now()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS premium_activity_user_created_idx
          ON premium_activity_events(user_id, created_at);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS premium_activity_event_type_idx
          ON premium_activity_events(event_type);
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS premium_activity_event_ref_idx
          ON premium_activity_events(event_type, reference_id);
      `);
    } catch (err: any) {
      console.warn("[DB] Could not ensure premium activity schema:", err?.message || err);
    }
  };

  // Scout Status Endpoint (Placed early to avoid shadowing)
  app.get("/api/scouts/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const status = await storage.getScoutStatus(userId);
      res.json(status);
    } catch (err: any) {
      console.error("[Scout API] Error getting status:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/market/scanners", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "ALL"; // Default to ALL if not specified
      const scanners = await storage.getFinancialMarketScanners(sport);
      res.json(
        withPublicDataHeaders(res, scanners, { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 }),
      );
    } catch (error) {
      console.error("Error fetching market scanners:", error);
      res.status(500).json({ error: "Failed to fetch market scanners" });
    }
  });

  // DEBUG: Diagnostic endpoint for player query issues
  app.get("/api/debug/players", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "ALL";

      // Test 1: Simple count from players table
      const allPlayers = await storage.getPlayersBySport(sport);

      // Test 2: Paginated query (used by main list)
      const paginated = await storage.getPlayersPaginated({ sport, limit: 5 });

      res.json({
        sport,
        simpleQueryCount: allPlayers.length,
        paginatedQueryCount: paginated.total,
        paginatedSample: paginated.players
          .slice(0, 2)
          .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, sport: p.sport })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  const httpServer = createServer(app);

  // Initialize WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    addClient(ws);
    ws.on("close", () => removeClient(ws));
  });

  // Helper: Get authenticated user ID from session
  const getUserId = (req: any): string => {
    if (!req.user?.claims?.sub) {
      throw new Error("User not authenticated");
    }
    return req.user.claims.sub;
  };

  const resolveAdminReviewerId = async (req: any): Promise<string> => {
    const directReviewerId =
      (typeof req?.user?.claims?.sub === "string" && req.user.claims.sub) ||
      (typeof req?.user?.id === "string" && req.user.id) ||
      (typeof req?.adminContext?.userId === "string" && req.adminContext.userId) ||
      null;

    if (directReviewerId) {
      return directReviewerId;
    }

    const [fallbackAdmin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isAdmin, true))
      .limit(1);

    if (fallbackAdmin?.id) {
      return fallbackAdmin.id;
    }

    throw new Error("No admin reviewer identity is available for this action.");
  };

  const normalizeAgentErrorMessage = (error: any): string => {
    const message = String(error?.message || "Agent request failed");
    const normalized = message.toLowerCase();

    if (
      (normalized.includes("relation") || normalized.includes("column")) &&
      normalized.includes("does not exist")
    ) {
      if (normalized.includes("user_mcp_sources")) {
        return "Agent external MCP source schema is missing or outdated. Apply the latest migration and restart the server.";
      }

      return "Agent database schema is missing or outdated. Apply the latest migration and restart the server.";
    }

    return message;
  };

  const getAgentErrorStatus = (error: any): number => {
    const message = normalizeAgentErrorMessage(error).toLowerCase();

    if (message.includes("not found")) {
      return 404;
    }

    if (message.includes("schema is missing or outdated")) {
      return 503;
    }

    if (
      message.includes("user_agent_secret_key is not configured") ||
      (message.includes("managed ") && message.includes(" provider is not configured")) ||
      message.includes("agent provider is not fully configured") ||
      message.includes("hosted brave search is not configured") ||
      message.includes("missing a default model")
    ) {
      return 503;
    }

    if (
      message.includes("byok is selected but no api key is configured") ||
      message.includes("byok is selected but no base url is configured")
    ) {
      return 400;
    }

    if (
      message.includes("rate limit") ||
      message.includes("already running") ||
      message.includes("disabled") ||
      message.includes("invalid") ||
      message.includes("must") ||
      message.includes("exceeds") ||
      message.includes("duplicate") ||
      message.includes("unsupported") ||
      message.includes("no pending") ||
      message.includes("only completed")
    ) {
      return 400;
    }

    return 500;
  };

  const buildGameInsights = async ({
    games,
    sport,
    dateStr,
    userId,
    includeMlbGameDetails = false,
    includeMlbDeepContext = includeMlbGameDetails,
  }: {
    games: DailyGame[];
    sport: string;
    dateStr: string;
    userId?: string | null;
    includeMlbGameDetails?: boolean;
    includeMlbDeepContext?: boolean;
  }): Promise<{
    insights: GameInsight[];
    boostSlotsRemaining: number | null;
    slatePlayers: GameInsightSlatePlayer[];
  }> => {
    const normalizedSport = (sport || "NBA").toUpperCase();
    const teamsBySport = new Map<string, Set<string>>();
    const liveMarketStatusByGameId = new Map<string, string>();
    const providerStatusByGameId = new Map<
      string,
      "scheduled" | "inprogress" | "completed" | "postponed"
    >();
    const providerScoreByGameId = new Map<
      string,
      { homeScore: number | null; awayScore: number | null }
    >();
    const providerTeamsByGameId = new Map<
      string,
      { homeTeam: string | null; awayTeam: string | null }
    >();
    const allGameIdsBySport = new Map<string, Set<string>>();
    const roundToTwo = (value: number) => Math.round(value * 100) / 100;
    const normalizeInsightStatus = (
      status: string | null | undefined,
    ): "scheduled" | "inprogress" | "completed" | "postponed" => {
      const normalized = String(status || "scheduled").toLowerCase();
      if (normalized === "inprogress") return "inprogress";
      if (normalized === "completed") return "completed";
      if (normalized === "postponed") return "postponed";
      return "scheduled";
    };
    const toUnprefixedGameId = (rawGameId: string | null | undefined) =>
      String(rawGameId || "")
        .trim()
        .replace(/^(nba_|nfl_|mlb_|nascar_)/i, "");
    const normalizeClockValue = (rawClock: string | null | undefined): string | null => {
      const text = String(rawClock || "").trim();
      if (!text || text === "0" || text === "00") return null;

      const mmssMatch = text.match(/(\d{1,2}):(\d{2})/);
      if (mmssMatch) {
        const minutes = Number(mmssMatch[1]);
        const seconds = mmssMatch[2];
        if (!Number.isFinite(minutes)) return null;
        return `${minutes}:${seconds}`;
      }

      return null;
    };
    const normalizeTeamCode = (rawTeam: string | null | undefined): string | null => {
      const value = String(rawTeam || "")
        .trim()
        .toUpperCase();
      if (!value || value === "TBD") return null;
      return value;
    };
    const parseProviderScore = (rawScore: unknown): number | null => {
      if (typeof rawScore === "number") {
        return Number.isFinite(rawScore) ? rawScore : null;
      }
      if (typeof rawScore === "string") {
        const trimmed = rawScore.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const extractClockFromText = (rawText: string | null | undefined): string | null => {
      const text = String(rawText || "");
      const match = text.match(/(\d{1,2}:\d{2})/);
      if (!match) return null;
      return normalizeClockValue(match[1]);
    };
    const normalizeProviderStatusText = (rawStatus: string | null | undefined) =>
      String(rawStatus || "")
        .trim()
        .toLowerCase()
        .replace(/^status[\s_-]*/, "")
        .replace(/_/g, " ")
        .trim();
    const extractQuarterNumber = (normalizedStatus: string): number | null => {
      const ordinalQuarter = normalizedStatus.match(/([1-4])(st|nd|rd|th)\s*(qtr|quarter)/);
      if (ordinalQuarter) {
        const quarterNumber = Number(ordinalQuarter[1]);
        return Number.isFinite(quarterNumber) ? quarterNumber : null;
      }

      const prefixedQuarter = normalizedStatus.match(/\bq([1-4])\b/);
      if (prefixedQuarter) {
        const quarterNumber = Number(prefixedQuarter[1]);
        return Number.isFinite(quarterNumber) ? quarterNumber : null;
      }

      const suffixedQuarter = normalizedStatus.match(/\b([1-4])q\b/);
      if (suffixedQuarter) {
        const quarterNumber = Number(suffixedQuarter[1]);
        return Number.isFinite(quarterNumber) ? quarterNumber : null;
      }

      return null;
    };
    const extractInningNumber = (normalizedStatus: string): number | null => {
      const inningMatch = normalizedStatus.match(/\b(\d{1,2})(st|nd|rd|th)?\s*inning\b/);
      if (inningMatch) {
        const inning = Number(inningMatch[1]);
        return Number.isFinite(inning) ? inning : null;
      }

      const shortInningMatch = normalizedStatus.match(/\b([tbm])\s*(\d{1,2})\b/);
      if (shortInningMatch) {
        const inning = Number(shortInningMatch[2]);
        return Number.isFinite(inning) ? inning : null;
      }

      return null;
    };
    const formatNbaLiveMarketStatus = (
      rawStatus: string | null | undefined,
      period: number | null | undefined,
      rawClock: string | null | undefined,
    ): string | null => {
      const statusText = String(rawStatus || "").trim();
      const normalized = statusText.toLowerCase();
      const clock = normalizeClockValue(rawClock) || extractClockFromText(statusText);

      if (normalized.includes("half")) return "HALF";

      if (normalized.includes("ot") || normalized.includes("overtime")) {
        return clock ? `OT ${clock}` : "OT";
      }

      const periodNumber = Number(period);
      if (Number.isFinite(periodNumber) && periodNumber > 0) {
        const frameLabel =
          periodNumber <= 4
            ? `Q${periodNumber}`
            : periodNumber === 5
              ? "OT"
              : `${periodNumber - 4}OT`;
        return clock ? `${frameLabel} ${clock}` : frameLabel;
      }

      const quarterNumberFromStatus = extractQuarterNumber(normalized);
      if (quarterNumberFromStatus) {
        const quarterLabel = `Q${quarterNumberFromStatus}`;
        return clock ? `${quarterLabel} ${clock}` : quarterLabel;
      }

      return statusText ? statusText.toUpperCase() : null;
    };
    const formatNflLiveMarketStatus = (
      rawStatus: string | null | undefined,
      rawClock: string | null | undefined,
    ): string | null => {
      const statusText = String(rawStatus || "").trim();
      const normalized = statusText.toLowerCase();
      const clock = normalizeClockValue(rawClock) || extractClockFromText(statusText);

      if (normalized.includes("half")) return "HALF";

      if (normalized.includes("ot") || normalized.includes("overtime")) {
        return clock ? `OT ${clock}` : "OT";
      }

      const quarterNumberFromStatus = extractQuarterNumber(normalized);
      if (quarterNumberFromStatus) {
        const quarterLabel = `Q${quarterNumberFromStatus}`;
        return clock ? `${quarterLabel} ${clock}` : quarterLabel;
      }

      if (normalized.includes("in progress") || normalized === "live") {
        return clock ? `LIVE ${clock}` : "LIVE";
      }

      return statusText ? statusText.toUpperCase() : null;
    };
    const formatMlbLiveMarketStatus = (
      rawStatus: string | null | undefined,
      rawPeriod?: number | null,
    ): string | null => {
      const statusText = String(rawStatus || "").trim();
      if (!statusText) return null;

      const normalized = normalizeProviderStatusText(statusText);
      const inningFromStatus = extractInningNumber(normalized);
      const inningFromText = statusText.match(/\b([tbm])(\d{1,2})\b/i);
      const parsedPeriod = Number(rawPeriod);
      const inning =
        Number.isFinite(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : inningFromStatus;

      if (
        normalized === "in progress" ||
        normalized === "live" ||
        normalized.includes("in progress") ||
        normalized.includes("top") ||
        normalized.includes("bottom") ||
        normalized.includes("mid") ||
        normalized.includes("inning")
      ) {
        if (inningFromText) {
          const frame = inningFromText[1].toUpperCase();
          const frameLabel = frame === "T" ? "TOP" : frame === "B" ? "BOT" : "MID";
          return `${frameLabel} ${inningFromText[2]}`;
        }
        if (inning && inning > 0) return `INNING ${inning}`;
        return "LIVE";
      }

      if (normalized.includes("final") || normalized.includes("completed")) {
        return "FINAL";
      }

      return statusText;
    };
    games.forEach((game) => {
      const gameSport = (normalizedSport === "ALL" ? game.sport : normalizedSport).toUpperCase();
      const teams = teamsBySport.get(gameSport) || new Set<string>();
      teams.add(game.homeTeam);
      teams.add(game.awayTeam);
      teamsBySport.set(gameSport, teams);

      const ids = allGameIdsBySport.get(gameSport) || new Set<string>();
      const unprefixed = toUnprefixedGameId(game.gameId);
      if (unprefixed) ids.add(unprefixed);
      if (game.gameId) ids.add(game.gameId);
      if (unprefixed) ids.add(`${gameSport.toLowerCase()}_${unprefixed}`);
      allGameIdsBySport.set(gameSport, ids);
    });

    const inprogressGameIdsBySport = new Map<string, Set<string>>();
    const nowMs = Date.now();
    const liveWindowMs = 6 * 60 * 60 * 1000;
    games.forEach((game) => {
      const normalizedStatus = normalizeInsightStatus(game.status);
      const gameStartMs = new Date(game.startTime).getTime();
      const looksLiveByStartTime =
        normalizedStatus === "scheduled" &&
        Number.isFinite(gameStartMs) &&
        gameStartMs <= nowMs &&
        nowMs - gameStartMs <= liveWindowMs;
      if (normalizedStatus !== "inprogress" && !looksLiveByStartTime) return;

      const gameSport = (game.sport || normalizedSport).toUpperCase();
      const ids = inprogressGameIdsBySport.get(gameSport) || new Set<string>();
      const unprefixed = toUnprefixedGameId(game.gameId);
      if (unprefixed) ids.add(unprefixed);
      if (game.gameId) ids.add(game.gameId);
      if (unprefixed) ids.add(`${gameSport.toLowerCase()}_${unprefixed}`);
      inprogressGameIdsBySport.set(gameSport, ids);
    });

    type ProviderGameSnapshot = {
      gameId: string;
      status?: string | null;
      period?: number | null;
      clock?: string | null;
      normalizedStatus?: "scheduled" | "inprogress" | "completed" | "postponed";
      homeScore?: number | null;
      awayScore?: number | null;
      homeTeam?: string | null;
      awayTeam?: string | null;
    };

    const normalizeNflProviderStatus = (
      rawStatus: string | null | undefined,
    ): "scheduled" | "inprogress" | "completed" | "postponed" => {
      const normalized = normalizeProviderStatusText(rawStatus);
      if (!normalized) return "scheduled";

      if (
        normalized.includes("postponed") ||
        normalized.includes("delayed") ||
        normalized.includes("suspended") ||
        normalized.includes("cancel")
      ) {
        return "postponed";
      }

      if (
        normalized.includes("final") ||
        normalized.includes("completed") ||
        normalized.includes("ended")
      ) {
        return "completed";
      }

      if (
        normalized.includes("in progress") ||
        normalized === "live" ||
        normalized.includes("quarter") ||
        /\bq[1-4]\b/.test(normalized) ||
        normalized.includes("half") ||
        normalized.includes("ot")
      ) {
        return "inprogress";
      }

      return "scheduled";
    };

    const addLiveMarketStatus = (
      gameSport: string,
      rawGameId: string,
      value: string | null | undefined,
    ) => {
      const formatted = String(value || "").trim();
      if (!formatted) return;

      const unprefixed = toUnprefixedGameId(rawGameId);
      if (!unprefixed) return;

      const prefixed = `${gameSport.toLowerCase()}_${unprefixed}`;
      liveMarketStatusByGameId.set(unprefixed, formatted);
      liveMarketStatusByGameId.set(prefixed, formatted);
    };
    const addProviderStatus = (
      gameSport: string,
      rawGameId: string,
      status: "scheduled" | "inprogress" | "completed" | "postponed" | null | undefined,
    ) => {
      if (!status) return;

      const unprefixed = toUnprefixedGameId(rawGameId);
      if (!unprefixed) return;

      const prefixed = `${gameSport.toLowerCase()}_${unprefixed}`;
      providerStatusByGameId.set(unprefixed, status);
      providerStatusByGameId.set(prefixed, status);
    };
    const addProviderScores = (
      gameSport: string,
      rawGameId: string,
      homeScore: number | null | undefined,
      awayScore: number | null | undefined,
    ) => {
      if (homeScore == null && awayScore == null) return;

      const unprefixed = toUnprefixedGameId(rawGameId);
      if (!unprefixed) return;

      const prefixed = `${gameSport.toLowerCase()}_${unprefixed}`;
      const scoreRecord = {
        homeScore: homeScore ?? null,
        awayScore: awayScore ?? null,
      };
      providerScoreByGameId.set(unprefixed, scoreRecord);
      providerScoreByGameId.set(prefixed, scoreRecord);
    };
    const addProviderTeams = (
      gameSport: string,
      rawGameId: string,
      homeTeam: string | null | undefined,
      awayTeam: string | null | undefined,
    ) => {
      const normalizedHomeTeam = normalizeTeamCode(homeTeam);
      const normalizedAwayTeam = normalizeTeamCode(awayTeam);
      if (!normalizedHomeTeam && !normalizedAwayTeam) return;

      const unprefixed = toUnprefixedGameId(rawGameId);
      if (!unprefixed) return;

      const prefixed = `${gameSport.toLowerCase()}_${unprefixed}`;
      const payload = { homeTeam: normalizedHomeTeam, awayTeam: normalizedAwayTeam };
      providerTeamsByGameId.set(unprefixed, payload);
      providerTeamsByGameId.set(prefixed, payload);
    };

    await Promise.all(
      Array.from(allGameIdsBySport.entries()).map(async ([gameSport, allGameIds]) => {
        if (allGameIds.size === 0) return;
        const targetGameIds = inprogressGameIdsBySport.get(gameSport) || new Set<string>();

        const cacheKey = `games_insights:live_market:${gameSport}:${dateStr}`;
        try {
          const providerGames = await getOrCompute<ProviderGameSnapshot[]>(
            cacheKey,
            async () => {
              if (gameSport === "MLB") {
                const {
                  fetchGames,
                  normalizeGameStatus: normalizeMlbGameStatus,
                  getMLBHomeScore,
                  getMLBAwayScore,
                  getMLBAwayTeam,
                } = await import("./mlb-statsapi");
                const apiGames = await fetchGames({ dates: [dateStr] });
                return apiGames.map((apiGame: any) => ({
                  gameId: String(apiGame.id),
                  status: apiGame.status,
                  normalizedStatus: normalizeInsightStatus(
                    normalizeMlbGameStatus(String(apiGame.status || "")),
                  ),
                  period: Number(apiGame.period || 0),
                  clock: apiGame.display_clock
                    ? String(apiGame.display_clock)
                    : apiGame.clock != null
                      ? String(apiGame.clock)
                      : null,
                  homeScore: getMLBHomeScore(apiGame),
                  awayScore: getMLBAwayScore(apiGame),
                  homeTeam: apiGame.home_team?.abbreviation
                    ? String(apiGame.home_team.abbreviation)
                    : null,
                  awayTeam: getMLBAwayTeam(apiGame)?.abbreviation
                    ? String(getMLBAwayTeam(apiGame)?.abbreviation || "")
                    : null,
                }));
              }

              return [];
            },
            12_000,
          );

          for (const providerGame of providerGames) {
            const unprefixed = toUnprefixedGameId(providerGame.gameId);
            const prefixed = `${gameSport.toLowerCase()}_${unprefixed}`;
            addProviderTeams(
              gameSport,
              providerGame.gameId,
              providerGame.homeTeam,
              providerGame.awayTeam,
            );
            if (!targetGameIds.has(unprefixed) && !targetGameIds.has(prefixed)) {
              continue;
            }

            const statusLabel =
              gameSport === "NBA"
                ? formatNbaLiveMarketStatus(
                    providerGame.status,
                    providerGame.period,
                    providerGame.clock,
                  )
                : gameSport === "NFL"
                  ? formatNflLiveMarketStatus(providerGame.status, providerGame.clock)
                  : gameSport === "MLB"
                    ? formatMlbLiveMarketStatus(providerGame.status, providerGame.period)
                    : null;

            addLiveMarketStatus(gameSport, providerGame.gameId, statusLabel);
            addProviderStatus(gameSport, providerGame.gameId, providerGame.normalizedStatus);
            addProviderScores(
              gameSport,
              providerGame.gameId,
              providerGame.homeScore,
              providerGame.awayScore,
            );
          }
        } catch (error: any) {
          console.warn(
            `[games/insights] Live market status enrichment failed for ${gameSport}:`,
            error?.message || error,
          );
        }
      }),
    );

    games.forEach((game) => {
      const providerTeams =
        providerTeamsByGameId.get(game.gameId) ||
        providerTeamsByGameId.get(toUnprefixedGameId(game.gameId)) ||
        null;

      if (providerTeams?.homeTeam) {
        game.homeTeam = providerTeams.homeTeam;
      }
      if (providerTeams?.awayTeam) {
        game.awayTeam = providerTeams.awayTeam;
      }
    });

    teamsBySport.clear();
    games.forEach((game) => {
      const gameSport = (normalizedSport === "ALL" ? game.sport : normalizedSport).toUpperCase();
      const teams = teamsBySport.get(gameSport) || new Set<string>();
      teams.add(game.homeTeam);
      teams.add(game.awayTeam);
      teamsBySport.set(gameSport, teams);
    });

    const teamPlayers =
      teamsBySport.size > 0
        ? (
            await Promise.all(
              Array.from(teamsBySport.entries())
                .filter(([, teamSet]) => teamSet.size > 0)
                .map(([gameSport, teamSet]) =>
                  db
                    .select()
                    .from(players)
                    .where(
                      and(
                        sql`UPPER(${players.sport}) = ${gameSport}`,
                        inArray(players.team, Array.from(teamSet)),
                        eq(players.isActive, true),
                      ),
                    ),
                ),
            )
          ).flat()
        : [];

    const playerIds = teamPlayers.map((player) => player.id);
    const [seasonStatsMap, scoutCountsMap] = await Promise.all([
      storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
      storage.getBatchActiveScoutCounts(playerIds),
    ]);

    const playerTeamKey = (playerSport: string, team: string) =>
      `${playerSport.toUpperCase()}:${team.toUpperCase()}`;

    const gameIdsByTeam = new Map<string, Set<string>>();
    games.forEach((game) => {
      const gameSport = (normalizedSport === "ALL" ? game.sport : normalizedSport).toUpperCase();
      const homeKey = playerTeamKey(gameSport, game.homeTeam);
      const awayKey = playerTeamKey(gameSport, game.awayTeam);

      const homeGames = gameIdsByTeam.get(homeKey) || new Set<string>();
      homeGames.add(game.gameId);
      gameIdsByTeam.set(homeKey, homeGames);

      const awayGames = gameIdsByTeam.get(awayKey) || new Set<string>();
      awayGames.add(game.gameId);
      gameIdsByTeam.set(awayKey, awayGames);
    });

    const playersByTeam = new Map<string, typeof teamPlayers>();
    teamPlayers.forEach((player) => {
      const teamKey = playerTeamKey(player.sport, player.team);
      const list = playersByTeam.get(teamKey) || [];
      list.push(player);
      playersByTeam.set(teamKey, list);
    });

    const getCandidates = (game: DailyGame) => {
      const gameSport = (normalizedSport === "ALL" ? game.sport : normalizedSport).toUpperCase();
      const candidates = [
        ...(playersByTeam.get(playerTeamKey(gameSport, game.homeTeam)) || []),
        ...(playersByTeam.get(playerTeamKey(gameSport, game.awayTeam)) || []),
      ];

      return candidates.map((player) => ({
        player,
        avgFantasyPointsPerGame: parseFloat(
          seasonStatsMap.get(player.id)?.avgFantasyPointsPerGame || "0",
        ),
        totalShares: player.totalShares || 0,
        scoutCount: scoutCountsMap.get(player.id) || 0,
      }));
    };

    const buildLeader = (candidate: {
      player: Player;
      avgFantasyPointsPerGame: number;
      totalShares: number;
      scoutCount: number;
    }): GameInsightLeader => ({
      playerId: candidate.player.id,
      name: `${candidate.player.firstName} ${candidate.player.lastName}`,
      team: candidate.player.team,
      avgFantasyPointsPerGame: candidate.avgFantasyPointsPerGame,
      totalShares: candidate.totalShares,
      scoutCount: candidate.scoutCount,
    });

    const storedFantasyPointsByGameAndPlayer = new Map<string, number>();
    const getSlateFantasyPointsKey = (gameId: string, playerId: string) => `${gameId}:${playerId}`;

    let boostSlotsRemaining: number | null = null;
    const userContextByGame = new Map<string, GameInsightUserContext>();
    const gameLiveEarnedById = new Map<string, number | null>();
    const boostedPlayerIds = new Set<string>();
    const sortOwnedPlayers = (
      ownedPlayers: GameInsightUserContext["ownedPlayers"],
    ): GameInsightUserContext["ownedPlayers"] =>
      [...ownedPlayers].sort((a, b) => {
        if (b.multiplier !== a.multiplier) return b.multiplier - a.multiplier;
        if (b.totalShares !== a.totalShares) return b.totalShares - a.totalShares;
        return a.name.localeCompare(b.name);
      });

    if (userId) {
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
      const [eligiblePlayers, currentBoosts, allHoldings] = await Promise.all([
        storage.getEligiblePlayersForBoost(userId, sport, targetDate),
        storage.getDailyBoosts(userId, sport, targetDate),
        storage.getAllHoldingsWithPlayers(userId),
      ]);

      currentBoosts.forEach((boost) => boostedPlayerIds.add(boost.playerId));
      boostSlotsRemaining = Math.max(0, 4 - currentBoosts.length);

      const eligibleByGame = new Map<string, typeof eligiblePlayers>();
      eligiblePlayers.forEach((player) => {
        if (!player.gameId) return;
        const list = eligibleByGame.get(player.gameId) || [];
        list.push(player);
        eligibleByGame.set(player.gameId, list);
      });

      eligibleByGame.forEach((playersForGame, gameId) => {
        // Each holding row represents a distinct share with its own multiplier/effective-share state.
        // We show individual shares because only ONE share can be placed in a boost slot
        const topMultiplierPlayers = [...playersForGame]
          .sort((a, b) => parseFloat(b.multiplier || "0") - parseFloat(a.multiplier || "0"))
          .slice(0, 2)
          .map((player) => ({
            playerId: player.player.id,
            name: `${player.player.firstName} ${player.player.lastName}`,
            team: player.player.team,
            multiplier: parseFloat(player.multiplier || "0"),
            availableShares: Number(player.availableShares || 0),
            totalShares: Number(player.effectiveShares || player.quantity || 0),
            isBoosted: boostedPlayerIds.has(player.player.id),
          }));

        const ownedPlayersById = new Map<
          string,
          {
            playerId: string;
            name: string;
            team: string;
            multiplier: number;
            availableShares: number;
            totalShares: number;
            isBoosted: boolean;
          }
        >();

        playersForGame.forEach((player) => {
          const playerId = player.player.id;
          const multiplier = parseFloat(player.multiplier || "0");
          const availableShares = Number(player.availableShares || 0);
          const totalShares = Number(player.effectiveShares || player.quantity || 0);
          const existing = ownedPlayersById.get(playerId);

          if (!existing) {
            ownedPlayersById.set(playerId, {
              playerId,
              name: `${player.player.firstName} ${player.player.lastName}`,
              team: player.player.team,
              multiplier,
              availableShares,
              totalShares,
              isBoosted: boostedPlayerIds.has(playerId),
            });
            return;
          }

          existing.multiplier = Math.max(existing.multiplier, multiplier);
          existing.availableShares += availableShares;
          existing.totalShares += totalShares;
          existing.isBoosted = existing.isBoosted || boostedPlayerIds.has(playerId);
        });

        const ownedPlayers = sortOwnedPlayers(Array.from(ownedPlayersById.values()));

        userContextByGame.set(gameId, {
          eligibleCount: playersForGame.length,
          topMultiplierPlayers,
          ownedPlayers,
        });
      });

      allHoldings.forEach((holding) => {
        const totalShares = parseFloat(holding.effectiveShares || holding.quantity || "0");
        if (totalShares <= 0) return;

        const teamKey = playerTeamKey(holding.player.sport, holding.player.team);
        const gameIds = gameIdsByTeam.get(teamKey);
        if (!gameIds || gameIds.size === 0) return;

        const playerId = holding.player.id;
        const fallbackOwnedPlayer = {
          playerId,
          name: `${holding.player.firstName} ${holding.player.lastName}`,
          team: holding.player.team,
          multiplier: parseFloat(holding.multiplier || "0"),
          availableShares: 0,
          totalShares,
          isBoosted: boostedPlayerIds.has(playerId),
        };

        gameIds.forEach((gameId) => {
          const existingContext = userContextByGame.get(gameId);
          if (!existingContext) {
            userContextByGame.set(gameId, {
              eligibleCount: 0,
              topMultiplierPlayers: [],
              ownedPlayers: [fallbackOwnedPlayer],
            });
            return;
          }

          const existingOwnedPlayer = existingContext.ownedPlayers.find(
            (player) => player.playerId === playerId,
          );

          if (!existingOwnedPlayer) {
            existingContext.ownedPlayers.push(fallbackOwnedPlayer);
            existingContext.ownedPlayers = sortOwnedPlayers(existingContext.ownedPlayers);
            return;
          }

          existingOwnedPlayer.multiplier = Math.max(
            existingOwnedPlayer.multiplier,
            fallbackOwnedPlayer.multiplier,
          );
          existingOwnedPlayer.totalShares = Math.max(
            existingOwnedPlayer.totalShares,
            fallbackOwnedPlayer.totalShares,
          );
          existingOwnedPlayer.isBoosted =
            existingOwnedPlayer.isBoosted || fallbackOwnedPlayer.isBoosted;
          existingContext.ownedPlayers = sortOwnedPlayers(existingContext.ownedPlayers);
        });
      });

      await Promise.all(
        games.map(async (game) => {
          const providerStatus =
            providerStatusByGameId.get(game.gameId) ||
            providerStatusByGameId.get(toUnprefixedGameId(game.gameId)) ||
            null;
          const status = providerStatus || normalizeInsightStatus(game.status);

          if (status === "scheduled" || status === "postponed") {
            gameLiveEarnedById.set(game.gameId, null);
            return;
          }

          const livePlayers =
            status === "inprogress"
              ? await getLiveEarningsPlayersForGame(game)
              : await getStoredLiveEarningsPlayersForGame(game);
          const liveEarnings = await buildUserLiveEarningsSummary({
            game,
            userId,
            livePlayers,
            preloadedHoldings: allHoldings,
          });

          gameLiveEarnedById.set(
            game.gameId,
            liveEarnings ? roundToTwo(liveEarnings.totalEstimatedEarnings) : null,
          );
        }),
      );
    }

    await Promise.all(
      games.map(async (game) => {
        const providerStatus =
          providerStatusByGameId.get(game.gameId) ||
          providerStatusByGameId.get(toUnprefixedGameId(game.gameId)) ||
          null;
        const status = providerStatus || normalizeInsightStatus(game.status);

        if (status === "scheduled" || status === "postponed") {
          return;
        }

        const storedPlayers = await getStoredLiveEarningsPlayersForGame(game);
        storedPlayers.forEach((player) => {
          const rawPlayerId = String(player.playerId || "").trim();
          if (!rawPlayerId) return;

          getLiveEarningsPlayerIdCandidates(rawPlayerId, game.sport).forEach((candidateId) => {
            const key = getSlateFantasyPointsKey(game.gameId, candidateId);
            const existing = storedFantasyPointsByGameAndPlayer.get(key) || 0;
            if (player.fantasyPoints > existing) {
              storedFantasyPointsByGameAndPlayer.set(key, player.fantasyPoints);
            }
          });
        });
      }),
    );

    // MLB MCP is display-only. Core gameplay, payouts, and calculations stay on
    // Ball Don't Lie plus our stored game/player data.
    const { insightByGameId: mlbPregameInsightByGameId, statusByGameId: mlbStatusByGameId } =
      await getMlbPregameInsightBundle(games, dateStr, {
        includeGameDetails: includeMlbGameDetails,
        includeDeepContext: includeMlbDeepContext,
      });
    const slatePlayers: GameInsightSlatePlayer[] = [];
    const insights = games.map((game) => {
      const candidates = getCandidates(game);
      const pickLeader = (key: "avgFantasyPointsPerGame" | "totalShares" | "scoutCount") => {
        if (!candidates.length) return null;
        const sorted = [...candidates].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
        const top = sorted[0];
        return top ? buildLeader(top) : null;
      };

      const providerStatus =
        providerStatusByGameId.get(game.gameId) ||
        providerStatusByGameId.get(toUnprefixedGameId(game.gameId)) ||
        null;
      const status = providerStatus || normalizeInsightStatus(game.status);
      const providerScores =
        providerScoreByGameId.get(game.gameId) ||
        providerScoreByGameId.get(toUnprefixedGameId(game.gameId)) ||
        null;
      const homeScore = providerScores?.homeScore ?? game.homeScore ?? null;
      const awayScore = providerScores?.awayScore ?? game.awayScore ?? null;
      const baseUserContext = userContextByGame.get(game.gameId);
      const userContext = userId
        ? {
            eligibleCount: baseUserContext?.eligibleCount || 0,
            topMultiplierPlayers: baseUserContext?.topMultiplierPlayers || [],
            ownedPlayers: baseUserContext?.ownedPlayers || [],
            liveEarned:
              status === "scheduled" || status === "postponed"
                ? null
                : (gameLiveEarnedById.get(game.gameId) ?? null),
            earningsStatus: status,
          }
        : null;
      const liveMarketStatus =
        status === "inprogress"
          ? liveMarketStatusByGameId.get(game.gameId) ||
            liveMarketStatusByGameId.get(toUnprefixedGameId(game.gameId)) ||
            null
          : null;

      candidates.forEach((candidate) => {
        const playerFantasyPoints =
          getLiveEarningsPlayerIdCandidates(candidate.player.id, game.sport)
            .map(
              (candidateId) =>
                storedFantasyPointsByGameAndPlayer.get(
                  getSlateFantasyPointsKey(game.gameId, candidateId),
                ) || 0,
            )
            .find((value) => value > 0) || null;

        slatePlayers.push({
          playerId: candidate.player.id,
          name: `${candidate.player.firstName} ${candidate.player.lastName}`,
          team: candidate.player.team,
          gameId: game.gameId,
          startTime: game.startTime,
          status,
          contextLabel: `${game.awayTeam} @ ${game.homeTeam}`,
          pregameValue: roundToTwo(candidate.avgFantasyPointsPerGame),
          liveValue:
            status === "inprogress" && playerFantasyPoints !== null
              ? roundToTwo(playerFantasyPoints)
              : null,
          finalValue:
            status === "completed" && playerFantasyPoints !== null
              ? roundToTwo(playerFantasyPoints)
              : null,
        });
      });

      const mlbPregameInsight = mlbPregameInsightByGameId.get(game.gameId) || null;
      const mlbEnrichment =
        String(game.sport || "").toUpperCase() === "MLB"
          ? mlbStatusByGameId.get(game.gameId) || {
              state: "pending",
              message: "Game details are pending.",
            }
          : null;
      const leaders = {
        fantasy: pickLeader("avgFantasyPointsPerGame"),
        shares: pickLeader("totalShares"),
        scouts: pickLeader("scoutCount"),
      };
      const mlbSignals =
        String(game.sport || "").toUpperCase() === "MLB"
          ? buildMlbGameplaySignals({
              game: {
                gameId: game.gameId,
                status,
                awayTeam: game.awayTeam,
                homeTeam: game.homeTeam,
              },
              mlbPregame: mlbPregameInsight,
              leaders,
              userContext,
            })
          : [];

      return {
        gameId: game.gameId,
        sport: game.sport,
        gameDay: getGameDay(game.startTime),
        status,
        startTime: game.startTime,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore,
        awayScore,
        venue: game.venue ?? mlbPregameInsight?.venue ?? null,
        leaders,
        userContext,
        liveMarketStatus,
        mlbEnrichment,
        mlbPregame: mlbPregameInsight,
        mlbSignals,
      } satisfies GameInsight;
    });

    return {
      insights,
      boostSlotsRemaining,
      slatePlayers: slatePlayers.sort(sortSlateExposurePlayers),
    };
  };

  // Helper: Enrich player data with last trade price (market value)
  // Now just returns the cached lastTradePrice from database - no additional queries needed
  function enrichPlayerWithMarketValue(player: Player): Player & { lastTradePrice: string | null } {
    return {
      ...player,
      lastTradePrice: player.lastTradePrice || null, // Cached value from database
    };
  }

  // Helper: Calculate P&L for holdings - returns null values if no market price exists
  function calculatePnL(quantity: number, avgCost: string, lastTradePrice: string | null) {
    // If no market price exists (no trades), return null values
    if (!lastTradePrice) {
      return {
        currentValue: null,
        pnl: null,
        pnlPercent: null,
      };
    }

    const cost = parseFloat(avgCost);
    const price = parseFloat(lastTradePrice);
    const totalValue = quantity * price;
    const totalCost = quantity * cost;
    const pnl = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

    return {
      currentValue: totalValue.toFixed(2),
      pnl: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
    };
  }

  // Helper: Sync Whop payments for a user and credit premium shares
  async function syncWhopPaymentsForUser(
    userId: string,
    userEmail: string,
  ): Promise<{
    credited: number;
    revoked: number;
    synced: number;
  }> {
    const result = { credited: 0, revoked: 0, synced: 0 };

    try {
      const apiKey = process.env.WHOP_API_KEY;
      const companyId = process.env.WHOP_COMPANY_ID;

      if (!apiKey) {
        console.log("[WHOP SYNC] No API key configured");
        return result;
      }

      if (!companyId) {
        console.log("[WHOP SYNC] No Company ID configured");
        return result;
      }

      // Use Whop v1 API directly - the SDK uses v5 which returns empty results
      // v1 API: GET https://api.whop.com/api/v1/payments?company_id=...
      const payments: any[] = [];

      try {
        let page = 1;
        let hasMore = true;
        const maxPages = 10; // Safety limit to prevent infinite loops

        while (hasMore && page <= maxPages) {
          const response = await fetch(
            `https://api.whop.com/api/v1/payments?company_id=${companyId}&per_page=100&page=${page}&include=line_items`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WHOP SYNC] API error ${response.status}: ${errorText}`);
            return result;
          }

          const data = await response.json();
          const pagePayments = data.data || [];

          console.log(`[WHOP SYNC] Page ${page}: fetched ${pagePayments.length} payments`);

          // Filter payments matching this user's email (case-insensitive)
          const userPayments = pagePayments.filter(
            (p: any) => p.user?.email?.toLowerCase() === userEmail.toLowerCase(),
          );

          payments.push(...userPayments);

          // Check if there are more pages
          hasMore = pagePayments.length === 100;
          page++;
        }

        console.log(
          `[WHOP SYNC] Found ${payments.length} payments for ${userEmail} (${page - 1} pages)`,
        );
      } catch (err: any) {
        console.error(`[WHOP SYNC] Error querying Whop v1 API:`, err.message);
        return result;
      }

      // Process each payment
      for (const payment of payments) {
        result.synced++;

        const paymentId = payment.id;
        const status = payment.status || "unknown";

        // Check if payment already credited BEFORE any processing
        // Only skip if status is still "paid" (to allow refund/chargeback processing)
        const existingPayment = await storage.getWhopPaymentByPaymentId(paymentId);
        if (existingPayment?.creditedAt && status === "paid") {
          console.log(`[WHOP SYNC] Payment ${paymentId} already credited and still paid, skipping`);
          continue;
        }

        // Detect if this is a community or premium purchase
        const planId = payment.plan_id;
        const totalDollars = payment.total || 0;

        const amountCents = Math.round(totalDollars * 100);
        const classification = classifyWhopPurchase(planId, amountCents);
        if (!classification.assetType) {
          console.warn(
            `[WHOP SYNC] Skipping payment ${paymentId}: unclassified purchase (${classification.reason})`,
          );
          continue;
        }

        const assetType = classification.assetType;
        const pricePerShare = assetType === "community" ? 1 : 5;

        // Extract quantity from line_items first (preferred), fallback to total/price
        let quantity = 0;
        if (payment.line_items && Array.isArray(payment.line_items)) {
          quantity = payment.line_items.reduce(
            (sum: number, item: any) => sum + (item.quantity || 0),
            0,
          );
        }
        // Fallback to total/price if no line_items or zero quantity
        if (quantity === 0 && totalDollars >= pricePerShare) {
          quantity = Math.floor(totalDollars / pricePerShare);
        }

        // Skip payments with no value (refunds, zero-dollar invoices)
        if (quantity === 0 && status === "paid") {
          console.log(`[WHOP SYNC] Skipping zero-value payment ${paymentId}`);
          continue;
        }

        // Upsert the payment record
        await storage.upsertWhopPayment({
          paymentId,
          email: userEmail.toLowerCase(),
          userId: null, // Will be set on credit
          quantity,
          amountCents,
          currency: payment.currency || "usd",
          whopStatus: status,
          rawPayload: payment,
        });

        // Re-fetch the payment record after upsert to get latest state
        const currentPayment = await storage.getWhopPaymentByPaymentId(paymentId);

        // Credit paid payments that haven't been credited yet
        // Use atomic credit-first approach: creditWhopPayment returns undefined if already credited
        // This prevents race conditions where multiple syncs credit the same payment
        if (
          status === "paid" &&
          quantity > 0 &&
          currentPayment &&
          !currentPayment.creditedAt &&
          !currentPayment.revokedAt
        ) {
          const avgCost = assetType === "community" ? "1.0000" : "5.0000";
          const creditResult = await creditPaymentAndHoldingAtomic(
            paymentId,
            userId,
            assetType,
            quantity,
            avgCost,
          );

          if (creditResult) {
            result.credited += quantity;
            if (assetType === "premium") {
              await recordPremiumActivityEvent({
                userId,
                eventType: "premium_credit",
                quantityDelta: quantity,
                amountCents,
                referenceId: paymentId,
                metadata: {
                  source: "whop_sync",
                  paymentId,
                },
              });
            }
            console.log(
              `[WHOP SYNC] Credited ${quantity} ${assetType} shares to user ${userId} from payment ${paymentId} (${creditResult.previousQuantity} -> ${creditResult.newQuantity})`,
            );
          } else {
            console.log(
              `[WHOP SYNC] Payment ${paymentId} already credited by another process, skipping`,
            );
          }
        }

        // Handle refunds/chargebacks - only if there's a previously credited payment
        if (
          (status === "refunded" || status === "disputed" || status === "chargedback") &&
          currentPayment &&
          currentPayment.creditedAt &&
          !currentPayment.revokedAt
        ) {
          // Revoke the shares from holdings - preserve avgCost
          const existingHolding = await storage.getHolding(userId, assetType, assetType);
          const currentShares = parseFloat(existingHolding?.quantity || "0");
          const currentAvgCost =
            existingHolding?.avgCostBasis || (assetType === "community" ? "1.0000" : "5.0000");

          if (currentShares >= quantity) {
            // User has enough shares to fully revoke
            const newQuantity = currentShares - quantity;
            await storage.updateHolding(userId, assetType, assetType, newQuantity, currentAvgCost);
            await storage.revokeWhopPayment(paymentId, quantity, 0);
            result.revoked += quantity;
            console.log(
              `[WHOP SYNC] Revoked ${quantity} ${assetType} shares from user ${userId} for payment ${paymentId} (${currentShares} -> ${newQuantity})`,
            );
          } else {
            // User doesn't have enough shares - revoke what we can and create liability
            const toRevoke = currentShares;
            const liability = quantity - currentShares;
            await storage.updateHolding(userId, assetType, assetType, 0, currentAvgCost);
            await storage.revokeWhopPayment(paymentId, toRevoke, liability);
            result.revoked += toRevoke;
            console.log(
              `[WHOP SYNC] Partially revoked ${toRevoke} ${assetType} shares, ${liability} liability for user ${userId}`,
            );
          }
        }
      }

      return result;
    } catch (err: any) {
      console.error("[WHOP SYNC] Error syncing payments:", err.message);
      return result;
    }
  }

  function extractWhopPaymentFields(payment: any): {
    planId: string | null;
    amountCents: number;
    metadata: any;
    email: string | null;
    status: string;
  } {
    const planId = payment?.plan_id || payment?.plan?.id || null;

    const toNumber = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const amountFromFinal = toNumber(payment?.final_amount);
    const amountFromTotalDollars = toNumber(payment?.total);
    const amountFromUsdTotal = toNumber(payment?.usd_total);
    const amountCents =
      amountFromFinal ??
      (amountFromTotalDollars !== null ? Math.round(amountFromTotalDollars * 100) : null) ??
      (amountFromUsdTotal !== null ? Math.round(amountFromUsdTotal * 100) : null) ??
      0;

    const metadata = payment?.metadata || {};
    const email = payment?.user?.email || null;
    const status = payment?.status || "unknown";

    return { planId, amountCents, metadata, email, status };
  }

  function classifyWhopPurchase(
    planId: string | null | undefined,
    amountCents: number | null | undefined,
  ): { assetType: "community" | "premium" | null; reason: string } {
    const communityPlanId = process.env.WHOP_COMMUNITY_PLAN_ID;
    const premiumPlanId = process.env.WHOP_PLAN_ID;

    if (planId) {
      if (communityPlanId && planId === communityPlanId)
        return { assetType: "community", reason: "plan_id:community" };
      if (premiumPlanId && planId === premiumPlanId)
        return { assetType: "premium", reason: "plan_id:premium" };
      return { assetType: null, reason: "plan_id:unknown" };
    }

    if (amountCents && amountCents >= 100) {
      return { assetType: amountCents < 500 ? "community" : "premium", reason: "amount_fallback" };
    }

    return { assetType: null, reason: "insufficient_data" };
  }

  async function creditPaymentAndHoldingAtomic(
    paymentId: string,
    userId: string,
    assetType: "community" | "premium",
    quantity: number,
    avgCost: string,
  ) {
    return await db.transaction(async (tx) => {
      const [creditedPayment] = await tx
        .update(whopPayments)
        .set({ userId, creditedAt: new Date() })
        .where(and(eq(whopPayments.paymentId, paymentId), sql`${whopPayments.creditedAt} IS NULL`))
        .returning();

      if (!creditedPayment) return null;

      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.assetType, assetType),
            eq(holdings.assetId, assetType),
          ),
        );

      const currentQty = parseFloat(existingHolding?.quantity || "0");
      const newQty = currentQty + quantity;
      const resolvedAvgCost = existingHolding?.avgCostBasis || avgCost;
      const totalCostBasis = (parseFloat(resolvedAvgCost) * newQty).toFixed(2);

      if (existingHolding) {
        await tx
          .update(holdings)
          .set({
            quantity: newQty.toString(),
            avgCostBasis: resolvedAvgCost,
            totalCostBasis,
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        await tx.insert(holdings).values({
          userId,
          assetType,
          assetId: assetType,
          quantity: newQty.toString(),
          avgCostBasis: resolvedAvgCost,
          totalCostBasis,
          lastUpdated: new Date(),
        });
      }

      return { creditedPayment, previousQuantity: currentQty, newQuantity: newQty };
    });
  }

  async function recordPremiumActivityEvent(event: {
    userId: string;
    eventType: "premium_credit" | "premium_redeem" | "premium_admin_credit";
    quantityDelta: number;
    amountCents?: number;
    daysGranted?: number;
    premiumExpiresAtAfter?: Date | string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await storage.createPremiumActivityEvent({
        userId: event.userId,
        eventType: event.eventType,
        quantityDelta: event.quantityDelta,
        amountCents: event.amountCents,
        daysGranted: event.daysGranted,
        premiumExpiresAtAfter:
          event.premiumExpiresAtAfter instanceof Date
            ? event.premiumExpiresAtAfter
            : typeof event.premiumExpiresAtAfter === "string"
              ? new Date(event.premiumExpiresAtAfter)
              : undefined,
        referenceId: event.referenceId,
        metadata: event.metadata ?? {},
      });
    } catch (error: any) {
      console.warn(
        "[PREMIUM_ACTIVITY] Could not record premium activity:",
        error?.message || error,
      );
    }
  }

  async function findDeterministicSessionMatch(
    assetType: "community" | "premium",
    metadata: any,
    receiptId?: string,
    userEmail?: string | null,
    planId?: string | null,
  ) {
    const sessionId = metadata?.sessionId;
    if (sessionId) {
      if (assetType === "community") {
        const session = await storage.getCommunityCheckoutSession(sessionId);
        if (session) return { type: "community" as const, session };
      } else {
        const session = await storage.getPremiumCheckoutSession(sessionId);
        if (session) return { type: "premium" as const, session };
      }
    }

    if (receiptId) {
      if (assetType === "community") {
        const session = await storage.getCommunityCheckoutSessionByReceipt(receiptId);
        if (session) return { type: "community" as const, session };
      } else {
        const session = await storage.getPremiumCheckoutSessionByReceipt(receiptId);
        if (session) return { type: "premium" as const, session };
      }
    }

    // Strict fallback only when metadata is missing: match by email + plan + recent pending session.
    const metadataEmpty = !metadata || Object.keys(metadata).length === 0;
    if (metadataEmpty && userEmail) {
      const lookback = new Date(Date.now() - 30 * 60 * 1000);
      const pending =
        assetType === "community"
          ? await storage.getPendingCommunityCheckoutSessions()
          : await storage.getPendingPremiumCheckoutSessions();

      const matchedByEmail = [] as any[];
      for (const s of pending) {
        if (new Date(s.createdAt) < lookback) continue;
        if (planId && s.planId !== planId) continue;
        const u = await storage.getUser(s.userId);
        if (u?.email?.toLowerCase() === userEmail.toLowerCase()) {
          matchedByEmail.push(s);
        }
      }

      if (matchedByEmail.length === 1) {
        return { type: assetType, session: matchedByEmail[0] };
      }
    }

    return null;
  }

  type GooglePlayServiceAccountCredentials = {
    client_email: string;
    private_key: string;
    project_id?: string;
  };

  const GOOGLE_PLAY_ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

  let googlePlayAccessTokenCache: { token: string; expiresAtMs: number } | null = null;

  function parseGooglePlayServiceAccountJson(raw: string): GooglePlayServiceAccountCredentials {
    const parsed = JSON.parse(raw) as Partial<GooglePlayServiceAccountCredentials>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("PLAY_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
    }

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      project_id: parsed.project_id,
    };
  }

  async function resolveGooglePlayServiceAccountCredentials() {
    const inlineValue = process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim();
    const filePath = process.env.PLAY_SERVICE_ACCOUNT_FILE?.trim();

    if (inlineValue) {
      try {
        return parseGooglePlayServiceAccountJson(inlineValue);
      } catch {
        const decoded = Buffer.from(inlineValue, "base64").toString("utf8");
        return parseGooglePlayServiceAccountJson(decoded);
      }
    }

    if (filePath) {
      const fileContent = await readFile(filePath, "utf8");
      return parseGooglePlayServiceAccountJson(fileContent);
    }

    throw new Error(
      "Google Play service account credentials are not configured (PLAY_SERVICE_ACCOUNT_JSON or PLAY_SERVICE_ACCOUNT_FILE)",
    );
  }

  async function getGooglePlayAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (
      !forceRefresh &&
      googlePlayAccessTokenCache &&
      googlePlayAccessTokenCache.expiresAtMs > now
    ) {
      return googlePlayAccessTokenCache.token;
    }

    const credentials = await resolveGooglePlayServiceAccountCredentials();
    const { GoogleAuth } = await import("google-auth-library");

    const auth = new GoogleAuth({
      credentials,
      scopes: [GOOGLE_PLAY_ANDROID_PUBLISHER_SCOPE],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken =
      typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token || null;

    if (!accessToken) {
      throw new Error("Could not obtain Google Play access token");
    }

    const expiryMs =
      typeof (client as any)?.credentials?.expiry_date === "number"
        ? Number((client as any).credentials.expiry_date)
        : now + 45 * 60 * 1000;

    googlePlayAccessTokenCache = {
      token: accessToken,
      expiresAtMs: Math.max(now + 60 * 1000, expiryMs - 60 * 1000),
    };

    return accessToken;
  }

  async function fetchGooglePlayProductPurchase(options: {
    packageName: string;
    productId: string;
    purchaseToken: string;
  }) {
    const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(options.packageName)}/purchases/products/${encodeURIComponent(options.productId)}/tokens/${encodeURIComponent(options.purchaseToken)}`;

    const request = async (token: string) =>
      fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

    let accessToken = await getGooglePlayAccessToken();
    let response = await request(accessToken);

    if (response.status === 401) {
      accessToken = await getGooglePlayAccessToken(true);
      response = await request(accessToken);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Google Play verification failed (${response.status}): ${body || response.statusText}`,
      );
    }

    return response.json();
  }

  async function consumeGooglePlayProductPurchase(options: {
    packageName: string;
    productId: string;
    purchaseToken: string;
  }) {
    const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(options.packageName)}/purchases/products/${encodeURIComponent(options.productId)}/tokens/${encodeURIComponent(options.purchaseToken)}:consume`;

    const request = async (token: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

    let accessToken = await getGooglePlayAccessToken();
    let response = await request(accessToken);

    if (response.status === 401) {
      accessToken = await getGooglePlayAccessToken(true);
      response = await request(accessToken);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Google Play consume failed (${response.status}): ${body || response.statusText}`,
      );
    }
  }

  function getAllowedGooglePlayPremiumProductIds() {
    const explicitIds = (process.env.GOOGLE_PLAY_PREMIUM_PRODUCT_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const fallbackId = (process.env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID || "premium_share_1").trim();
    if (explicitIds.length === 0 && fallbackId) {
      return [fallbackId];
    }

    if (fallbackId) {
      explicitIds.push(fallbackId);
    }

    return Array.from(new Set(explicitIds));
  }

  // Keep ads.txt directly crawlable for AdSense / Ad Manager site verification.
  app.get("/ads.txt", (_req, res) => {
    const fallbackId = "pub-2708638041809482";
    const raw = (process.env.ADSENSE_PUBLISHER_ID ?? fallbackId).replace(/\s+/g, "");
    const publisherId = /^pub-\d+$/.test(raw) ? raw : fallbackId;
    res.type("text/plain");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
  });

  // Canonicalize legacy marketplace route for crawlers and users.
  app.get("/marketplace", (req, res) => {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(301, `/pools${query}`);
  });

  // RSS feed for published blog content.
  app.get("/feed.xml", async (req, res) => {
    try {
      const baseUrl = getCanonicalSiteUrl(req);
      const { posts } = await storage.getBlogPosts({
        limit: 200,
        offset: 0,
        publishedOnly: true,
      });

      const latest = posts[0]?.updatedAt || posts[0]?.publishedAt || new Date();
      const lastModifiedDate = new Date(latest);
      const items = posts
        .map((post) => {
          const published = new Date(post.publishedAt || post.createdAt).toUTCString();
          const description = String(post.excerpt || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const title = String(post.title || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

          return `<item>
  <title>${title}</title>
  <link>${baseUrl}/blog/${post.slug}</link>
  <guid isPermaLink="true">${baseUrl}/blog/${post.slug}</guid>
  <pubDate>${published}</pubDate>
  <description>${description}</description>
</item>`;
        })
        .join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Sportfolio Blog</title>
  <link>${baseUrl}/blog</link>
  <description>Sportfolio market analysis, strategy guides, and platform updates.</description>
  <language>en-us</language>
  <lastBuildDate>${lastModifiedDate.toUTCString()}</lastBuildDate>
  <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;

      setPublicDataHeaders(res, {
        generatedAt: new Date(),
        lastModifiedAt: lastModifiedDate,
        maxAgeSeconds: 300,
        sharedMaxAgeSeconds: 900,
      });
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.send(xml);
    } catch (error: any) {
      console.error("[feed.xml] Error generating feed:", error);
      res.status(500).send("Error generating feed");
    }
  });

  // JSON feed for machine consumers.
  app.get("/feed.json", async (req, res) => {
    try {
      const baseUrl = getCanonicalSiteUrl(req);
      const { posts } = await storage.getBlogPosts({
        limit: 200,
        offset: 0,
        publishedOnly: true,
      });

      const lastModifiedDate = new Date(posts[0]?.updatedAt || posts[0]?.publishedAt || new Date());
      const payload = {
        version: "https://jsonfeed.org/version/1.1",
        title: "Sportfolio Blog",
        home_page_url: `${baseUrl}/blog`,
        feed_url: `${baseUrl}/feed.json`,
        description: "Sportfolio market analysis, strategy guides, and platform updates.",
        icon: `${baseUrl}/favicon.png`,
        items: posts.map((post) => ({
          id: `${baseUrl}/blog/${post.slug}`,
          url: `${baseUrl}/blog/${post.slug}`,
          title: post.title,
          summary: post.excerpt,
          date_published: new Date(post.publishedAt || post.createdAt).toISOString(),
          date_modified: new Date(
            post.updatedAt || post.publishedAt || post.createdAt,
          ).toISOString(),
        })),
      };

      setPublicDataHeaders(res, {
        generatedAt: new Date(),
        lastModifiedAt: lastModifiedDate,
        maxAgeSeconds: 300,
        sharedMaxAgeSeconds: 900,
      });
      res.setHeader("Content-Type", "application/feed+json; charset=utf-8");
      res.json(payload);
    } catch (error: any) {
      console.error("[feed.json] Error generating JSON feed:", error);
      res.status(500).json({ error: "Error generating feed" });
    }
  });

  // SEO: Dynamic Sitemap XML
  app.get("/sitemap.xml", async (req, res) => {
    try {
      const baseUrl = getCanonicalSiteUrl(req);
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

      // Fetch limited dynamic content for performance
      const [blogPosts] = await Promise.all([
        storage.getBlogPosts({ limit: 100, offset: 0, publishedOnly: true }),
      ]);

      // Only include routes that are public and indexable.
      const staticPages = [
        { url: "", lastmod: today, changefreq: "daily", priority: "1.0" },
        { url: "pools", lastmod: today, changefreq: "hourly", priority: "0.9" },
        { url: "leaderboards", lastmod: today, changefreq: "daily", priority: "0.8" },
        { url: "blog", lastmod: today, changefreq: "weekly", priority: "0.8" },
        { url: "news", lastmod: today, changefreq: "hourly", priority: "0.8" },
        { url: "analytics", lastmod: today, changefreq: "daily", priority: "0.6" },
        { url: "feed.xml", lastmod: today, changefreq: "hourly", priority: "0.5" },
        { url: "feed.json", lastmod: today, changefreq: "hourly", priority: "0.5" },
        { url: "llms.txt", lastmod: today, changefreq: "weekly", priority: "0.5" },
        { url: "llms-full.md", lastmod: today, changefreq: "weekly", priority: "0.5" },
        { url: "how-it-works", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.7" },
        { url: "about", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.6" },
        { url: "contact", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.6" },
        { url: "privacy", lastmod: "2025-11-23", changefreq: "yearly", priority: "0.4" },
        { url: "terms", lastmod: "2025-11-23", changefreq: "yearly", priority: "0.4" },
      ];

      // Build sitemap XML
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

      // Add static pages
      staticPages.forEach((page) => {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${page.url}</loc>\n`;
        xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
      });

      // Add blog posts with actual update dates
      blogPosts.posts.forEach((post: (typeof blogPosts.posts)[0]) => {
        const postLastMod = post.updatedAt || post.publishedAt;
        const formattedDate = new Date(postLastMod).toISOString().split("T")[0];
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
        xml += `    <lastmod>${formattedDate}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      });

      xml += "</urlset>";

      res.header("Content-Type", "application/xml");
      res.send(xml);
    } catch (error) {
      console.error("Error generating sitemap:", error);
      res.status(500).send("Error generating sitemap");
    }
  });

  // API ROUTES

  // Auth endpoints
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userState = await loadEffectiveUserState(userId);
      const user = userState?.user;

      // Log successful auth
      console.log(
        `[AUTH:USER] Authenticated user: ${user?.username} (${userId.substring(0, 8)}...)`,
      );

      // Return user data immediately - don't block on background sync work
      res.json(userState?.decoratedUser || null);

      if (user) {
        // Scout Engine: Update activity timestamp for 24h kill-switch
        storage
          .updateLastActive(userId)
          .catch((err) => console.error("[Scout] Activity update error:", err));
      }

      // Fire-and-forget: Trigger Whop sync in background if user has email and sync is requested
      if (user?.email && req.query.sync === "true" && !isNativeIOSRequest(req)) {
        syncWhopPaymentsForUser(userId, user.email)
          .then((whopSync) => {
            console.log(
              `[AUTH] Whop sync for ${user.username}: ${whopSync.credited} credited, ${whopSync.synced} synced`,
            );
          })
          .catch((syncErr: any) => {
            console.error(`[AUTH] Whop sync error:`, syncErr.message);
          });
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Whop payment sync endpoint - manual sync for logged-in users
  app.post("/api/whop/sync", isAuthenticated, async (req: any, res) => {
    try {
      if (isNativeIOSRequest(req)) {
        return res.status(403).json({
          code: "ios_purchase_disabled",
          error:
            "Whop premium sync is unavailable in the iOS app while Apple in-app purchase rollout is in progress.",
        });
      }

      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.email) {
        return res.status(400).json({
          error:
            "No email associated with your account. Please update your profile with the email used on Whop.",
        });
      }

      const result = await syncWhopPaymentsForUser(userId, user.email);

      // Get updated user data
      const updatedUser = await storage.getUser(userId);
      const premiumHolding = await storage.getHolding(userId, "premium", "premium");

      res.json({
        success: true,
        credited: result.credited,
        revoked: result.revoked,
        synced: result.synced,
        premiumShares: premiumHolding?.quantity || 0,
      });
    } catch (error: any) {
      console.error("Error syncing Whop payments:", error);
      res.status(500).json({ error: "Failed to sync with Whop" });
    }
  });

  // Admin endpoint to sync Whop payments for any user
  app.post("/api/admin/whop/sync", adminAuth, async (req: any, res) => {
    try {
      const { email, username } = req.body;

      if (!email && !username) {
        return res.status(400).json({ error: "Email or username required" });
      }

      // Find target user
      let targetUser;
      if (username) {
        targetUser = await storage.getUserByUsername(username);
      } else if (email) {
        // Find user by email
        const allUsers = await storage.getUsers();
        targetUser = allUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      }

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser.email) {
        return res.status(400).json({ error: "Target user has no email configured" });
      }

      const result = await syncWhopPaymentsForUser(targetUser.id, targetUser.email);

      // Get updated user data
      const updatedUser = await storage.getUser(targetUser.id);
      const premiumHolding = await storage.getHolding(targetUser.id, "premium", "premium");

      res.json({
        success: true,
        user: {
          id: updatedUser?.id,
          username: updatedUser?.username,
          email: updatedUser?.email,
          premiumShares: premiumHolding?.quantity || 0,
        },
        credited: result.credited,
        revoked: result.revoked,
        synced: result.synced,
      });
    } catch (error: any) {
      console.error("Error in admin Whop sync:", error);
      res.status(500).json({ error: "Failed to sync with Whop" });
    }
  });

  // Admin endpoint to manually grant premium shares
  app.post("/api/admin/premium/grant", adminAuth, async (req: any, res) => {
    try {
      const adminContext = req.adminContext;
      const adminUser = adminContext?.userId
        ? await storage.getUser(adminContext.userId)
        : undefined;
      const adminLabel =
        adminUser?.username ||
        adminUser?.email ||
        adminContext?.email ||
        adminContext?.method ||
        "admin";

      const { username, quantity } = req.body;

      if (!username) {
        return res.status(400).json({ error: "Username is required" });
      }

      const parsedQuantity = parseInt(quantity, 10);
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: "Quantity must be a positive number" });
      }

      // Find target user by username
      const targetUser = await storage.getUserByUsername(username);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get existing premium holding
      const existingHolding = await storage.getHolding(targetUser.id, "premium", "premium");
      const currentQuantity = parseFloat(existingHolding?.quantity || "0");
      const newQuantity = currentQuantity + parsedQuantity;

      // Preserve existing avgCost or use $5 default for new holdings
      const currentAvgCost = existingHolding?.avgCostBasis || "5.0000";

      // Update holding with new quantity
      await storage.updateHolding(targetUser.id, "premium", "premium", newQuantity, currentAvgCost);

      await recordPremiumActivityEvent({
        userId: targetUser.id,
        eventType: "premium_admin_credit",
        quantityDelta: parsedQuantity,
        metadata: {
          source: "admin_premium_grant",
          adminUserId: adminUser?.id || adminContext?.userId,
          adminUsername: adminUser?.username || adminContext?.email,
          adminAuthMethod: adminContext?.method,
          reason: `Granted by admin ${adminLabel}`,
          targetUsername: targetUser.username,
        },
      });

      console.log(
        `[ADMIN] Granted ${parsedQuantity} premium shares to user ${targetUser.username} (${currentQuantity} -> ${newQuantity}) by admin ${adminLabel}`,
      );

      res.json({
        success: true,
        user: {
          id: targetUser.id,
          username: targetUser.username,
        },
        granted: parsedQuantity,
        previousQuantity: currentQuantity,
        newQuantity: newQuantity,
      });
    } catch (error: any) {
      console.error("Error granting premium shares:", error);
      res.status(500).json({ error: "Failed to grant premium shares" });
    }
  });

  // Dashboard - Now public for unauthenticated users (with limited data)
  app.get("/api/dashboard", optionalAuth, async (req, res) => {
    try {
      const startTime = performance.now();
      const timings: Record<string, number> = {};

      // Check if user is authenticated
      const isUserAuthenticated = !!req.user;
      const userId = isUserAuthenticated ? getUserId(req) : null;

      // Fetch public data (always available)
      const publicStart = performance.now();
      const [recentTrades, hotPlayersRaw] = await Promise.all([
        storage.getRecentTrades(undefined, 10),
        storage.getTopPlayersByVolume(5), // Get top 5 players by 24h volume directly from DB
      ]);
      timings.publicData = performance.now() - publicStart;

      // If not authenticated, return public data only
      if (!isUserAuthenticated || !userId) {
        // Collect player IDs from public data
        const playerIds = new Set<string>();
        recentTrades.forEach((t) => playerIds.add(t.playerId));

        // Batch fetch needed players
        const batchStart = performance.now();
        const players = await storage.getPlayersByIds(Array.from(playerIds));
        timings.playerBatch = performance.now() - batchStart;
        const playerMap = new Map(players.map((p) => [p.id, p]));

        // Enrich hot players (sync operation, no await needed)
        const hotPlayers = hotPlayersRaw.map(enrichPlayerWithMarketValue);

        timings.total = performance.now() - startTime;
        console.log(
          `[Dashboard] Unauthenticated: ${timings.total.toFixed(0)}ms (public: ${timings.publicData.toFixed(0)}ms, playerBatch: ${timings.playerBatch.toFixed(0)}ms)`,
        );

        return res.json(
          withPublicDataHeaders(
            res,
            {
              user: null,
              hotPlayers,
              recentTrades: recentTrades.map((trade) => ({
                ...trade,
                player: playerMap.get(trade.playerId),
              })),
              topHoldings: [],
              portfolioMovers24h: [],
              portfolioHistory: [],
              boosts: null,
            },
            { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 },
          ),
        );
      }

      // Authenticated user - fetch full dashboard data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Fetch user-specific data in parallel
      const [userHoldings, boostsData] = await Promise.all([
        storage.getUserHoldings(user.id),
        getDashboardBoostData(user.id),
      ]);

      // Collect all unique player IDs we need to fetch
      const playerIds = new Set<string>();

      // Add holdings player IDs
      userHoldings.forEach((h) => {
        if (h.assetType === "player") playerIds.add(h.assetId);
      });

      // Add recent trades player IDs
      recentTrades.forEach((t) => playerIds.add(t.playerId));

      // Parallel fetch: players, ranks, yesterday's snapshot, and current ranking data
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const [players, latestRanks, yesterdaySnapshot, usersForRanking] = await Promise.all([
        storage.getPlayersByIds(Array.from(playerIds)),
        storage.getLatestSnapshotRanks(),
        storage.getPortfolioSnapshot(user.id, yesterday),
        getOrCompute("dashboard:users_for_ranking", () => storage.getAllUsersForRanking(), 30_000),
      ]);
      const playerMap = new Map(players.map((p) => [p.id, p]));

      // Calculate portfolio value using pre-fetched players
      // Only count holdings with real market prices (skip placeholder prices)
      let portfolioValue = 0;
      for (const holding of userHoldings) {
        if (holding.assetType === "player") {
          const player = playerMap.get(holding.assetId);
          const effectiveShares = parseFloat(holding.effectiveShares || holding.quantity);
          if (player && player.lastTradePrice) {
            portfolioValue += effectiveShares * parseFloat(player.lastTradePrice);
          }
        }
      }

      // Enrich hot players with market values (sync operation using pre-fetched data)
      const hotPlayers = hotPlayersRaw.map(enrichPlayerWithMarketValue);

      // Get top 3 holdings by value using pre-fetched players
      const topHoldings = [];
      for (const holding of userHoldings) {
        if (holding.assetType === "player") {
          const player = playerMap.get(holding.assetId);
          if (player) {
            const enrichedPlayer = enrichPlayerWithMarketValue(player);
            const effectiveShares = parseFloat(holding.effectiveShares || holding.quantity);
            const { currentValue, pnl, pnlPercent } = calculatePnL(
              effectiveShares,
              holding.avgCostBasis,
              enrichedPlayer.lastTradePrice,
            );
            topHoldings.push({
              player: enrichedPlayer,
              quantity: effectiveShares.toFixed(2),
              effectiveShares: effectiveShares.toFixed(2),
              value: currentValue,
              pnl,
              pnlPercent,
            });
          }
        }
      }
      // Sort by value, putting null values at the end
      topHoldings.sort((a, b) => {
        if (a.value === null && b.value === null) return 0;
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return parseFloat(b.value) - parseFloat(a.value);
      });

      // Get ranks from cached snapshot or calculate real-time
      const cachedRank = latestRanks.get(user.id);

      let currentCashRank = cachedRank?.cashRank || 1;
      let currentPortfolioRank = cachedRank?.portfolioRank || 1;

      // If no cached ranks, fallback to real-time calculation
      if (!cachedRank) {
        const cashSorted = [...usersForRanking].sort(
          (a, b) => parseFloat(b.balance) - parseFloat(a.balance),
        );
        currentCashRank = cashSorted.findIndex((u) => u.userId === user.id) + 1;

        const portfolioSorted = [...usersForRanking].sort(
          (a, b) => b.portfolioValue - a.portfolioValue,
        );
        currentPortfolioRank = portfolioSorted.findIndex((u) => u.userId === user.id) + 1;
      }

      const cashRankChange = yesterdaySnapshot?.cashRank
        ? yesterdaySnapshot.cashRank - currentCashRank
        : null;
      const portfolioRankChange = yesterdaySnapshot?.portfolioRank
        ? yesterdaySnapshot.portfolioRank - currentPortfolioRank
        : null;

      const currentNetWorth = parseFloat(user.balance) + portfolioValue;
      const roundToTwo = (value: number) => Math.round(value * 100) / 100;
      const moverSharesByPlayer = new Map<string, number>();

      for (const holding of userHoldings) {
        if (holding.assetType !== "player") {
          continue;
        }

        const effectiveShares = parseFloat(holding.effectiveShares || holding.quantity || "0");
        if (effectiveShares <= 0) {
          continue;
        }

        moverSharesByPlayer.set(
          holding.assetId,
          roundToTwo((moverSharesByPlayer.get(holding.assetId) || 0) + effectiveShares),
        );
      }

      const portfolioMovers24h = Array.from(moverSharesByPlayer.entries())
        .map(([playerId, effectiveShares]) => {
          const player = playerMap.get(playerId);
          if (!player || !player.lastTradePrice) {
            return null;
          }

          const currentPrice = parseFloat(player.lastTradePrice || "0");
          const priceChange24h = parseFloat(player.priceChange24h || "0");
          if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
            return null;
          }

          const previousPrice =
            priceChange24h <= -100 ? 0 : currentPrice / (1 + priceChange24h / 100);
          const valueGain24h = roundToTwo(effectiveShares * (currentPrice - previousPrice));

          if (!Number.isFinite(valueGain24h) || valueGain24h <= 0) {
            return null;
          }

          return {
            player: enrichPlayerWithMarketValue(player),
            effectiveShares,
            currentPrice: roundToTwo(currentPrice),
            priceChange24h: roundToTwo(priceChange24h),
            valueGain24h,
          };
        })
        .filter(
          (
            mover,
          ): mover is {
            player: Player & { lastTradePrice: string | null };
            effectiveShares: number;
            currentPrice: number;
            priceChange24h: number;
            valueGain24h: number;
          } => Boolean(mover),
        )
        .sort((a, b) => b.valueGain24h - a.valueGain24h || b.priceChange24h - a.priceChange24h)
        .slice(0, 5);

      const currentNetWorthByUser = new Map(
        usersForRanking.map((u) => [u.userId, parseFloat(u.balance) + u.portfolioValue]),
      );

      const changeWindows = [
        { key: "change24h", days: 1 },
        { key: "change7d", days: 7 },
        { key: "change30d", days: 30 },
      ] as const;

      type DashboardChangeKey = (typeof changeWindows)[number]["key"];
      const netWorthChanges: Record<
        DashboardChangeKey,
        { amount: number | null; percent: number | null; rank: number | null }
      > = {
        change24h: { amount: null, percent: null, rank: null },
        change7d: { amount: null, percent: null, rank: null },
        change30d: { amount: null, percent: null, rank: null },
      };

      for (const window of changeWindows) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - window.days);
        const targetDateKey = targetDate.toISOString().slice(0, 10);

        const baselineSnapshots = await getOrCompute(
          `dashboard:baseline_snapshots:${window.days}:${targetDateKey}`,
          async () => {
            const [baselineDateRow] = await db
              .select({ snapshotDate: portfolioSnapshots.snapshotDate })
              .from(portfolioSnapshots)
              .where(lte(portfolioSnapshots.snapshotDate, targetDate))
              .orderBy(desc(portfolioSnapshots.snapshotDate))
              .limit(1);

            if (!baselineDateRow) {
              return [];
            }

            return db
              .select({
                userId: portfolioSnapshots.userId,
                totalNetWorth: portfolioSnapshots.totalNetWorth,
              })
              .from(portfolioSnapshots)
              .where(eq(portfolioSnapshots.snapshotDate, baselineDateRow.snapshotDate));
          },
          60_000,
        );

        if (baselineSnapshots.length === 0) {
          continue;
        }

        const baselineNetWorthByUser = new Map(
          baselineSnapshots.map((snapshot) => [
            snapshot.userId,
            parseFloat(snapshot.totalNetWorth),
          ]),
        );

        const userBaseline = baselineNetWorthByUser.get(user.id);
        if (userBaseline !== undefined) {
          const amount = roundToTwo(currentNetWorth - userBaseline);
          const percent =
            userBaseline > 0
              ? roundToTwo(((currentNetWorth - userBaseline) / userBaseline) * 100)
              : null;

          netWorthChanges[window.key] = {
            ...netWorthChanges[window.key],
            amount,
            percent,
          };
        }

        const rankedDeltas = Array.from(currentNetWorthByUser.entries())
          .map(([userId, netWorth]) => {
            const baselineNetWorth = baselineNetWorthByUser.get(userId);
            if (baselineNetWorth === undefined) return null;
            return { userId, delta: netWorth - baselineNetWorth };
          })
          .filter((entry): entry is { userId: string; delta: number } => entry !== null)
          .sort((a, b) => b.delta - a.delta);

        const rankIndex = rankedDeltas.findIndex((entry) => entry.userId === user.id);
        netWorthChanges[window.key] = {
          ...netWorthChanges[window.key],
          rank: rankIndex >= 0 ? rankIndex + 1 : null,
        };
      }

      res.json({
        user: {
          balance: user.balance,
          portfolioValue: portfolioValue.toFixed(2),
          netWorth: currentNetWorth.toFixed(2),
          cashRank: currentCashRank,
          portfolioRank: currentPortfolioRank,
          cashRankChange,
          portfolioRankChange,
          change24h: netWorthChanges.change24h,
          change7d: netWorthChanges.change7d,
          change30d: netWorthChanges.change30d,
        },
        hotPlayers,
        boosts: boostsData,
        recentTrades: recentTrades.map((trade) => ({
          ...trade,
          player: playerMap.get(trade.playerId),
        })),
        topHoldings: topHoldings.slice(0, 3),
        portfolioMovers24h,
        portfolioHistory: [], // Placeholder
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Today's games (in ET timezone where NBA games are scheduled)
  app.get("/api/games/today", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "NBA";
      const { startOfDay, endOfDay } = getTodayETBoundaries();
      const games = await storage.getDailyGamesBySport(sport, startOfDay, endOfDay);

      // Add gameDay to each game for frontend display
      const gamesWithDay = games.map((game) => ({
        ...game,
        gameDay: getGameDay(game.startTime),
      }));

      res.json(gamesWithDay);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Games for a specific date (YYYY-MM-DD format in Eastern Time)
  app.get("/api/games/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const sport = (req.query.sport as string) || "NBA";

      // Validate date format (YYYY-MM-DD)
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const { startOfDay, endOfDay } = getETDayBoundaries(date);
      const games = await storage.getDailyGamesBySport(sport, startOfDay, endOfDay);

      // Add gameDay to each game for frontend display
      const gamesWithDay = games.map((game) => ({
        ...game,
        gameDay: getGameDay(game.startTime),
      }));

      res.json(gamesWithDay);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/games/insights", optionalAuth, async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "NBA";
      const dateStr = resolveEtDateOrToday(req.query.date);
      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const games = await storage.getDailyGamesBySport(sport, startOfDay, endOfDay);

      const userId = req.user ? getUserId(req) : null;
      const { insights, boostSlotsRemaining, slatePlayers } = await buildGameInsights({
        games,
        sport,
        dateStr,
        userId,
      });

      res.json({
        date: dateStr,
        sport,
        boostSlotsRemaining,
        games: insights,
        slatePlayers,
      });
    } catch (error: any) {
      console.error("[games/insights] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // NASCAR Races Insights - Returns race info with driver standings
  app.get("/api/races/insights", optionalAuth, async (req, res) => {
    try {
      const dateStr = resolveEtDateOrToday(req.query.date);
      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);

      // Get NASCAR games for the date
      const games = await storage.getDailyGamesBySport("NASCAR", startOfDay, endOfDay);

      const userId = req.user ? getUserId(req) : null;

      // Get user's NASCAR holdings for boost eligibility and live earnings
      let userHoldings: any[] = [];
      let allHoldingsWithPlayers: any[] = [];
      let boostSlotsRemaining: number | null = null;

      if (userId) {
        const { startOfDay: dayStart } = getETDayBoundaries(dateStr);
        const targetDate = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);

        const [eligiblePlayers, currentBoosts, allHoldings] = await Promise.all([
          storage.getEligiblePlayersForBoost(userId, "NASCAR", targetDate),
          storage.getDailyBoosts(userId, "NASCAR", targetDate),
          storage.getAllHoldingsWithPlayers(userId),
        ]);

        boostSlotsRemaining = Math.max(0, 4 - currentBoosts.length);
        const boostedPlayerIds = new Set(currentBoosts.map((boost) => boost.playerId));

        userHoldings = eligiblePlayers.map((holding) => ({
          playerId: holding.player.id,
          name: `${holding.player.firstName} ${holding.player.lastName}`.trim(),
          team: holding.player.team,
          availableShares: holding.availableShares,
          totalShares: parseFloat(holding.effectiveShares || holding.quantity) || 0,
          multiplier: parseFloat(holding.multiplier) || 0,
          isBoosted: boostedPlayerIds.has(holding.player.id),
          gameId: holding.gameId,
        }));

        allHoldingsWithPlayers = allHoldings;
      }

      // Build race insights for each game
      const raceInsights = await Promise.all(
        games.map(async (game) => {
          const raceStats = await storage.getGameStatsByGameId(game.gameId);
          const raceSnapshot = await buildNascarRaceStatsSnapshot(game, raceStats);

          let liveEarned: number | null = null;
          if (userId) {
            if (raceSnapshot.status === "scheduled") {
              liveEarned = null;
            } else {
              const userEarnings = await buildUserLiveEarningsSummary({
                game,
                userId,
                livePlayers: raceSnapshot.liveEarningsPlayers,
                preloadedHoldings: allHoldingsWithPlayers,
              });
              liveEarned = userEarnings?.totalEstimatedEarnings ?? null;
            }
          }

          return {
            raceId: game.gameId,
            trackName: game.homeTeam, // Stored as track in homeTeam
            series: game.awayTeam, // Stored as series code in awayTeam
            raceDate: game.startTime,
            status: raceSnapshot.status,
            venue: game.venue,
            lapInfo: raceSnapshot.lapInfo,
            liveEarned,
            driverStandings: raceSnapshot.driverStandings,
            totalDrivers: raceSnapshot.driverStandings.length,
          };
        }),
      );

      const slateDriverIds = Array.from(
        new Set(
          raceInsights
            .flatMap((race) =>
              race.driverStandings
                .map((standing) => String(standing.playerId || "").trim())
                .filter(Boolean),
            )
            .filter(Boolean),
        ),
      );
      const seasonStatsMap =
        slateDriverIds.length > 0
          ? await storage.getBatchPlayerSeasonStatsFromLogs(slateDriverIds)
          : new Map<string, { avgFantasyPointsPerGame: string }>();
      const slateDrivers: GameInsightSlatePlayer[] = raceInsights
        .flatMap((race) =>
          race.driverStandings
            .filter((standing) => String(standing.playerId || "").trim().length > 0)
            .map((standing) => {
              const playerId = String(standing.playerId || "").trim();
              const fantasyPoints = Number(standing.fantasyPoints || 0);
              const pregameValue = roundToTwo(
                parseFloat(seasonStatsMap.get(playerId)?.avgFantasyPointsPerGame || "0"),
              );

              return {
                playerId,
                name: standing.driverName,
                team: standing.manufacturer || "",
                gameId: race.raceId,
                startTime: new Date(race.raceDate),
                status: race.status,
                contextLabel: `${race.series} | ${race.trackName}`,
                pregameValue,
                liveValue: race.status === "inprogress" ? roundToTwo(fantasyPoints) : null,
                finalValue: race.status === "completed" ? roundToTwo(fantasyPoints) : null,
              } satisfies GameInsightSlatePlayer;
            }),
        )
        .sort(sortSlateExposurePlayers);

      res.json({
        date: dateStr,
        sport: "NASCAR",
        boostSlotsRemaining,
        races: raceInsights,
        userHoldings,
        slateDrivers,
      });
    } catch (error: any) {
      console.error("[races/insights] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/games/:gameId/insights", optionalAuth, async (req, res) => {
    try {
      const { gameId } = req.params;
      const game = await storage.getDailyGameByGameId(gameId);

      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      const requestedSport = (req.query.sport as string) || game.sport || "NBA";
      const sport = requestedSport.toUpperCase() === "ALL" ? game.sport : requestedSport;

      const dateStr = getGameDay(game.startTime);
      const userId = req.user ? getUserId(req) : null;

      const { insights, boostSlotsRemaining } = await buildGameInsights({
        games: [game],
        sport,
        dateStr,
        userId,
        includeMlbGameDetails: true,
        includeMlbDeepContext: false,
      });

      const gameInsight = insights[0];
      const teamPlayers = await db
        .select()
        .from(players)
        .where(
          and(
            sql`UPPER(${players.sport}) = ${sport.toUpperCase()}`,
            inArray(players.team, [game.homeTeam, game.awayTeam]),
            eq(players.isActive, true),
          ),
        );

      const playerIds = teamPlayers.map((player) => player.id);
      const [seasonStatsMap, scoutCountsMap] = await Promise.all([
        storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
        storage.getBatchActiveScoutCounts(playerIds),
      ]);

      const candidates = teamPlayers.map((player) => ({
        player,
        avgFantasyPointsPerGame: parseFloat(
          seasonStatsMap.get(player.id)?.avgFantasyPointsPerGame || "0",
        ),
        totalShares: player.totalShares || 0,
        scoutCount: scoutCountsMap.get(player.id) || 0,
      }));

      const topBy = (key: "avgFantasyPointsPerGame" | "totalShares" | "scoutCount") =>
        [...candidates]
          .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
          .map((entry) => ({
            playerId: entry.player.id,
            name: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.player.team,
            avgFantasyPointsPerGame: entry.avgFantasyPointsPerGame,
            totalShares: entry.totalShares,
            scoutCount: entry.scoutCount,
          }));

      const injuries = teamPlayers
        .filter((player) => player.injuryStatus && player.injuryStatus !== "")
        .map((player) => ({
          playerId: player.id,
          name: `${player.firstName} ${player.lastName}`,
          team: player.team,
          status: player.injuryStatus,
          description: player.injuryDescription || null,
          returnDate: player.injuryReturnDate || null,
        }))
        .sort((a, b) => a.team.localeCompare(b.team));

      res.json({
        date: dateStr,
        sport,
        boostSlotsRemaining,
        game: gameInsight,
        leaders: gameInsight?.leaders || { fantasy: null, shares: null, scouts: null },
        topPlayers: {
          fantasy: topBy("avgFantasyPointsPerGame"),
          shares: topBy("totalShares"),
          scouts: topBy("scoutCount"),
        },
        injuries,
        userContext: gameInsight?.userContext || null,
      });
    } catch (error: any) {
      console.error("[games/insights/:gameId] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Game stats - get player box scores for a specific game
  app.get("/api/games/:gameId/stats", async (req, res) => {
    try {
      const { gameId } = req.params;
      const normalizedGameId = String(gameId || "").trim();
      if (!normalizedGameId) {
        return res.status(400).json({ error: "Invalid game ID" });
      }

      // Get all player stats for this game
      let stats = await storage.getGameStatsByGameId(normalizedGameId);
      if ((!stats || stats.length === 0) && normalizedGameId.includes("_")) {
        const unprefixedGameId = normalizedGameId.split("_").slice(1).join("_");
        if (unprefixedGameId) {
          stats = await storage.getGameStatsByGameId(unprefixedGameId);
        }
      }

      if (!stats || stats.length === 0) {
        return res.json({
          gameId,
          homeTeam: { players: [], totals: null },
          awayTeam: { players: [], totals: null },
          topPerformers: null,
          message: "No stats available yet",
        });
      }

      // Get player details for all stats
      const statsWithPlayers = await Promise.all(
        stats.map(async (stat) => {
          const player = await storage.getPlayer(stat.playerId);
          return {
            playerId: stat.playerId,
            playerName: player ? `${player.firstName} ${player.lastName}` : "Unknown",
            team: player?.team || stat.opponentTeam,
            sport: stat.sport,
            statsJson: stat.statsJson as Record<string, any>,
            minutes: stat.minutes,
            points: stat.points,
            threePointersMade: stat.threePointersMade,
            rebounds: stat.rebounds,
            assists: stat.assists,
            steals: stat.steals,
            blocks: stat.blocks,
            turnovers: stat.turnovers,
            fantasyPoints: parseFloat(stat.fantasyPoints),
            homeAway: stat.homeAway,
          };
        }),
      );

      res.json(buildGameStatsPayload(gameId, statsWithPlayers));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Live game stats - fetches real-time player stats from Ball Don't Lie API
  app.get("/api/games/:gameId/live-stats", optionalAuth, async (req: any, res) => {
    try {
      const { gameId } = req.params;

      // Get the game from our database to determine sport
      const game = await storage.getDailyGameByGameId(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      const userId =
        (typeof req?.user?.claims?.sub === "string" && req.user.claims.sub) ||
        (typeof req?.user?.id === "string" && req.user.id) ||
        (typeof req?.userId === "string" && req.userId) ||
        null;
      const userHoldingsWithPlayers = userId
        ? await storage.getAllHoldingsWithPlayers(userId)
        : null;

      if (game.sport === "MLB") {
        const mlbGameIdStr = gameId.startsWith("mlb_") ? gameId.slice(4) : gameId;
        const mlbGameIdNum = Number(mlbGameIdStr);
        if (!Number.isSafeInteger(mlbGameIdNum) || mlbGameIdNum <= 0) {
          return res.status(400).json({ error: "Invalid game ID" });
        }

        console.log(`[live-stats] Fetching MLB stats for game ${gameId}`);

        const normalizeTeamKey = (value: string | null | undefined): string =>
          String(value || "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

        const {
          fetchGames,
          fetchGameStats,
          calculateMLBFantasyPoints,
          createMLBPlayerId,
          parseStatsToJson,
          normalizeGameStatus: normalizeMLBStatus,
          getMLBHomeScore,
          getMLBAwayScore,
          getMLBAwayTeam,
          getMLBHomeTeamName,
          getMLBAwayTeamName,
          getMLBTeamDisplayName,
          getMLBStatGameId,
          getMLBStatTeamAbbreviation,
          getMLBStatTeamName,
        } = await import("./mlb-statsapi");
        const gameStartTime = new Date(game.startTime);
        const lookupDates = Array.from(
          new Set([
            getGameDay(new Date(gameStartTime.getTime() - 24 * 60 * 60 * 1000)),
            getGameDay(gameStartTime),
            getGameDay(new Date(gameStartTime.getTime() + 24 * 60 * 60 * 1000)),
          ]),
        );
        const [mlbStats, mlbGames] = await Promise.all([
          fetchGameStats([mlbGameIdNum]),
          fetchGames({ dates: lookupDates }),
        ]);
        console.log(`[live-stats] Found ${mlbStats.length} MLB player stats`);

        const apiGame =
          mlbGames.find((candidateGame: any) => Number(candidateGame.id) === mlbGameIdNum) || null;

        // Prefer API game status and scores when available
        let liveStatus = game.status;
        let liveHomeScore = game.homeScore;
        let liveAwayScore = game.awayScore;
        let liveHomeTeam = game.homeTeam;
        let liveAwayTeam = game.awayTeam;
        if (apiGame) {
          try {
            liveStatus = normalizeMLBStatus(apiGame.status || "");
            if (apiGame.home_team?.abbreviation) {
              liveHomeTeam = String(apiGame.home_team.abbreviation).toUpperCase();
            }
            const apiAwayTeam = getMLBAwayTeam(apiGame);
            if (apiAwayTeam?.abbreviation) {
              liveAwayTeam = String(apiAwayTeam.abbreviation).toUpperCase();
            }
            const homeScore = getMLBHomeScore(apiGame);
            const awayScore = getMLBAwayScore(apiGame);
            if (homeScore != null) {
              liveHomeScore = homeScore;
            }
            if (awayScore != null) {
              liveAwayScore = awayScore;
            }
          } catch {
            // Non-fatal: keep DB values when API parsing fails.
          }
        }

        game.homeTeam = liveHomeTeam || game.homeTeam;
        game.awayTeam = liveAwayTeam || game.awayTeam;

        if (mlbStats.length > 0) {
          const apiAwayTeam = apiGame ? getMLBAwayTeam(apiGame) : null;
          const homeAbbreviation = normalizeTeamKey(
            apiGame?.home_team?.abbreviation || liveHomeTeam || game.homeTeam,
          );
          const awayAbbreviation = normalizeTeamKey(
            apiAwayTeam?.abbreviation || liveAwayTeam || game.awayTeam,
          );

          const homeNameKeys = new Set(
            [
              game.homeTeam,
              liveHomeTeam,
              apiGame ? getMLBHomeTeamName(apiGame) : null,
              apiGame ? getMLBTeamDisplayName(apiGame.home_team) : null,
              apiGame?.home_team?.name,
              apiGame?.home_team?.display_name,
              apiGame?.home_team?.short_display_name,
            ]
              .map(normalizeTeamKey)
              .filter(Boolean),
          );
          const awayNameKeys = new Set(
            [
              game.awayTeam,
              liveAwayTeam,
              apiGame ? getMLBAwayTeamName(apiGame) : null,
              getMLBTeamDisplayName(apiAwayTeam),
              apiAwayTeam?.name,
              apiAwayTeam?.display_name,
              apiAwayTeam?.short_display_name,
            ]
              .map(normalizeTeamKey)
              .filter(Boolean),
          );

          const getStatSide = (stat: (typeof mlbStats)[number]): "home" | "away" | null => {
            const statGameId = getMLBStatGameId(stat);
            if (statGameId != null && statGameId !== mlbGameIdNum) return null;

            const statAbbreviation = normalizeTeamKey(getMLBStatTeamAbbreviation(stat));
            if (statAbbreviation) {
              if (homeAbbreviation && statAbbreviation === homeAbbreviation) return "home";
              if (awayAbbreviation && statAbbreviation === awayAbbreviation) return "away";
            }

            const statTeamName = normalizeTeamKey(getMLBStatTeamName(stat));
            if (!statTeamName) return null;
            if (homeNameKeys.has(statTeamName)) return "home";
            if (awayNameKeys.has(statTeamName)) return "away";

            return null;
          };

          const homeStats: typeof mlbStats = [];
          const awayStats: typeof mlbStats = [];
          mlbStats.forEach((stat) => {
            const side = getStatSide(stat);
            if (side === "home") {
              homeStats.push(stat);
            } else if (side === "away") {
              awayStats.push(stat);
            }
          });

          const getTopPerformers = (stats: typeof mlbStats) => {
            return [...stats]
              .sort((a, b) => calculateMLBFantasyPoints(b) - calculateMLBFantasyPoints(a))
              .slice(0, 3)
              .map((s) => {
                const normalizedStats = parseStatsToJson(s);
                const side = getStatSide(s);
                return {
                  playerId: createMLBPlayerId(s.player.id),
                  name: `${s.player.first_name.charAt(0)}. ${s.player.last_name}`,
                  team:
                    side === "home"
                      ? liveHomeTeam || game.homeTeam
                      : side === "away"
                        ? liveAwayTeam || game.awayTeam
                        : getMLBStatTeamAbbreviation(s) || getMLBStatTeamName(s) || "UNK",
                  pts: Number(calculateMLBFantasyPoints(s).toFixed(1)),
                  hits: normalizedStats.hits || 0,
                  runs: normalizedStats.runs || 0,
                  rbi: normalizedStats.runsBattedIn || 0,
                };
              });
          };

          const mapPlayer = (s: (typeof mlbStats)[0]) => {
            const normalizedStats = parseStatsToJson(s);
            const side = getStatSide(s);
            return {
              id: s.player.id,
              playerId: createMLBPlayerId(s.player.id),
              name: `${s.player.first_name} ${s.player.last_name}`,
              team:
                side === "home"
                  ? liveHomeTeam || game.homeTeam
                  : side === "away"
                    ? liveAwayTeam || game.awayTeam
                    : getMLBStatTeamAbbreviation(s) || getMLBStatTeamName(s) || "UNK",
              position:
                (
                  s.player as typeof s.player & {
                    position_abbreviation?: string;
                    position?: string;
                  }
                ).position_abbreviation ||
                (s.player as typeof s.player & { position?: string }).position ||
                "",
              atBats: normalizedStats.atBats || 0,
              hits: normalizedStats.hits || 0,
              doubles: normalizedStats.doubles || 0,
              triples: normalizedStats.triples || 0,
              homeRuns: normalizedStats.homeRuns || 0,
              runs: normalizedStats.runs || 0,
              runsBattedIn: normalizedStats.runsBattedIn || 0,
              walks: normalizedStats.walks || 0,
              stolenBases: normalizedStats.stolenBases || 0,
              strikeoutsBatting: normalizedStats.strikeoutsBatting || 0,
              inningsPitched: normalizedStats.inningsPitched || 0,
              pitchingStrikeouts: normalizedStats.pitchingStrikeouts || 0,
              earnedRuns: normalizedStats.earnedRuns || 0,
              wins: normalizedStats.wins || 0,
              saves: normalizedStats.saves || 0,
              fantasyPoints: calculateMLBFantasyPoints(s),
            };
          };

          const homePlayers = homeStats.map(mapPlayer);
          const awayPlayers = awayStats.map(mapPlayer);

          const userEarnings = await buildUserLiveEarningsSummary({
            game,
            userId,
            livePlayers: [...homePlayers, ...awayPlayers],
            preloadedHoldings: userHoldingsWithPlayers || undefined,
          });

          return res.json({
            gameId,
            status: liveStatus,
            homeTeam: liveHomeTeam || game.homeTeam,
            homeScore: liveHomeScore,
            awayTeam: liveAwayTeam || game.awayTeam,
            awayScore: liveAwayScore,
            homePlayers,
            awayPlayers,
            homeTopPerformers: getTopPerformers(homeStats),
            awayTopPerformers: getTopPerformers(awayStats),
            userEarnings,
          });
        }

        console.log(`[live-stats] No MLB live stats available for ${gameId}`);

        const userEarnings = await buildUserLiveEarningsSummary({
          game,
          userId,
          livePlayers: await getStoredLiveEarningsPlayersForGame(game),
          preloadedHoldings: userHoldingsWithPlayers || undefined,
        });
        return res.json({
          gameId,
          status: liveStatus,
          homeTeam: liveHomeTeam || game.homeTeam,
          homeScore: liveHomeScore,
          awayTeam: liveAwayTeam || game.awayTeam,
          awayScore: liveAwayScore,
          homePlayers: [],
          awayPlayers: [],
          homeTopPerformers: [],
          awayTopPerformers: [],
          message: "No live stats available yet",
          userEarnings,
        });
      } else if (game.sport === "NHL") {
        // NHL box scores are synchronized server-side. Read only persisted rows here so
        // the browser never calls NHL directly and a provider outage preserves the last score.
        let period: number | null = null;
        let periodType: string | null = null;
        let clock: string | null = null;
        try {
          const { formatNhlGameDay, nhlApi } = await import("./nhl-api");
          const score = await nhlApi.getScore(formatNhlGameDay(new Date(game.startTime)));
          const providerGame = score.games.find((candidate) => `nhl_${candidate.id}` === gameId);
          period = providerGame?.periodDescriptor?.number ?? null;
          periodType = providerGame?.periodDescriptor?.periodType ?? null;
          clock = providerGame?.clock?.timeRemaining ?? null;
        } catch (error: any) {
          console.warn(
            `[live-stats] NHL state refresh unavailable for ${gameId}: ${error?.message || error}`,
          );
        }
        const nhlStats = await storage.getGameStatsByGameId(game.gameId);
        const mapNhlPlayer = async (stat: any) => {
          const player = await storage.getPlayer(stat.playerId);
          const stats = (stat.statsJson || {}) as Record<string, unknown>;
          return {
            id: String(stat.playerId).replace(/^nhl_/, ""),
            playerId: stat.playerId,
            name: player ? `${player.firstName} ${player.lastName}` : "Unknown player",
            team: player?.team || (stat.homeAway === "home" ? game.homeTeam : game.awayTeam),
            position: stats.position || null,
            goals: Number(stats.goals || 0),
            assists: Number(stats.assists || 0),
            points: Number(stats.points || 0),
            shotsOnGoal: Number(stats.shotsOnGoal || 0),
            hits: Number(stats.hits || 0),
            blockedShots: Number(stats.blockedShots || 0),
            saves: stats.saves == null ? null : Number(stats.saves),
            goalsAgainst: stats.goalsAgainst == null ? null : Number(stats.goalsAgainst),
            timeOnIce: stats.timeOnIce || null,
            decision: stats.decision || null,
            fantasyPoints: Number(stat.fantasyPoints || 0),
          };
        };
        const players = await Promise.all(nhlStats.map(mapNhlPlayer));
        const homePlayers = players.filter((player) => player.team === game.homeTeam);
        const awayPlayers = players.filter((player) => player.team === game.awayTeam);
        const topPerformers = (teamPlayers: typeof players) =>
          [...teamPlayers]
            .sort((a, b) => b.fantasyPoints - a.fantasyPoints)
            .slice(0, 3)
            .map(({ playerId, name, team, goals, assists, points, saves, fantasyPoints }) => ({
              playerId,
              name,
              team,
              goals,
              assists,
              points,
              saves,
              fantasyPoints,
            }));
        const userEarnings = await buildUserLiveEarningsSummary({
          game,
          userId,
          livePlayers: players,
          preloadedHoldings: userHoldingsWithPlayers || undefined,
        });
        return res.json({
          gameId,
          sport: "NHL",
          status: game.status,
          period,
          periodType,
          clock,
          homeTeam: game.homeTeam,
          homeScore: game.homeScore,
          awayTeam: game.awayTeam,
          awayScore: game.awayScore,
          homePlayers,
          awayPlayers,
          homeTopPerformers: topPerformers(homePlayers),
          awayTopPerformers: topPerformers(awayPlayers),
          message: players.length ? undefined : "No box score available yet",
          userEarnings,
        });
      } else if (game.sport === "NASCAR") {
        console.log(`[live-stats] Fetching NASCAR stored live stats for race ${gameId}`);

        const raceStats = await storage.getGameStatsByGameId(game.gameId);
        const raceSnapshot = await buildNascarRaceStatsSnapshot(game, raceStats);

        const driverPlayers = raceSnapshot.driverStandings.map((driver) => ({
          id: driver.playerId.replace(/^nascar_/, ""),
          playerId: driver.playerId,
          name: driver.driverName,
          team: game.awayTeam,
          position: "DRV",
          runningPosition: driver.position,
          startingPosition: driver.startingPosition,
          finishPosition:
            raceSnapshot.status === "completed" && driver.position > 0 ? driver.position : null,
          carNumber: driver.carNumber,
          manufacturer: driver.manufacturer,
          lapsCompleted: driver.lapsCompleted,
          lapsLed: driver.lapsLed,
          fastestLaps: driver.fastestLaps,
          positionDifferential: driver.positionDifferential,
          averageRunningPosition: driver.averageRunningPosition,
          averageSpeed: driver.averageSpeed,
          bestLap: driver.bestLap,
          bestLapSpeed: driver.bestLapSpeed,
          bestLapTime: driver.bestLapTime,
          delta: driver.delta,
          status: driver.status,
          isOnTrack: driver.isOnTrack,
          isOnDvp: driver.isOnDvp,
          providerPoints: driver.providerPoints,
          fantasyPoints: driver.fantasyPoints,
        }));

        const topDrivers = driverPlayers
          .filter((driver) => Number(driver.fantasyPoints || 0) > 0)
          .sort((left, right) => (right.fantasyPoints || 0) - (left.fantasyPoints || 0))
          .slice(0, 3)
          .map((driver) => ({
            playerId: driver.playerId,
            name: driver.name,
            team: game.awayTeam,
            pts: Number((driver.fantasyPoints || 0).toFixed(1)),
            position: driver.runningPosition,
            lapsLed: driver.lapsLed,
            fastestLaps: driver.fastestLaps,
          }));

        const userEarnings = await buildUserLiveEarningsSummary({
          game,
          userId,
          livePlayers: raceSnapshot.liveEarningsPlayers,
          preloadedHoldings: userHoldingsWithPlayers || undefined,
        });

        const message =
          raceStats.length === 0
            ? raceSnapshot.status === "scheduled"
              ? "Race has not started yet"
              : "No NASCAR live stats available yet"
            : undefined;

        return res.json({
          gameId,
          status: raceSnapshot.status,
          homeTeam: game.homeTeam,
          homeScore: 0,
          awayTeam: game.awayTeam,
          awayScore: 0,
          homePlayers: [],
          awayPlayers: driverPlayers,
          homeTopPerformers: [],
          awayTopPerformers: topDrivers,
          race: {
            raceId: game.gameId,
            trackName: game.homeTeam,
            series: game.awayTeam,
            venue: game.venue,
            lapInfo: raceSnapshot.lapInfo,
            totalDrivers: raceSnapshot.driverStandings.length,
          },
          lapInfo: raceSnapshot.lapInfo,
          message,
          userEarnings,
        });
      }

      return res.status(400).json({ error: "Unsupported sport" });
    } catch (error: any) {
      const upstreamStatus = error?.response?.status;

      if (upstreamStatus === 401) {
        return res.status(401).json({
          error: "Upstream sports API unauthorized (401). Confirm your API key is set correctly.",
        });
      }

      if (upstreamStatus === 429) {
        return res.status(429).json({
          error: "Upstream sports API rate limited (429). Please retry in a moment.",
        });
      }

      console.error("[live-stats] Error fetching live stats:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Add cash to user balance ($1) - DEVELOPMENT ONLY
  // This endpoint is disabled in production to prevent abuse
  app.post("/api/user/add-cash", isAuthenticated, async (req, res) => {
    try {
      // SECURITY: Disable in production
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ error: "This feature is disabled in production" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const updatedUser = await storage.addUserBalance(user.id, 1.0);

      if (updatedUser) {
        broadcast({ type: "portfolio", userId: user.id, balance: updatedUser.balance });
        res.json({ balance: updatedUser.balance });
      } else {
        res.status(500).json({ error: "Failed to update balance" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update username
  app.post("/api/user/update-username", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { username } = req.body;

      // Validate username
      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username is required" });
      }

      // Check length (3-20 characters)
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
      }

      // Check format (alphanumeric, underscores, hyphens only)
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res
          .status(400)
          .json({ error: "Username can only contain letters, numbers, underscores, and hyphens" });
      }

      // Check if username is already taken by another user
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        return res.status(409).json({ error: "Username is already taken" });
      }

      const updatedUser = await storage.updateUsername(userId, username);
      if (updatedUser) {
        void sendUserNotification({
          userId,
          category: "account_security",
          title: "Account Updated",
          body: "Your username was updated successfully.",
          deepLink: "/user/" + userId,
          dedupeKey: `security:username:${new Date().toISOString().slice(0, 16)}`,
        }).catch((error) => {
          console.error("[Account] Failed to send username security push:", error);
        });
        res.json({ username: updatedUser.username });
      } else {
        res.status(500).json({ error: "Failed to update username" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update profile image
  app.post("/api/user/update-profile-image", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { profileImageUrl } = req.body;

      // Validate URL
      if (!profileImageUrl || typeof profileImageUrl !== "string") {
        return res.status(400).json({ error: "Profile image URL is required" });
      }

      // Basic URL validation
      try {
        new URL(profileImageUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      const updatedUser = await storage.updateProfileImage(userId, profileImageUrl);
      if (updatedUser) {
        void sendUserNotification({
          userId,
          category: "account_security",
          title: "Account Updated",
          body: "Your profile image was updated.",
          deepLink: "/user/" + userId,
          dedupeKey: `security:avatar:${new Date().toISOString().slice(0, 16)}`,
        }).catch((error) => {
          console.error("[Account] Failed to send avatar security push:", error);
        });
        res.json({ profileImageUrl: updatedUser.profileImageUrl });
      } else {
        res.status(500).json({ error: "Failed to update profile image" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark onboarding as complete
  app.post("/api/user/onboarding/complete", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.markOnboardingComplete(userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to clean up duplicate game records (legacy MySportsFeeds data)
  app.post("/api/admin/games/cleanup-duplicates", adminAuth, async (req: any, res) => {
    try {
      console.log("[ADMIN] Starting duplicate game cleanup...");

      // Find all legacy MySportsFeeds records (gameId starting with 18447)
      const legacyRecords = await db
        .select({
          id: dailyGames.id,
          gameId: dailyGames.gameId,
          awayTeam: dailyGames.awayTeam,
          homeTeam: dailyGames.homeTeam,
          startTime: dailyGames.startTime,
        })
        .from(dailyGames)
        .where(sql`${dailyGames.gameId} LIKE '18447%' AND ${dailyGames.sport} = 'NBA'`)
        .limit(500);

      let deletedCount = 0;
      let keptCount = 0;
      const details: { deleted: string[]; kept: string[] } = { deleted: [], kept: [] };

      for (const legacy of legacyRecords) {
        // Check if there's a BallDontLie equivalent for the same teams at the same time
        const startTime = new Date(legacy.startTime);
        const minTime = new Date(startTime.getTime() - 5 * 60 * 1000);
        const maxTime = new Date(startTime.getTime() + 5 * 60 * 1000);

        const [match] = await db
          .select()
          .from(dailyGames)
          .where(
            and(
              eq(dailyGames.sport, "NBA"),
              sql`${dailyGames.gameId} NOT LIKE '18447%'`,
              sql`${dailyGames.awayTeam} = ${legacy.awayTeam}`,
              sql`${dailyGames.homeTeam} = ${legacy.homeTeam}`,
              sql`${dailyGames.startTime} >= ${minTime}`,
              sql`${dailyGames.startTime} <= ${maxTime}`,
            ),
          )
          .limit(1);

        if (match) {
          // Delete the legacy record
          await db.delete(dailyGames).where(eq(dailyGames.id, legacy.id));
          deletedCount++;
          details.deleted.push(`${legacy.gameId} (${legacy.awayTeam}@${legacy.homeTeam})`);
        } else {
          // No equivalent - keep this record
          keptCount++;
          details.kept.push(`${legacy.gameId} (${legacy.awayTeam}@${legacy.homeTeam})`);
        }
      }

      const result = {
        success: true,
        message: `Cleanup complete: ${deletedCount} duplicates deleted, ${keptCount} records kept (no BDL equivalent)`,
        deletedCount,
        keptCount,
        details: {
          deleted: details.deleted.slice(0, 50), // Limit response size
          kept: details.kept.slice(0, 10),
        },
      };

      console.log(`[ADMIN] Duplicate cleanup: ${deletedCount} deleted, ${keptCount} kept`);
      res.json(result);
    } catch (error: any) {
      console.error("[ADMIN] Error cleaning up duplicates:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to manually trigger sync jobs
  app.post("/api/admin/sync/:jobName", adminAuth, async (req, res) => {
    try {
      const { jobName } = req.params;
      const result = await jobScheduler.triggerJob(jobName);
      res.json({
        success: true,
        jobName,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Players / Marketplace
  app.get("/api/teams", async (req, res) => {
    try {
      const requestedSport = ((req.query.sport as string) || "").trim().toUpperCase();
      const teams =
        requestedSport && requestedSport !== "ALL"
          ? await storage.getDistinctTeamsBySport(requestedSport)
          : await storage.getDistinctTeams();
      res.json(withPublicDataHeaders(res, teams, { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all injured players (for showing injury indicators across the site)
  app.get("/api/players/injuries", async (req, res) => {
    try {
      const sportQuery = ((req.query.sport as string) || "ALL").toUpperCase();
      let playersList: Player[] = [];

      if (sportQuery === "ALL") {
        const playersBySport = await Promise.all(
          ["NBA", "NFL", "MLB", "NASCAR"].map((sport) => storage.getPlayersBySport(sport)),
        );
        playersList = playersBySport.flat();
      } else {
        playersList = await storage.getPlayersBySport(sportQuery);
      }

      // Filter to only injured players and return minimal data needed for UI indicators
      const injuredPlayers = playersList
        .filter((p) => p.injuryStatus)
        .map((p) => ({
          id: p.id,
          injuryStatus: p.injuryStatus,
          injuryDescription: p.injuryDescription,
          injuryReturnDate: p.injuryReturnDate,
        }));

      res.json(
        withPublicDataHeaders(res, injuredPlayers, {
          maxAgeSeconds: 60,
          sharedMaxAgeSeconds: 60,
        }),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top risers (24h) - players with highest priceChange24h
  app.get("/api/players/spotlight/top-risers", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";

      const normalizedSport = (sport || "ALL").toUpperCase();
      const sportFilter =
        normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;

      // AMM-only: players.price_change_24h is not maintained; compute risers from actual trades in last 24h.
      // Uses first vs last trade price within the window.
      const result: any = await db.execute(sql`
        WITH recent AS (
          SELECT
            t.player_id AS player_id,
            FIRST_VALUE(t.price::numeric) OVER (PARTITION BY t.player_id ORDER BY t.executed_at ASC) AS first_price,
            FIRST_VALUE(t.price::numeric) OVER (PARTITION BY t.player_id ORDER BY t.executed_at DESC) AS last_price
          FROM trades t
          INNER JOIN players p ON p.id = t.player_id
          WHERE t.executed_at >= NOW() - INTERVAL '24 hours'
            AND p.is_active = TRUE
            AND ${sportFilter}
        ),
        agg AS (
          SELECT
            DISTINCT
            player_id,
            first_price,
            last_price,
            CASE
              WHEN first_price > 0 THEN ((last_price - first_price) / first_price) * 100
              ELSE 0
            END AS pct_change
          FROM recent
        )
        SELECT
          p.id AS id,
          p.first_name AS "firstName",
          p.last_name AS "lastName",
          p.team AS team,
          p.position AS position,
          (a.last_price)::float8 AS "currentPrice",
          (a.pct_change)::float8 AS "priceChange24h"
        FROM agg a
        INNER JOIN players p ON p.id = a.player_id
        WHERE a.pct_change > 0
        ORDER BY a.pct_change DESC
        LIMIT ${limit};
      `);

      res.json(
        withPublicDataHeaders(
          res,
          (result?.rows || []).map((r: any) => ({
            id: r.id,
            firstName: r.firstName,
            lastName: r.lastName,
            team: r.team,
            position: r.position,
            currentPrice:
              typeof r.currentPrice === "number"
                ? r.currentPrice
                : r.currentPrice != null
                  ? parseFloat(r.currentPrice)
                  : null,
            priceChange24h:
              typeof r.priceChange24h === "number"
                ? r.priceChange24h
                : r.priceChange24h != null
                  ? parseFloat(r.priceChange24h)
                  : 0,
          })),
          { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 },
        ),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top market cap players
  app.get("/api/players/spotlight/top-market-cap", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";
      const players = await storage.getPlayersBySport(sport);

      const playerIds = players.map((p) => p.id);
      const poolDataMap = await storage.getBatchPoolData(playerIds);

      // Only include players with real AMM pool price data
      const topMarketCap = players
        .map((p) => {
          const poolData = poolDataMap.get(p.id);
          const ammSpotPrice =
            poolData && poolData.shares > 0 && poolData.playMoney > 0
              ? poolData.playMoney / poolData.shares
              : null;

          return {
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            team: p.team,
            position: p.position,
            currentPrice: ammSpotPrice,
            marketCap: parseFloat(p.marketCap),
            totalShares: p.totalShares,
          };
        })
        .filter(
          (p) =>
            p.currentPrice !== null &&
            Number.isFinite(p.currentPrice) &&
            p.currentPrice > 0 &&
            p.marketCap > 0,
        )
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, limit);

      res.json(
        withPublicDataHeaders(res, topMarketCap, { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 }),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top player pools by TVL (total value locked)
  app.get("/api/players/spotlight/top-pools", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";

      const normalizedSport = (sport || "ALL").toUpperCase();
      const sportFilter =
        normalizedSport === "ALL" ? sql`TRUE` : sql`UPPER(p.sport) = ${normalizedSport}`;

      // Avoid storage.getPlayerPoolsByPlayerIds -> it used SELECT * which can fail if DB is behind migrations.
      const result: any = await db.execute(sql`
        SELECT
          pp.player_id AS "playerId",
          (pp.shares)::float8 AS shares,
          (pp.play_money)::float8 AS "playMoney",
          (CASE WHEN (pp.shares)::numeric > 0 THEN (pp.play_money)::numeric * 2 ELSE (pp.play_money)::numeric END)::float8 AS tvl,
          p.first_name AS "firstName",
          p.last_name AS "lastName",
          p.team AS team,
          p.position AS position,
          (p.current_price)::float8 AS "currentPrice"
        FROM player_pools pp
        INNER JOIN players p ON p.id = pp.player_id
        WHERE p.is_active = TRUE
          AND ${sportFilter}
        ORDER BY tvl DESC
        LIMIT ${limit};
      `);

      res.json(
        withPublicDataHeaders(
          res,
          (result?.rows || []).map((r: any) => ({
            player: {
              id: r.playerId,
              firstName: r.firstName,
              lastName: r.lastName,
              team: r.team || "",
              position: r.position || "",
              currentPrice:
                typeof r.currentPrice === "number"
                  ? r.currentPrice
                  : r.currentPrice != null
                    ? parseFloat(r.currentPrice)
                    : null,
            },
            tvl: typeof r.tvl === "number" ? r.tvl : r.tvl != null ? parseFloat(r.tvl) : 0,
            shares:
              typeof r.shares === "number" ? r.shares : r.shares != null ? parseFloat(r.shares) : 0,
            playMoney:
              typeof r.playMoney === "number"
                ? r.playMoney
                : r.playMoney != null
                  ? parseFloat(r.playMoney)
                  : 0,
          })),
          { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 },
        ),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  registerPlayersRoutes(app, {
    storage,
    optionalAuth,
    getTodayET,
    getETDayBoundaries,
    getMarketplaceGameStatus,
    enrichPlayerWithMarketValue,
    isAmmOnlyMode,
    getMlbPlayerPregameLookup,
    getMlbPitcherMatchupChip,
  });

  // Market activity feed
  app.get("/api/market/activity", async (req, res) => {
    try {
      const {
        playerId,
        userId,
        playerSearch,
        search,
        team,
        side,
        signal,
        gameState,
        whalesOnly,
        minNotional,
        sort,
        limit,
        offset,
        sport,
      } = req.query;

      const parsedLimit = limit ? parseInt(limit as string, 10) : 40;
      const parsedOffset = offset ? parseInt(offset as string, 10) : 0;
      const safeLimit = Number.isNaN(parsedLimit) ? 40 : Math.max(1, Math.min(parsedLimit, 100));
      const safeOffset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
      const effectiveSearch =
        typeof search === "string" && search.trim().length > 0
          ? search.trim()
          : typeof playerSearch === "string"
            ? playerSearch.trim()
            : "";
      const normalizedSport = typeof sport === "string" && sport.trim().length > 0 ? sport : "ALL";
      // Fetch deeper than the visible page so server-side filtering/sorting can still return
      // a full ledger page plus summary/highlight context from recent site-wide activity.
      const fetchWindow = getMarketActivitySourceFetchWindow(safeLimit, safeOffset);
      const normalizedSide: MarketActivitySideFilter =
        typeof side === "string" && ["buy", "sell", "peer", "all"].includes(side)
          ? (side as MarketActivitySideFilter)
          : "all";
      const normalizedSignal: MarketActivitySignalTag | "all" =
        typeof signal === "string" &&
        (signal === "all" ||
          MARKET_ACTIVITY_SIGNAL_TAGS.includes(signal as MarketActivitySignalTag))
          ? (signal as MarketActivitySignalTag | "all")
          : "all";
      const normalizedGameState: MarketActivityGameStateFilter =
        typeof gameState === "string" &&
        ["all", "none", "upcoming", "live", "ended"].includes(gameState)
          ? (gameState as MarketActivityGameStateFilter)
          : "all";
      const normalizedSort: MarketActivitySort =
        typeof sort === "string" && MARKET_ACTIVITY_SORTS.includes(sort as MarketActivitySort)
          ? (sort as MarketActivitySort)
          : "recent";
      const whalesOnlyEnabled = whalesOnly === "true" || whalesOnly === "1" || whalesOnly === "yes";
      const minimumNotional =
        typeof minNotional === "string" ? Math.max(parseFloat(minNotional) || 0, 0) : 0;

      const [activity, overview] = await Promise.all([
        storage.getMarketActivity({
          playerId: playerId as string,
          userId: userId as string,
          playerSearch: effectiveSearch,
          limit: fetchWindow,
          sport: normalizedSport,
        }),
        buildMobileMarketOverview({ sport: normalizedSport }),
      ]);

      const feed = buildMarketActivityFeed({
        activity,
        overview,
        limit: safeLimit,
        offset: safeOffset,
        filters: {
          search: effectiveSearch,
          team: typeof team === "string" ? team : undefined,
          playerId: typeof playerId === "string" ? playerId : undefined,
          side: normalizedSide,
          signal: normalizedSignal,
          gameState: normalizedGameState,
          whalesOnly: whalesOnlyEnabled,
          minNotional: minimumNotional,
          sort: normalizedSort,
        },
      });

      res.json(
        withPublicDataHeaders(res, feed, {
          maxAgeSeconds: 60,
          sharedMaxAgeSeconds: 60,
        }),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Market activity level endpoint for Market Pulse
  app.get("/api/market/activity-level", async (req, res) => {
    try {
      // Calculate activity level based on trades in last 15 minutes
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      const recentTrades = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trades)
        .where(gte(trades.executedAt, fifteenMinutesAgo));

      const tradeCount = recentTrades[0]?.count || 0;

      // Normalize to 0-100 scale (assume 100 trades = max activity)
      const activityLevel = Math.min((tradeCount / 100) * 100, 100);

      res.json(
        withPublicDataHeaders(
          res,
          {
            activityLevel,
            tradeCount,
            timestamp: new Date().toISOString(),
          },
          { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 },
        ),
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  registerMarketMobileRoutes(app);

  // User collections endpoint
  app.get("/api/collections", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const collections = await db
        .select()
        .from(userCollections)
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.completed), desc(userCollections.updatedAt));
      res.json(collections);
    } catch (error: any) {
      // If migrations haven't been applied yet, keep the app usable.
      if (error?.code === "42P01") {
        return res.json([]);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get specific collection details
  app.get("/api/collections/:type/:targetId", isAuthenticated, async (req, res) => {
    try {
      const { type, targetId } = req.params;
      const userId = getUserId(req);

      const collection = await db
        .select()
        .from(userCollections)
        .where(
          and(
            eq(userCollections.userId, userId),
            eq(userCollections.collectionType, type),
            eq(userCollections.targetId, targetId),
          ),
        )
        .limit(1);

      if (collection.length === 0) {
        return res.status(404).json({ error: "Collection not found" });
      }

      // Get owned players in this collection
      let ownedPlayers: any[] = [];

      if (type === "team") {
        // Get all active players from this team that user owns
        const teamPlayers = await db
          .select({
            playerId: players.id,
            firstName: players.firstName,
            lastName: players.lastName,
            position: players.position,
            team: players.team,
            quantity: holdings.quantity,
          })
          .from(players)
          .leftJoin(
            holdings,
            and(
              eq(holdings.assetId, players.id),
              eq(holdings.userId, userId),
              eq(holdings.assetType, "player"),
            ),
          )
          .where(and(eq(players.team, targetId), eq(players.isActive, true)));

        ownedPlayers = teamPlayers.filter((p) => parseFloat(p.quantity || "0") > 0);
      }

      res.json({
        collection: collection[0],
        ownedPlayers,
      });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(404).json({ error: "Collection not found" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // User milestones endpoint
  app.get("/api/milestones", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const milestones = await db
        .select()
        .from(userMilestones)
        .where(eq(userMilestones.userId, userId))
        .orderBy(desc(userMilestones.achievedAt));
      res.json(milestones);
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.json([]);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Mark milestone as celebrated
  app.post("/api/milestones/:id/celebrate", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);

      const milestone = await db
        .select()
        .from(userMilestones)
        .where(and(eq(userMilestones.id, id), eq(userMilestones.userId, userId)))
        .limit(1);

      if (milestone.length === 0) {
        return res.status(404).json({ error: "Milestone not found" });
      }

      await db.update(userMilestones).set({ celebrated: true }).where(eq(userMilestones.id, id));

      res.json({ success: true });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res
          .status(503)
          .json({ error: "Milestones unavailable - database migrations not applied" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // User trade history (for checklist/onboarding and portfolio)
  app.get("/api/trades/history", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const trades = await storage.getMarketActivity({ userId, limit: 100 });
      res.json(trades);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Watch List - Legacy endpoint (returns all player IDs across all watchlists)
  app.get("/api/watchlist", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const playerIds = await storage.getWatchList(userId);
      res.json(playerIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Multi-watchlist endpoints
  app.get("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const watchlists = await storage.getWatchlists(userId);
      res.json(watchlists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, color } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Watchlist name is required" });
      }
      const watchlist = await storage.createWatchlist(userId, name, false, color);
      res.json(watchlist);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, color } = req.body;
      await storage.updateWatchlist(id, { name, color });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteWatchlist(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get items in a specific watchlist
  app.get("/api/watchlists/:id/items", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const playerIds = await storage.getWatchlistItems(id);
      res.json(playerIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add player to watchlist (with optional watchlistId, defaults to Favorites)
  app.post("/api/watchlist/:playerId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const { watchlistId } = req.body || {};
      await storage.addToWatchList(userId, playerId, watchlistId);

      // Get the watchlist name for response
      const watchlistDetails = watchlistId
        ? (await storage.getWatchlists(userId)).find((w) => w.id === watchlistId)
        : (await storage.getWatchlists(userId)).find((w) => w.isDefault);

      res.json({
        success: true,
        watchlistId: watchlistDetails?.id,
        watchlistName: watchlistDetails?.name || "Favorites",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove player from watchlist (with optional watchlistId)
  app.delete("/api/watchlist/:playerId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const watchlistId = req.query.watchlistId as string | undefined;
      await storage.removeFromWatchList(userId, playerId, watchlistId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get which watchlists contain a specific player
  app.get("/api/player/:playerId/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const watchlistIds = await storage.getPlayerWatchlists(userId, playerId);
      res.json(watchlistIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Player detail page
  app.get("/api/player/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const playerRaw = await storage.getPlayer(req.params.id);

      if (!playerRaw) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Enrich with market value
      const player = await enrichPlayerWithMarketValue(playerRaw);

      // AMM-only parity: player page price should match pool spot price
      if (isAmmOnlyMode) {
        const pool = await getPool(player.id);
        player.lastTradePrice = pool ? pool.currentPrice.toFixed(2) : null;
      }

      // Parse time range for chart data (1D, 1W, 1M, 1Y)
      const range = (req.query.range as string) || "1D";
      const rangeHours: Record<string, number> = {
        "1D": 24,
        "1W": 24 * 7,
        "1M": 24 * 30,
        "1Y": 24 * 365,
      };
      const hoursBack = rangeHours[range] || 24;
      const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Get trades within time range for chart (more trades for longer ranges)
      const tradesLimit = range === "1Y" ? 500 : range === "1M" ? 200 : range === "1W" ? 100 : 50;
      const recentTradesRaw = await storage.getRecentTrades(player.id, tradesLimit);

      // In AMM-only mode, only chart/list AMM-executed trades (pool is one side of the trade).
      const allTrades = isAmmOnlyMode
        ? recentTradesRaw.filter((t: any) => t.buyerId === "pool" || t.sellerId === "pool")
        : recentTradesRaw;

      // Filter trades within time range
      const tradesInRange = allTrades.filter((t) => new Date(t.executedAt) >= cutoffDate);

      // Build priceHistory from actual trades (sorted oldest to newest for chart)
      const priceHistory = tradesInRange
        .map((trade) => ({
          timestamp: trade.executedAt.toISOString(),
          price: parseFloat(trade.price),
        }))
        .reverse(); // Oldest first for proper chart display

      const recentTrades = allTrades.slice(0, 20); // Always show 20 most recent trades in the list
      const userHolding = await storage.getHolding(user.id, "player", player.id);

      // Calculate available balance (excluding locked cash for buy orders)
      const availableBalance = await storage.getAvailableBalance(user.id);

      res.json({
        player,
        priceHistory,
        recentTrades: await Promise.all(
          recentTrades.map(async (trade) => ({
            ...trade,
            buyer: await storage.getUser(trade.buyerId),
            seller: await storage.getUser(trade.sellerId),
          })),
        ),
        userBalance: availableBalance.toFixed(2),
        userHolding,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Player season stats (PPG, RPG, APG, etc.)
  app.get("/api/player/:id/stats", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Fetch season stats from cached game logs (no API call)
      const seasonStats = await storage.getPlayerSeasonStatsFromLogs(player.id);

      if (!seasonStats) {
        return res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: null,
        });
      }

      if (
        seasonStats.sport === "NFL" ||
        seasonStats.sport === "MLB" ||
        seasonStats.sport === "NASCAR"
      ) {
        return res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: seasonStats,
        });
      }

      if (seasonStats.sport === "NBA") {
        return res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: {
            // Pass sport through
            sport: seasonStats.sport,
            gamesPlayed: seasonStats.gamesPlayed,
            // Fantasy scoring
            avgFantasyPointsPerGame: seasonStats.avgFantasyPointsPerGame,
            // Scoring
            points: Math.round(parseFloat(seasonStats.pointsPerGame) * seasonStats.gamesPlayed),
            pointsPerGame: seasonStats.pointsPerGame,
            fieldGoalPct: seasonStats.fieldGoalPct,
            threePointPct: seasonStats.threePointPct,
            freeThrowPct: seasonStats.freeThrowPct,
            // Rebounding
            rebounds: Math.round(parseFloat(seasonStats.reboundsPerGame) * seasonStats.gamesPlayed),
            reboundsPerGame: seasonStats.reboundsPerGame,
            offensiveRebounds: 0, // Not tracked in simplified cache
            defensiveRebounds: 0, // Not tracked in simplified cache
            // Playmaking
            assists: Math.round(parseFloat(seasonStats.assistsPerGame) * seasonStats.gamesPlayed),
            assistsPerGame: seasonStats.assistsPerGame,
            turnovers: 0, // Not tracked in summary
            // Defense
            steals: seasonStats.steals,
            blocks: seasonStats.blocks,
            // Minutes
            minutes: Math.round(parseFloat(seasonStats.minutesPerGame) * seasonStats.gamesPlayed),
            minutesPerGame: seasonStats.minutesPerGame,
          },
        });
      }

      return res.json({
        player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
        team: { abbreviation: player.team },
        stats: seasonStats,
      });
    } catch (error: any) {
      console.error("[API] Error fetching player stats:", error.message);
      // Return graceful fallback instead of 500 error
      res.json({
        stats: null,
        error: "Stats temporarily unavailable",
      });
    }
  });

  // Player recent games (last 10 games)
  app.get("/api/player/:id/recent-games", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Fetch last 10 games from cached game logs (no API call)
      const recentGames = await storage.getPlayerRecentGamesFromLogs(player.id, 10);

      res.json({ recentGames });
    } catch (error: any) {
      console.error("[API] Error fetching player game logs:", error.message);
      // Return graceful fallback instead of 500 error
      res.json({
        recentGames: [],
        error: "Game logs temporarily unavailable",
      });
    }
  });

  // MLB player context for today's/upcoming matchup, lineup, pitcher, and Statcast cues.
  app.get("/api/player/:id/mlb-context", optionalAuth, async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      if (String(player.sport || "").toUpperCase() !== "MLB") {
        return res.json(
          buildMlbPlayerContextPayload({
            player,
            game: null,
            mlbPregame: null,
            signals: [],
          }),
        );
      }

      const now = new Date();
      const lookback = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const lookahead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const team = String(player.team || "")
        .trim()
        .toUpperCase();
      const [game] = await db
        .select()
        .from(dailyGames)
        .where(
          and(
            sql`UPPER(${dailyGames.sport}) = 'MLB'`,
            gte(dailyGames.startTime, lookback),
            lte(dailyGames.startTime, lookahead),
            or(
              sql`UPPER(${dailyGames.homeTeam}) = ${team}`,
              sql`UPPER(${dailyGames.awayTeam}) = ${team}`,
            ),
          ),
        )
        .orderBy(asc(dailyGames.startTime))
        .limit(1);

      if (!game) {
        return res.json(
          buildMlbPlayerContextPayload({
            player,
            game: null,
            mlbPregame: null,
            signals: [],
          }),
        );
      }

      const dateStr = getGameDay(game.startTime);
      const userId = req.user ? getUserId(req) : null;
      const { insights } = await buildGameInsights({
        games: [game],
        sport: "MLB",
        dateStr,
        userId,
        includeMlbGameDetails: true,
        includeMlbDeepContext: false,
      });
      const gameInsight = insights[0] || null;
      const mlbPregame = gameInsight?.mlbPregame || null;

      res.json(
        buildMlbPlayerContextPayload({
          player,
          game,
          mlbPregame,
          signals: gameInsight?.mlbSignals || [],
        }),
      );
    } catch (error: any) {
      console.error("[API] Error fetching MLB player context:", error.message);
      res.json({
        game: null,
        matchupSummary: null,
        weatherSummary: null,
        lineup: null,
        opposingProbablePitcher: null,
        hitterSpotlight: null,
        playerSignals: [],
        error: "MLB context temporarily unavailable",
      });
    }
  });

  // Player shares info (total shares outstanding and market cap)
  app.get("/api/player/:id/shares-info", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Calculate total shares outstanding across all users
      const totalSharesResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${holdings.quantity}), 0)` })
        .from(holdings)
        .where(and(eq(holdings.assetType, "player"), eq(holdings.assetId, player.id)));

      const totalShares = Number(totalSharesResult[0]?.total || 0);

      // Use ONLY last trade price - never fall back to placeholder currentPrice
      // If no trades have occurred, price and market cap are null
      const sharePrice = player.lastTradePrice ? parseFloat(player.lastTradePrice) : null;
      const marketCap = sharePrice !== null ? totalShares * sharePrice : null;

      // Get number of unique holders
      const holdersResult = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${holdings.userId})` })
        .from(holdings)
        .where(
          and(
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, player.id),
            sql`${holdings.quantity} > 0`,
          ),
        );

      const totalHolders = Number(holdersResult[0]?.count || 0);

      res.json({
        player: {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
        },
        sharesInfo: {
          totalSharesOutstanding: totalShares,
          currentSharePrice: sharePrice !== null ? sharePrice.toFixed(2) : null,
          marketCap: marketCap !== null ? marketCap.toFixed(2) : null,
          totalHolders,
          volume24h: player.volume24h,
          priceChange24h: player.priceChange24h,
        },
      });
    } catch (error: any) {
      console.error("[API] Error fetching shares info:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get player financial metrics (Gamified Stats)
  app.get("/api/player/:id/financials", async (req, res) => {
    try {
      const metrics = await storage.getPlayerFinancialMetrics(req.params.id);
      res.json(metrics);
    } catch (error: any) {
      console.error("[API] Error fetching financial metrics:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Portfolio
  app.get("/api/portfolio", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userState = await loadEffectiveUserState(userId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = userState.user;

      // Optimized: Single JOIN query to get holdings + players + locks
      const holdingsWithData = await storage.getUserHoldingsWithPlayers(user.id);

      let totalValue = 0;
      let totalPnL = 0;
      let totalCost = 0;

      const playerHoldingIds = holdingsWithData
        .filter((item: any) => item.holding.assetType === "player" && item.player)
        .map((item: any) => item.player.id.toString());

      const poolDataMap =
        playerHoldingIds.length > 0 ? await storage.getBatchPoolData(playerHoldingIds) : new Map();
      const globalScoutMap =
        playerHoldingIds.length > 0
          ? await storage.getBatchActiveScoutCounts(playerHoldingIds)
          : new Map();

      // Group holdings by player to calculate total effective shares
      const playerEffectiveSharesMap = new Map<string, number>();
      holdingsWithData
        .filter((item: any) => item.holding.assetType === "player")
        .forEach((item: any) => {
          const playerId = item.holding.assetId;
          const currentEffectiveShares = playerEffectiveSharesMap.get(playerId) || 0;
          const holdingEffectiveShares = parseFloat(
            item.holding.effectiveShares || item.holding.quantity || "0",
          );
          playerEffectiveSharesMap.set(playerId, currentEffectiveShares + holdingEffectiveShares);
        });

      const enrichedHoldings = holdingsWithData.map((item: any) => {
        const holding = item.holding;
        const player = item.player;
        const lockedQuantity = Number(item.totalLocked || 0);

        if (holding.assetType === "player" && player) {
          const effectiveShares = parseFloat(holding.effectiveShares || holding.quantity || "0");
          const poolData = poolDataMap.get(player.id);
          const poolTvl =
            poolData?.shares && poolData.shares > 0
              ? poolData.playMoney * 2
              : poolData?.playMoney || 0;

          // Use effective shares for valuation so stacked shares carry their multiplier exposure.
          const { currentValue, pnl, pnlPercent } = calculatePnL(
            effectiveShares,
            holding.avgCostBasis,
            player.lastTradePrice,
          );

          if (currentValue !== null) {
            totalValue += parseFloat(currentValue);
            totalPnL += parseFloat(pnl!);
            totalCost += parseFloat(holding.totalCostBasis);
          }

          const globalScoutCount = globalScoutMap.get(player.id.toString()) || 0;
          const totalPlayerEffectiveShares = playerEffectiveSharesMap.get(player.id) || 0;

          return {
            ...holding,
            player: {
              ...player,
              poolLiquidity: poolData?.playMoney || 0,
              poolTvl,
              poolShares: poolData?.shares || 0,
              poolTotalTrades: poolData?.totalTrades || 0,
            },
            currentValue,
            pnl,
            pnlPercent,
            lockedQuantity,
            availableQuantity: Math.max(0, holding.quantity - lockedQuantity),
            effectiveShares: effectiveShares.toFixed(2),
            multiplier: holding.multiplier ?? "1.00",
            hasStackedShare: Boolean(holding.isStackedShare),
            totalPlayerEffectiveShares: totalPlayerEffectiveShares.toFixed(2),
            globalScoutCount,
          };
        }
        return holding;
      });

      const premiumShares =
        holdingsWithData.find((item: any) => item.holding.assetType === "premium")?.holding
          .quantity || 0;

      res.json({
        balance: user.balance,
        portfolioValue: totalValue.toFixed(2),
        totalPnL: totalPnL.toFixed(2),
        totalPnLPercent: totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(2) : "0.00",
        holdings: enrichedHoldings,
        premiumShares,
        isPremium: userState.entitlements.premiumActive,
        premiumActive: userState.entitlements.premiumActive,
        premiumExpiresAt: userState.entitlements.premiumExpiresAt,
        rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
        rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
        maxScouts: userState.entitlements.maxScouts,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Activity feed - user transactions and activity timeline
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { types, limit, offset } = req.query;

      // Parse types filter (comma-separated string to array)
      let typesArray: UserActivityCategory[] | undefined;
      if (types && typeof types === "string") {
        typesArray = types
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry): entry is UserActivityCategory =>
            USER_ACTIVITY_CATEGORIES.includes(entry as UserActivityCategory),
          );
      }

      const filters = {
        types: typesArray?.length ? typesArray : DEFAULT_ACTIVITY_FEED_CATEGORIES,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      };

      const activityFeed = await storage.getUserActivityFeed(userId, filters);

      res.json(activityFeed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // Scout Engine API Routes
  // =====================

  // Get user's scout assignments and capacity
  app.get("/api/scouts", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userState = await loadEffectiveUserState(userId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
      }

      // Keep-Alive: Update activity timestamp to ensure user remains eligible for payouts
      await storage.updateLastActive(userId);

      const [assignments, totalScouts] = await Promise.all([
        storage.getUserScoutAssignments(userId),
        storage.getTotalScoutsForUser(userId),
      ]);

      const { entitlements } = userState;
      const maxScouts = entitlements.maxScouts;

      // Enrich assignments with player data
      const playerIds = assignments.map((a) => a.playerId);
      const [players, globalScoutCounts, seasonStatsMap] =
        playerIds.length > 0
          ? await Promise.all([
              storage.getPlayersByIds(playerIds),
              storage.getBatchActiveScoutCounts(playerIds),
              storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
            ])
          : [[], new Map<string, number>(), new Map<string, any>()];

      const playerMap = new Map(players.map((p) => [p.id, p]));

      const enrichedAssignments = assignments.map((a) => {
        const player = playerMap.get(a.playerId);
        const seasonStats = seasonStatsMap.get(a.playerId) || { avgFantasyPointsPerGame: "0.0" };

        return {
          ...a,
          player: player
            ? {
                ...player,
                avgFantasyPointsPerGame: seasonStats.avgFantasyPointsPerGame,
              }
            : null,
          globalScoutCount: globalScoutCounts.get(a.playerId) || 0,
        };
      });

      res.json({
        assignments: enrichedAssignments,
        totalScouts,
        maxScouts,
        remaining: maxScouts - totalScouts,
        isPremium: entitlements.premiumActive,
        premiumActive: entitlements.premiumActive,
        premiumExpiresAt: entitlements.premiumExpiresAt,
        rewardedScoutBoostActive: entitlements.rewardedScoutBoostActive,
        rewardedScoutBoostExpiresAt: entitlements.rewardedScoutBoostExpiresAt,
      });
    } catch (error: any) {
      console.error("[Scout API] Error fetching scouts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Assign scouts to a player
  app.post("/api/scouts/assign", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, count } = req.body;

      if (!playerId || typeof playerId !== "string") {
        return res.status(400).json({ error: "playerId is required" });
      }

      const parsedCount = parseInt(count, 10);
      if (isNaN(parsedCount) || parsedCount < 0) {
        return res.status(400).json({ error: "count must be a non-negative integer" });
      }

      // Verify player exists
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // In AMM mode, scouting is allowed for any player at any time.
      // assignScouts throws if limit exceeded.
      await storage.assignScouts(userId, playerId, parsedCount);

      // Return updated scout data
      const [assignments, totalScouts] = await Promise.all([
        storage.getUserScoutAssignments(userId),
        storage.getTotalScoutsForUser(userId),
      ]);

      const userState = await loadEffectiveUserState(userId);
      const entitlements = userState?.entitlements;
      const maxScouts = entitlements?.maxScouts ?? 5;

      console.log(
        `[Scout API] User ${userId} assigned ${parsedCount} scouts to player ${playerId}`,
      );

      // Broadcast real-time update to all clients
      broadcast({
        type: "scout_update",
        data: {
          playerId,
          count: parsedCount,
          userId, // Optional: helps client ignore self-echo if optimistically updated
        },
      });

      void sendUserNotification({
        userId,
        category: "scout_lifecycle",
        title: "Scouts Updated",
        body:
          parsedCount === 0
            ? "Scout assignment removed."
            : `You now have ${parsedCount} scouts assigned.`,
        deepLink: `/player/${playerId}`,
        data: {
          playerId,
          scoutCount: String(parsedCount),
        },
        dedupeKey: `scout_assign:${playerId}:${parsedCount}`,
      }).catch((error) => {
        console.error("[Scout API] Failed to send scout notification:", error);
      });

      res.json({
        success: true,
        assignments,
        totalScouts,
        maxScouts,
        remaining: maxScouts - totalScouts,
        premiumActive: entitlements?.premiumActive ?? false,
        rewardedScoutBoostActive: entitlements?.rewardedScoutBoostActive ?? false,
        rewardedScoutBoostExpiresAt: entitlements?.rewardedScoutBoostExpiresAt ?? null,
      });
    } catch (error: any) {
      console.error("[Scout API] Error assigning scouts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get scout roster for a specific player (Leaderboard)
  app.get("/api/scouts/roster/:playerId", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const roster = await storage.getScoutRoster(playerId);
      res.json(roster);
    } catch (error: any) {
      console.error("[Scout API] Error fetching roster:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DEBUG: DB Connection Check
  app.get("/api/debug/db-check", async (req, res) => {
    try {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(scoutAssignments)
        .where(eq(scoutAssignments.playerId, "nba_31030"));

      res.json({
        host: "masked",
        database: "masked",
        scoutAssignmentsCount: count[0].count,
      });
    } catch (err: any) {
      console.error("Debug check failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // =====================
  // User Agent API Routes
  // =====================
  app.get("/api/agent/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const profile = await getPortfolioAgentProfile(userId);
      res.json(profile);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error fetching profile:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/capabilities", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const capabilities = await getAgentCapabilities(userId);
      res.json(capabilities);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error fetching capabilities:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.put("/api/agent/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const profile = await updatePortfolioAgentProfile(userId, req.body);
      res.json(profile);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error updating profile:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.put("/api/agent/byok-key", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const profile = await savePortfolioAgentByok(userId, req.body);
      res.json(profile);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error saving BYOK:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.delete("/api/agent/byok-key", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const profile = await clearPortfolioAgentByok(userId);
      res.json(profile);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error clearing BYOK:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/threads", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const workspace =
        req.query.workspace === "chat" || req.query.workspace === "strategy"
          ? req.query.workspace
          : undefined;
      const threads = await listAgentThreads(userId, { workspace });
      res.json(threads);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing threads:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/threads", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const thread = await createAgentThread(userId, req.body ?? {});
      res.json(thread);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error creating thread:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/threads/:threadId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const thread = await getAgentThread(userId, req.params.threadId);
      res.json(thread);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error fetching thread:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/threads/:threadId/messages", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const messages = await listAgentThreadMessages(userId, req.params.threadId);
      res.json(messages);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing thread messages:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/threads/:threadId/runtime-details", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const details = await getAgentThreadRuntimeDetails(userId, req.params.threadId);
      res.json(details);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error fetching thread runtime details:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/threads/:threadId/research-sources", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const citations = await listAgentThreadResearchSources(userId, req.params.threadId);
      res.json(citations);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing thread research sources:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get(
    "/api/agent/threads/:threadId/turns/:turnId/events",
    isAuthenticated,
    async (req, res) => {
      try {
        const userId = getUserId(req);
        const threadId = req.params.threadId;
        const turnId = req.params.turnId;
        await getAgentThread(userId, threadId);

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();

        agentTurnEventStreamManager.registerClient({
          userId,
          threadId,
          turnId,
          req,
          res,
        });

        agentTurnEventStreamManager.emit({
          userId,
          threadId,
          turnId,
          event: {
            eventType: "stream_connected",
            status: "info",
            summary: "Progress stream connected.",
            phase: "plan",
          },
        });

        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keepalive\n\n");
          }
        }, 15_000);

        req.on("close", () => clearInterval(heartbeat));
        req.on("error", () => clearInterval(heartbeat));
        res.on("close", () => clearInterval(heartbeat));
        res.on("error", () => clearInterval(heartbeat));
      } catch (error: any) {
        const message = normalizeAgentErrorMessage(error);
        console.error("[Agent API] Error opening thread turn event stream:", message);
        res.status(getAgentErrorStatus(error)).json({ error: message });
      }
    },
  );

  app.post("/api/agent/threads/:threadId/messages", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await sendAgentThreadMessage(userId, req.params.threadId, req.body ?? {});
      res.json(result);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error sending thread message:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/threads/:threadId/confirm", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await confirmAgentThread(userId, req.params.threadId);
      res.json(result);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error confirming thread plan:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/threads/:threadId/cancel", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await cancelAgentThread(userId, req.params.threadId);
      res.json(result);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error canceling thread plan:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/strategies", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategies = await listUserAgentStrategies(userId);
      res.json(strategies);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing strategies:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/strategies/:strategyId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await getUserAgentStrategyDetail(userId, req.params.strategyId);
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error loading strategy detail:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await createUserAgentStrategyFromThread(userId, req.body ?? {});
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error creating strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.patch("/api/agent/strategies/:strategyId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await updateUserAgentStrategy(userId, req.params.strategyId, req.body ?? {});
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error updating strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies/:strategyId/activate", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await activateUserAgentStrategy(userId, req.params.strategyId);
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error activating strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies/:strategyId/review", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await reviewUserAgentStrategy(userId, req.params.strategyId);
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error reviewing strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies/:strategyId/pause", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await pauseUserAgentStrategy(userId, req.params.strategyId);
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error pausing strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies/:strategyId/archive", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const strategy = await archiveUserAgentStrategy(userId, req.params.strategyId);
      res.json(strategy);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error archiving strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/strategies/:strategyId/runs", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const runs = await listUserAgentStrategyRuns({
        userId,
        strategyId: req.params.strategyId,
        limit: Number.parseInt(String(req.query.limit || ""), 10) || 10,
      });
      res.json(runs);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing strategy runs:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/strategies/:strategyId/events", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const events = await listUserAgentStrategyEvents({
        userId,
        strategyId: req.params.strategyId,
        limit: Number.parseInt(String(req.query.limit || ""), 10) || 20,
      });
      res.json(events);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing strategy events:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/strategies/:strategyId/run", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await runUserAgentStrategy({
        userId,
        strategyId: req.params.strategyId,
        triggerSource: "manual_retry",
      });
      res.json(result);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error running strategy:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  // --- MCP Source Routes ---

  app.get("/api/agent/mcp-sources", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { profile } = await getPortfolioAgentProfile(userId);
      const sources = await listAgentDataSources(userId, profile);
      res.json(sources);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error listing MCP sources:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/agent/mcp-sources/:sourceId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { profile } = await getPortfolioAgentProfile(userId);
      const source = await getAgentDataSource(userId, req.params.sourceId, profile);
      if (!source) {
        return res.status(404).json({ error: "MCP source not found." });
      }
      res.json(source);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error loading MCP source:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/agent/mcp-sources", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const source = await createUserMcpSource(userId, req.body ?? {});
      res.json(source);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error creating MCP source:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.patch("/api/agent/mcp-sources/:sourceId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await getPortfolioAgentProfile(userId);
      const source = await updateAgentDataSource(userId, req.params.sourceId, req.body ?? {});
      res.json(source);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error updating MCP source:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.delete("/api/agent/mcp-sources/:sourceId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (req.params.sourceId === "internal_mlb_mcp") {
        return res.status(400).json({ error: "Built-in data sources cannot be removed." });
      }
      await deleteUserMcpSource(userId, req.params.sourceId);
      res.json({ success: true });
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Agent API] Error deleting MCP source:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/admin/agent/settings", adminAuth, async (_req, res) => {
    try {
      const settings = await getAgentSystemSettings();
      res.json(settings);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error fetching settings:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.patch("/api/admin/agent/settings", adminAuth, async (req, res) => {
    try {
      const settings = await updateAgentSystemSettings(req.body ?? {});
      res.json(settings);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error updating settings:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/admin/agent/providers/:provider/models", adminAuth, async (req, res) => {
    try {
      const providerKey = String(req.params.provider || "")
        .trim()
        .toLowerCase();
      if (!isManagedProviderKey(providerKey)) {
        return res.status(400).json({ error: "Invalid managed provider" });
      }

      const catalog = await getManagedProviderModelCatalog(providerKey);
      res.json(catalog);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error fetching provider models:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/admin/agent/question-logs", adminAuth, async (_req, res) => {
    try {
      const logs = await getAgentQuestionLogs();
      res.json(logs);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error fetching question logs:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.get("/api/admin/agent/skills", adminAuth, async (req, res) => {
    try {
      const rawScope = typeof req.query.scope === "string" ? req.query.scope.trim() : "";
      const rawStatus = typeof req.query.status === "string" ? req.query.status.trim() : "";
      const scope =
        rawScope === "user" || rawScope === "global_candidate" || rawScope === "global_approved"
          ? rawScope
          : undefined;
      const status =
        rawStatus === "active" ||
        rawStatus === "candidate" ||
        rawStatus === "approved" ||
        rawStatus === "archived" ||
        rawStatus === "rejected"
          ? rawStatus
          : undefined;
      const skills = await listAdminAgentSkills({
        scope,
        status,
      });
      res.json(skills);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error fetching skills:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/admin/agent/skills/:skillId/approve", adminAuth, async (req: any, res) => {
    try {
      const reviewedBy = await resolveAdminReviewerId(req);
      const skill = await approveAgentSkillCandidate({
        skillId: req.params.skillId,
        reviewedBy,
        notes: typeof req.body?.notes === "string" ? req.body.notes.trim() : null,
      });

      if (!skill) {
        return res.status(404).json({ error: "Skill candidate not found" });
      }

      res.json(skill);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error approving skill:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  app.post("/api/admin/agent/skills/:skillId/reject", adminAuth, async (req: any, res) => {
    try {
      const reviewedBy = await resolveAdminReviewerId(req);
      const skill = await rejectAgentSkillCandidate({
        skillId: req.params.skillId,
        reviewedBy,
        notes: typeof req.body?.notes === "string" ? req.body.notes.trim() : null,
      });

      if (!skill) {
        return res.status(404).json({ error: "Skill candidate not found" });
      }

      res.json(skill);
    } catch (error: any) {
      const message = normalizeAgentErrorMessage(error);
      console.error("[Admin Agent API] Error rejecting skill:", message);
      res.status(getAgentErrorStatus(error)).json({ error: message });
    }
  });

  // =====================
  // Global leaderboards (public) - cached and enriched with current-user context when available
  app.get("/api/leaderboards", optionalAuth, async (req, res) => {
    try {
      const category = normalizeLeaderboardCategory(
        typeof req.query.category === "string" ? req.query.category : null,
      );
      if (!category) {
        return res.status(400).json({ error: "Invalid category" });
      }

      const currentUserId =
        typeof (req as any).user?.claims?.sub === "string" ? (req as any).user.claims.sub : null;
      const cacheKey = `leaderboard:v2:${category}`;

      const result = await getOrCompute(
        cacheKey,
        async () => {
          const meta = getLeaderboardMeta(category);
          const allUsers = await storage.getUsers();
          const rankEntries = (
            entries: Array<Omit<LeaderboardEntry, "rank">>,
          ): LeaderboardEntry[] =>
            entries
              .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username))
              .map((entry, index) => ({
                ...entry,
                rank: index + 1,
                value: roundToTwo(entry.value),
              }));

          let leaderboard: LeaderboardEntry[] = [];

          if (category === "marketOrders") {
            leaderboard = rankEntries(
              allUsers.map((user) => ({
                userId: user.id,
                username: user.username || "Unknown",
                profileImageUrl: user.profileImageUrl || null,
                value: user.totalMarketOrders,
                rankChange: null,
              })),
            );
          } else if (category === "tradingVolume24h") {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const volumeByUser = await storage.getUserTradingVolumeSince(since);

            leaderboard = rankEntries(
              allUsers.map((user) => ({
                userId: user.id,
                username: user.username || "Unknown",
                profileImageUrl: user.profileImageUrl || null,
                value: volumeByUser.get(user.id) || 0,
                rankChange: null,
              })),
            );
          } else {
            const [usersForRanking, latestSnapshotRanks] = await Promise.all([
              storage.getAllUsersForRanking(),
              storage.getLatestSnapshotRanks(),
            ]);
            const userMap = new Map(allUsers.map((user) => [user.id, user]));

            leaderboard = rankEntries(
              usersForRanking.map((userData) => {
                const user = userMap.get(userData.userId);
                const snapshotRank = latestSnapshotRanks.get(userData.userId);
                const cashValue = toNumber(userData.balance);
                const portfolioValue = userData.portfolioValue;
                const netWorthValue = cashValue + portfolioValue;

                let value = netWorthValue;
                let previousRank = snapshotRank?.netWorthRank;

                if (category === "cashBalance") {
                  value = cashValue;
                  previousRank = snapshotRank?.cashRank;
                } else if (category === "portfolioValue") {
                  value = portfolioValue;
                  previousRank = snapshotRank?.portfolioRank;
                }

                return {
                  userId: userData.userId,
                  username: user?.username || "Unknown",
                  profileImageUrl: user?.profileImageUrl || null,
                  value,
                  rankChange: previousRank ?? null,
                };
              }),
            ).map((entry) => ({
              ...entry,
              rankChange: getLeaderboardRankChange(entry.rankChange, entry.rank),
            }));
          }

          return {
            category,
            categoryLabel: meta.label,
            description: meta.description,
            unit: meta.unit,
            updatedAt: new Date().toISOString(),
            totalEntries: leaderboard.length,
            leaderboard,
          };
        },
        30_000,
      );

      const currentUser =
        currentUserId !== null
          ? result.leaderboard.find((entry: LeaderboardEntry) => entry.userId === currentUserId) ||
            null
          : null;
      const currentUserWindow = buildLeaderboardWindow(result.leaderboard, currentUserId, 2);

      const payload = {
        ...result,
        currentUser,
        currentUserWindow,
      };

      if (!currentUserId) {
        return res.json(
          withPublicDataHeaders(res, payload, {
            maxAgeSeconds: 60,
            sharedMaxAgeSeconds: 60,
          }),
        );
      }

      res.json(payload);
    } catch (error: any) {
      console.error("[leaderboards] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Blog posts - public listing (published posts only)
  app.get("/api/blog", async (req, res) => {
    try {
      const { limit, offset } = req.query;
      const parsedLimit = limit ? parseInt(limit as string) : 20;
      const parsedOffset = offset ? parseInt(offset as string) : 0;

      const safeLimit = isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(parsedLimit, 100));
      const safeOffset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

      const { posts, total } = await storage.getBlogPosts({
        limit: safeLimit,
        offset: safeOffset,
        publishedOnly: true,
      });

      res.json({ posts, total, limit: safeLimit, offset: safeOffset });
    } catch (error: any) {
      console.error("[blog] Error fetching posts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI/retrieval-friendly public market summary.
  app.get("/api/public/market-summary", async (req, res) => {
    try {
      const parsedLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : 25;
      const safeLimit = Number.isNaN(parsedLimit) ? 25 : Math.max(1, Math.min(parsedLimit, 50));

      const topPlayers = await storage.getTopPlayersByVolume(safeLimit);
      const generatedAt = new Date();
      const mostRecentUpdate = topPlayers
        .map((player) => (player.lastUpdated ? new Date(player.lastUpdated) : null))
        .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const players = topPlayers.map((player) => ({
        id: player.id,
        name: `${player.firstName} ${player.lastName}`,
        team: player.team,
        sport: player.sport,
        price: player.lastTradePrice,
        volume24h: player.volume24h,
        marketCap: player.marketCap,
        lastUpdated: player.lastUpdated,
        canonicalUrl: `/player/${player.id}`,
      }));

      setPublicDataHeaders(res, {
        generatedAt,
        lastModifiedAt: mostRecentUpdate || generatedAt,
        maxAgeSeconds: 60,
        sharedMaxAgeSeconds: 120,
      });
      res.json({
        generatedAt: generatedAt.toISOString(),
        version: publicApiVersion,
        count: players.length,
        players,
      });
    } catch (error: any) {
      console.error("[public/market-summary] Error:", error);
      res.status(500).json({ error: "Failed to fetch market summary" });
    }
  });

  // AI/retrieval-friendly published blog listing.
  app.get("/api/public/blog", async (req, res) => {
    try {
      const parsedLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : 25;
      const parsedOffset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
      const safeLimit = Number.isNaN(parsedLimit) ? 25 : Math.max(1, Math.min(parsedLimit, 100));
      const safeOffset = Number.isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);
      const generatedAt = new Date();

      const { posts, total } = await storage.getBlogPosts({
        limit: safeLimit,
        offset: safeOffset,
        publishedOnly: true,
      });
      const mostRecentUpdate = posts
        .map((post) => new Date(post.updatedAt || post.publishedAt || post.createdAt))
        .filter((value) => !Number.isNaN(value.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      setPublicDataHeaders(res, {
        generatedAt,
        lastModifiedAt: mostRecentUpdate || generatedAt,
        maxAgeSeconds: 300,
        sharedMaxAgeSeconds: 600,
      });
      res.json({
        generatedAt: generatedAt.toISOString(),
        version: publicApiVersion,
        total,
        limit: safeLimit,
        offset: safeOffset,
        posts: posts.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          publishedAt: post.publishedAt,
          updatedAt: post.updatedAt,
          canonicalUrl: `/blog/${post.slug}`,
        })),
      });
    } catch (error: any) {
      console.error("[public/blog] Error:", error);
      res.status(500).json({ error: "Failed to fetch public blog feed" });
    }
  });

  // Blog post detail - public (by slug)
  app.get("/api/blog/:slug", async (req, res) => {
    try {
      const post = await storage.getBlogPostBySlug(req.params.slug);

      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      // Only return published posts to public
      if (!post.publishedAt) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      // Get author information
      const author = await storage.getUser(post.authorId);

      res.json({
        post,
        author: author
          ? {
              id: author.id,
              username: author.username,
              firstName: author.firstName,
              lastName: author.lastName,
              profileImageUrl: author.profileImageUrl,
            }
          : null,
      });
    } catch (error: any) {
      console.error("[blog] Error fetching post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: List all blog posts (including drafts)
  app.get("/api/admin/blog", adminAuth, async (req, res) => {
    try {
      const { limit, offset } = req.query;
      const parsedLimit = limit ? parseInt(limit as string) : 50;
      const parsedOffset = offset ? parseInt(offset as string) : 0;

      const safeLimit = isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));
      const safeOffset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

      const { posts, total } = await storage.getBlogPosts({
        limit: safeLimit,
        offset: safeOffset,
        publishedOnly: false, // Show drafts for admin
      });

      res.json({ posts, total, limit: safeLimit, offset: safeOffset });
    } catch (error: any) {
      console.error("[admin/blog] Error fetching posts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Create blog post
  app.post("/api/admin/blog", adminAuth, async (req, res) => {
    try {
      const userId = getUserId(req);

      // Validate request body
      const { title, slug, excerpt, content, publishedAt } = req.body;

      if (!title?.trim() || !slug?.trim() || !excerpt?.trim() || !content?.trim()) {
        return res
          .status(400)
          .json({ error: "title, slug, excerpt, and content are required and cannot be empty" });
      }

      // Validate slug format (alphanumeric and hyphens only)
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res
          .status(400)
          .json({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      const post = await storage.createBlogPost({
        title: title.trim(),
        slug: slug.trim(),
        excerpt: excerpt.trim(),
        content: content.trim(),
        authorId: userId,
        publishedAt: publishedAt ? new Date(publishedAt) : null,
      });

      res.json({ post });
    } catch (error: any) {
      console.error("[admin/blog] Error creating post:", error);

      // Handle duplicate slug error
      if ((error.message && error.message.includes("duplicate key")) || error.code === "23505") {
        return res.status(409).json({ error: "A blog post with this slug already exists" });
      }

      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Update blog post
  app.patch("/api/admin/blog/:id", adminAuth, async (req, res) => {
    try {
      const { title, slug, excerpt, content, publishedAt } = req.body;

      const updates: any = {};

      // Validate and trim provided fields
      if (title !== undefined) {
        if (!title.trim()) {
          return res.status(400).json({ error: "title cannot be empty" });
        }
        updates.title = title.trim();
      }

      if (slug !== undefined) {
        if (!slug.trim()) {
          return res.status(400).json({ error: "slug cannot be empty" });
        }
        // Validate slug format
        if (!/^[a-z0-9-]+$/.test(slug)) {
          return res
            .status(400)
            .json({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
        }
        updates.slug = slug.trim();
      }

      if (excerpt !== undefined) {
        if (!excerpt.trim()) {
          return res.status(400).json({ error: "excerpt cannot be empty" });
        }
        updates.excerpt = excerpt.trim();
      }

      if (content !== undefined) {
        if (!content.trim()) {
          return res.status(400).json({ error: "content cannot be empty" });
        }
        updates.content = content.trim();
      }

      if (publishedAt !== undefined) {
        updates.publishedAt = publishedAt ? new Date(publishedAt) : null;
      }

      updates.updatedAt = new Date();

      const post = await storage.updateBlogPost(req.params.id, updates);

      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      res.json({ post });
    } catch (error: any) {
      console.error("[admin/blog] Error updating post:", error);

      // Handle duplicate slug error
      if ((error.message && error.message.includes("duplicate key")) || error.code === "23505") {
        return res.status(409).json({ error: "A blog post with this slug already exists" });
      }

      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Delete blog post
  app.delete("/api/admin/blog/:id", adminAuth, async (req, res) => {
    try {
      await storage.deleteBlogPost(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[admin/blog] Error deleting post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Portfolio history with time range support
  app.get("/api/user/portfolio-history", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const timeRange = (req.query.timeRange as string) || "1M";

      // Calculate date range based on timeRange parameter
      const now = new Date();
      let startDate = new Date();

      switch (timeRange) {
        case "1D":
          startDate.setDate(now.getDate() - 1);
          break;
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "1M":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "ALL":
          // Set to a very early date to get all snapshots
          startDate = new Date(2020, 0, 1);
          break;
        default:
          return res.status(400).json({ error: "Invalid timeRange. Use: 1D, 7D, 1M, 1Y, or ALL" });
      }

      // Query snapshots from the database
      const snapshots = await storage.getPortfolioSnapshotsInRange(userId, startDate, now);

      // Transform snapshots into chart-friendly format with ISO string dates
      const history = snapshots.map((snapshot) => ({
        date: snapshot.snapshotDate.toISOString(),
        cashBalance: parseFloat(snapshot.cashBalance),
        portfolioValue: parseFloat(snapshot.portfolioValue),
        netWorth: parseFloat(snapshot.totalNetWorth),
        cashRank: snapshot.cashRank,
        portfolioRank: snapshot.portfolioRank,
      }));

      res.json({ history, timeRange });
    } catch (error: any) {
      console.error("[portfolio-history] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Public user profile (anyone can view)
  app.get("/api/user/:userId/profile", async (req, res) => {
    try {
      const requestedUserId = req.params.userId;

      // Dev mode bypass: create dev user if requesting the mock user and it doesn't exist
      const isDev = process.env.NODE_ENV === "development";
      if (isDev && requestedUserId === "dev-user-12345678") {
        const existingUser = await storage.getUser(requestedUserId);
        if (!existingUser) {
          await storage.upsertUser({
            id: requestedUserId,
            email: "dev@example.com",
            firstName: "Dev",
            lastName: "User",
            username: "dev_user",
          });
          console.log("[DEV_BYPASS] Auto-created dev user for profile fetch");
        }
      }

      const userState = await loadEffectiveUserState(requestedUserId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = userState.user;

      const now = new Date();
      const historyStart = new Date(now);
      historyStart.setDate(historyStart.getDate() - 45);

      const [
        userHoldings,
        allUsers,
        usersForRanking,
        latestSnapshotRanks,
        tradingVolume24hByUser,
        recentActivity,
        historySnapshots,
      ] = await Promise.all([
        storage.getUserHoldings(user.id),
        storage.getUsers(),
        storage.getAllUsersForRanking(),
        storage.getLatestSnapshotRanks(),
        storage.getUserTradingVolumeSince(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        storage.getUserActivity(user.id, {
          types: ["market", "scout"],
          limit: 12,
          includeBalanceAfter: false,
        }),
        storage.getPortfolioSnapshotsInRange(user.id, historyStart, now),
      ]);

      const playerIds = userHoldings
        .filter((holding) => holding.assetType === "player")
        .map((holding) => holding.assetId);
      const playersList = playerIds.length > 0 ? await storage.getPlayersByIds(playerIds) : [];
      const playersMap = new Map(playersList.map((player) => [player.id, player]));

      const enrichedHoldings = userHoldings
        .filter((holding) => holding.assetType === "player")
        .map((holding) => {
          const player = playersMap.get(holding.assetId);
          if (!player) {
            return null;
          }

          const quantity = toNumber(holding.quantity);
          const effectiveShares = toNumber(holding.effectiveShares || holding.quantity);
          const lastTradePrice = toNumber(player.lastTradePrice);
          const marketValue = roundToTwo(effectiveShares * lastTradePrice);
          const avgCostBasis = toNumber(holding.avgCostBasis);
          const totalCostBasis = effectiveShares * avgCostBasis;
          const pnl = roundToTwo(marketValue - totalCostBasis);
          const pnlPercent =
            totalCostBasis > 0
              ? roundToTwo(((marketValue - totalCostBasis) / totalCostBasis) * 100)
              : 0;

          return {
            id: holding.id,
            assetId: holding.assetId,
            quantity,
            effectiveShares,
            avgCostBasis: roundToTwo(avgCostBasis),
            lastTradePrice: roundToTwo(lastTradePrice),
            marketValue,
            pnl,
            pnlPercent,
            player,
          };
        })
        .filter((holding): holding is NonNullable<typeof holding> => Boolean(holding))
        .filter((holding) => holding.quantity > 0)
        .sort(
          (a, b) =>
            b.marketValue - a.marketValue || a.player.lastName.localeCompare(b.player.lastName),
        );

      const holdingsValue = roundToTwo(
        enrichedHoldings.reduce((sum, holding) => sum + holding.marketValue, 0),
      );
      const cashBalance = roundToTwo(toNumber(user.balance));
      const currentNetWorth = roundToTwo(cashBalance + holdingsValue);
      const tradingVolume24h = roundToTwo(tradingVolume24hByUser.get(user.id) || 0);

      const userNameById = new Map(
        allUsers.map((entry) => [entry.id, entry.username || "Unknown"]),
      );
      const buildRankMap = (
        rows: Array<{ userId: string; value: number; previousRank?: number | null }>,
      ) =>
        new Map(
          rows
            .sort(
              (a, b) =>
                b.value - a.value ||
                (userNameById.get(a.userId) || "").localeCompare(userNameById.get(b.userId) || ""),
            )
            .map((row, index) => {
              const rank = index + 1;
              return [
                row.userId,
                {
                  rank,
                  value: roundToTwo(row.value),
                  rankChange: getLeaderboardRankChange(row.previousRank ?? null, rank),
                },
              ] as const;
            }),
        );

      const netWorthRankMap = buildRankMap(
        usersForRanking.map((entry) => ({
          userId: entry.userId,
          value: toNumber(entry.balance) + entry.portfolioValue,
          previousRank: latestSnapshotRanks.get(entry.userId)?.netWorthRank,
        })),
      );
      const cashRankMap = buildRankMap(
        usersForRanking.map((entry) => ({
          userId: entry.userId,
          value: toNumber(entry.balance),
          previousRank: latestSnapshotRanks.get(entry.userId)?.cashRank,
        })),
      );
      const portfolioRankMap = buildRankMap(
        usersForRanking.map((entry) => ({
          userId: entry.userId,
          value: entry.portfolioValue,
          previousRank: latestSnapshotRanks.get(entry.userId)?.portfolioRank,
        })),
      );
      const tradingVolumeRankMap = buildRankMap(
        allUsers.map((entry) => ({
          userId: entry.id,
          value: tradingVolume24hByUser.get(entry.id) || 0,
        })),
      );
      const marketOrdersRankMap = buildRankMap(
        allUsers.map((entry) => ({
          userId: entry.id,
          value: entry.totalMarketOrders,
        })),
      );

      const currentCashRank = cashRankMap.get(user.id)?.rank ?? null;
      const currentPortfolioRank = portfolioRankMap.get(user.id)?.rank ?? null;
      const currentNetWorthRank = netWorthRankMap.get(user.id)?.rank ?? null;

      const performanceWindows = [1, 7, 30] as const;
      const performance = Object.fromEntries(
        performanceWindows.map((days) => {
          const target = new Date(now);
          target.setDate(target.getDate() - days);
          const baseline = [...historySnapshots]
            .reverse()
            .find((snapshot) => snapshot.snapshotDate.getTime() <= target.getTime());

          if (!baseline || currentNetWorthRank === null) {
            return [
              `change${days === 1 ? "24h" : `${days}d`}`,
              { amount: null, percent: null, rankChange: null },
            ] as const;
          }

          const baselineNetWorth = toNumber(baseline.totalNetWorth);
          const amount = roundToTwo(currentNetWorth - baselineNetWorth);
          const percent =
            baselineNetWorth > 0
              ? roundToTwo(((currentNetWorth - baselineNetWorth) / baselineNetWorth) * 100)
              : null;

          return [
            `change${days === 1 ? "24h" : `${days}d`}`,
            {
              amount,
              percent,
              rankChange:
                baseline.netWorthRank && baseline.netWorthRank > 0
                  ? baseline.netWorthRank - currentNetWorthRank
                  : null,
            },
          ] as const;
        }),
      );

      const chartWindowStart = new Date(now);
      chartWindowStart.setDate(chartWindowStart.getDate() - 30);
      const historyPoints = historySnapshots
        .filter((snapshot) => snapshot.snapshotDate.getTime() >= chartWindowStart.getTime())
        .map((snapshot) => ({
          date: snapshot.snapshotDate.toISOString(),
          cashBalance: roundToTwo(toNumber(snapshot.cashBalance)),
          portfolioValue: roundToTwo(toNumber(snapshot.portfolioValue)),
          netWorth: roundToTwo(toNumber(snapshot.totalNetWorth)),
          cashRank: snapshot.cashRank,
          portfolioRank: snapshot.portfolioRank,
          netWorthRank: snapshot.netWorthRank,
        }));

      historyPoints.push({
        date: now.toISOString(),
        cashBalance,
        portfolioValue: holdingsValue,
        netWorth: currentNetWorth,
        cashRank: currentCashRank,
        portfolioRank: currentPortfolioRank,
        netWorthRank: currentNetWorthRank,
      });

      const sportExposureMap = new Map<string, number>();
      for (const holding of enrichedHoldings) {
        const sport = holding.player.sport || "Unknown";
        sportExposureMap.set(sport, (sportExposureMap.get(sport) || 0) + holding.marketValue);
      }

      const sportExposure = Array.from(sportExposureMap.entries())
        .map(([sport, value]) => ({
          sport,
          value: roundToTwo(value),
          percentage: holdingsValue > 0 ? roundToTwo((value / holdingsValue) * 100) : 0,
        }))
        .sort((a, b) => b.value - a.value);

      const holdingsWithShare = enrichedHoldings.map((holding) => ({
        ...holding,
        shareOfPortfolio:
          holdingsValue > 0 ? roundToTwo((holding.marketValue / holdingsValue) * 100) : 0,
      }));

      const rankingCategories: LeaderboardCategory[] = [
        "netWorth",
        "cashBalance",
        "portfolioValue",
        "tradingVolume24h",
        "marketOrders",
      ];

      const rankingSources = {
        netWorth: netWorthRankMap,
        cashBalance: cashRankMap,
        portfolioValue: portfolioRankMap,
        tradingVolume24h: tradingVolumeRankMap,
        marketOrders: marketOrdersRankMap,
      };

      const rankings = Object.fromEntries(
        rankingCategories.map((category) => {
          const ranking = rankingSources[category].get(user.id) || {
            rank: null,
            value: 0,
            rankChange: null,
          };
          const meta = getLeaderboardMeta(category);
          return [
            category,
            {
              category,
              label: meta.label,
              rank: ranking.rank,
              value: ranking.value,
              rankChange: ranking.rankChange,
            },
          ] as const;
        }),
      );

      res.json({
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          isAdmin: user.isAdmin || false,
          isPremium: userState.entitlements.premiumActive,
          premiumActive: userState.entitlements.premiumActive,
          rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
          rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
          maxScouts: userState.entitlements.maxScouts,
          createdAt: user.createdAt,
        },
        updatedAt: now.toISOString(),
        stats: {
          netWorth: currentNetWorth,
          cashBalance,
          portfolioValue: holdingsValue,
          tradingVolume24h,
          totalMarketOrders: user.totalMarketOrders,
          totalTradesExecuted: user.totalTradesExecuted,
          holdingsCount: holdingsWithShare.length,
          activeSports: sportExposure.length,
        },
        rankings,
        performance,
        history: {
          timeRange: "30D",
          points: historyPoints,
        },
        holdingsSummary: {
          topHoldings: holdingsWithShare.slice(0, 5),
          sportExposure,
        },
        activity: recentActivity,
        holdings: holdingsWithShare,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Premium redeem
  app.post("/api/premium/redeem", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await redeemPremiumShare(userId);

      void sendUserNotification({
        userId,
        category: "billing_premium",
        title: "Premium Share Redeemed",
        body: "Your premium share redemption has been processed.",
        deepLink: "/premium",
        dedupeKey: `premium_redeem:${new Date().toISOString().slice(0, 16)}`,
      }).catch((error) => {
        console.error("[Premium] Failed to send redemption push:", error);
      });

      res.json(result);
    } catch (error: any) {
      const status =
        error?.message === "User not found"
          ? 404
          : error?.message === "No premium shares to redeem"
            ? 400
            : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // Android Google Play Billing verification and premium crediting
  app.post("/api/mobile/google-play/verify-purchase", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const purchaseToken = String(req.body?.purchaseToken || "").trim();
      const requestedProductId = String(req.body?.productId || "").trim();
      const packageName = (process.env.GOOGLE_PLAY_PACKAGE_NAME || "sportfolio.market").trim();

      if (!purchaseToken) {
        return res.status(400).json({ error: "purchaseToken is required" });
      }

      const allowedProductIds = getAllowedGooglePlayPremiumProductIds();
      if (allowedProductIds.length === 0) {
        return res.status(500).json({
          error: "Google Play premium product IDs are not configured",
        });
      }

      const productId = requestedProductId || allowedProductIds[0];
      if (!allowedProductIds.includes(productId)) {
        return res.status(400).json({ error: "Unsupported Google Play productId" });
      }

      const purchase = await fetchGooglePlayProductPurchase({
        packageName,
        productId,
        purchaseToken,
      });

      const purchaseState =
        purchase?.purchaseState === undefined || purchase?.purchaseState === null
          ? null
          : Number(purchase.purchaseState);
      const acknowledgementState =
        purchase?.acknowledgementState === undefined || purchase?.acknowledgementState === null
          ? null
          : Number(purchase.acknowledgementState);
      const consumptionState =
        purchase?.consumptionState === undefined || purchase?.consumptionState === null
          ? null
          : Number(purchase.consumptionState);
      const purchaseTime =
        purchase?.purchaseTimeMillis && Number.isFinite(Number(purchase.purchaseTimeMillis))
          ? new Date(Number(purchase.purchaseTimeMillis))
          : null;
      const quantity = Math.max(1, Math.min(100, Number(purchase?.quantity) || 1));
      const orderId = typeof purchase?.orderId === "string" ? purchase.orderId : null;
      const isTestPurchase = Number(purchase?.purchaseType) === 0;

      const obfuscatedExternalAccountId = purchase?.obfuscatedExternalAccountId;
      if (
        obfuscatedExternalAccountId &&
        typeof obfuscatedExternalAccountId === "string" &&
        obfuscatedExternalAccountId !== userId
      ) {
        return res.status(409).json({
          error: "Purchase token is bound to a different account",
          state: "account_mismatch",
        });
      }

      if (purchaseState === 1) {
        return res.status(409).json({
          error: "Purchase is canceled",
          state: "canceled",
          purchaseState,
        });
      }

      if (purchaseState !== 0) {
        return res.status(202).json({
          success: false,
          state: "pending",
          purchaseState,
          acknowledgementState,
          consumptionState,
        });
      }

      const creditResult = await db.transaction(async (tx) => {
        const now = new Date();

        await tx
          .insert(googlePlayPurchases)
          .values({
            purchaseToken,
            orderId,
            userId,
            productId,
            packageName,
            quantity,
            purchaseState,
            acknowledgementState,
            consumptionState,
            purchaseTime,
            isTestPurchase,
            lastVerifiedAt: now,
            rawPayload: purchase,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: googlePlayPurchases.purchaseToken,
            set: {
              orderId,
              productId,
              packageName,
              quantity,
              purchaseState,
              acknowledgementState,
              consumptionState,
              purchaseTime,
              isTestPurchase,
              lastVerifiedAt: now,
              rawPayload: purchase,
              updatedAt: now,
            },
          });

        const [existingPurchase] = await tx
          .select()
          .from(googlePlayPurchases)
          .where(eq(googlePlayPurchases.purchaseToken, purchaseToken))
          .limit(1);

        if (!existingPurchase) {
          throw new Error("Failed to load Google Play purchase row after upsert");
        }

        if (existingPurchase.creditedAt) {
          return {
            credited: false,
            alreadyCredited: true,
            creditedUserId: existingPurchase.userId,
          };
        }

        const [claim] = await tx
          .update(googlePlayPurchases)
          .set({
            userId,
            creditedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(googlePlayPurchases.purchaseToken, purchaseToken),
              sql`${googlePlayPurchases.creditedAt} IS NULL`,
            ),
          )
          .returning();

        if (!claim) {
          const [claimedRow] = await tx
            .select()
            .from(googlePlayPurchases)
            .where(eq(googlePlayPurchases.purchaseToken, purchaseToken))
            .limit(1);
          return {
            credited: false,
            alreadyCredited: true,
            creditedUserId: claimedRow?.userId || null,
          };
        }

        const [existingHolding] = await tx
          .select()
          .from(holdings)
          .where(
            and(
              eq(holdings.userId, userId),
              eq(holdings.assetType, "premium"),
              eq(holdings.assetId, "premium"),
            ),
          );

        const currentQuantity = parseFloat(existingHolding?.quantity || "0");
        const newQuantity = currentQuantity + quantity;
        const avgCostBasis = existingHolding?.avgCostBasis || "5.0000";
        const totalCostBasis = (parseFloat(avgCostBasis) * newQuantity).toFixed(2);

        if (existingHolding) {
          await tx
            .update(holdings)
            .set({
              quantity: newQuantity.toString(),
              avgCostBasis,
              totalCostBasis,
              lastUpdated: now,
            })
            .where(eq(holdings.id, existingHolding.id));
        } else {
          await tx.insert(holdings).values({
            userId,
            assetType: "premium",
            assetId: "premium",
            quantity: newQuantity.toString(),
            avgCostBasis,
            totalCostBasis,
            lastUpdated: now,
          });
        }

        return {
          credited: true,
          alreadyCredited: false,
          creditedUserId: userId,
        };
      });

      if (creditResult.alreadyCredited && creditResult.creditedUserId !== userId) {
        return res.status(409).json({
          error: "Purchase token was already credited to a different user",
          state: "credited_to_other_user",
        });
      }

      let consumed = false;
      let consumePending = false;

      if (consumptionState !== 1) {
        try {
          await consumeGooglePlayProductPurchase({
            packageName,
            productId,
            purchaseToken,
          });
          consumed = true;

          await db
            .update(googlePlayPurchases)
            .set({
              consumptionState: 1,
              consumedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(googlePlayPurchases.purchaseToken, purchaseToken));
        } catch (consumeError: any) {
          consumePending = true;
          console.warn(
            "[GOOGLE_PLAY] Purchase consumed failed; will retry on future sync:",
            consumeError?.message || consumeError,
          );
        }
      } else {
        consumed = true;
      }

      if (creditResult.credited) {
        await recordPremiumActivityEvent({
          userId,
          eventType: "premium_credit",
          quantityDelta: quantity,
          referenceId: `play:${purchaseToken}`,
          metadata: {
            source: "google_play_billing",
            productId,
            packageName,
            purchaseToken,
            orderId,
            isTestPurchase,
            acknowledged: acknowledgementState === 1,
            consumed,
          },
        });

        broadcast({ type: "portfolio" });

        void sendUserNotification({
          userId,
          category: "billing_premium",
          title: "Premium Purchase Confirmed",
          body: `Added ${quantity} premium share${quantity === 1 ? "" : "s"} to your account.`,
          deepLink: "/premium",
          data: {
            quantity: String(quantity),
            productId,
            orderId: orderId || "",
          },
          dedupeKey: `play_billing:${purchaseToken}`,
        }).catch((error) => {
          console.error("[GOOGLE_PLAY] Failed to send premium push:", error);
        });
      }

      const premiumHolding = await storage.getHolding(userId, "premium", "premium");
      const premiumShares = Number(premiumHolding?.quantity || 0);

      return res.json({
        success: true,
        state: "purchased",
        credited: creditResult.credited,
        alreadyCredited: creditResult.alreadyCredited,
        premiumShares,
        quantity,
        productId,
        orderId,
        consumed,
        consumePending,
      });
    } catch (error: any) {
      console.error("[GOOGLE_PLAY] Verify purchase error:", error);
      return res.status(500).json({ error: error.message || "Could not verify purchase" });
    }
  });

  // Premium checkout - create a checkout session and redirect to Whop
  // Prefer checkout configurations so we can attach redirect + metadata safely.
  // For multi-quantity purchases we create an inline plan with the aggregated price.
  app.post("/api/premium/checkout-session", isAuthenticated, async (req, res) => {
    try {
      if (isNativeIOSRequest(req)) {
        return res.status(403).json({
          code: "ios_purchase_disabled",
          error:
            "Premium purchases are temporarily unavailable in the iOS app while Apple in-app purchase rollout is in progress.",
        });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { quantity = 1 } = req.body;
      const planId = process.env.WHOP_PLAN_ID;
      const whopApiKey = process.env.WHOP_API_KEY;
      const whopCompanyId = process.env.WHOP_COMPANY_ID;

      if (!planId) {
        return res.status(500).json({ error: "Whop plan ID not configured" });
      }

      const parsedQuantity = Math.max(1, Math.min(100, Number(quantity) || 1));

      const PRICE_PER_SHARE_CENTS = 500; // $5.00 per premium share
      const amountCents = parsedQuantity * PRICE_PER_SHARE_CENTS;

      // Create a local checkout session record to track this purchase
      const localSession = await storage.createPremiumCheckoutSession({
        userId: user.id,
        planId,
        quantity: parsedQuantity,
        amountCents,
      });

      console.log(
        `[WHOP] Created premium checkout session ${localSession.id} for user ${userId}, qty: ${parsedQuantity}`,
      );

      const buildReturnUrl = () => {
        const forwardedProto = (req.headers["x-forwarded-proto"] as string) || "https";
        const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.headers.host;
        const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
        const host = rawHost === "sportfolio.market" ? "www.sportfolio.market" : rawHost;
        return `${forwardedProto}://${host}/checkout/success`;
      };

      const returnUrl = process.env.WHOP_RETURN_URL || buildReturnUrl();

      let purchaseUrl: string;
      if (whopApiKey) {
        const { Whop } = await import("@whop/sdk");
        const whopsdk = new Whop({ apiKey: whopApiKey });

        if (parsedQuantity === 1) {
          const cfg = await whopsdk.checkoutConfigurations.create({
            plan_id: planId,
            redirect_url: returnUrl,
            metadata: {
              sessionId: localSession.id,
              userId,
              quantity: parsedQuantity,
            },
          });
          purchaseUrl = cfg.purchase_url;
        } else {
          const basePlan = await whopsdk.plans.retrieve(planId);
          const companyId = whopCompanyId || basePlan.company?.id;
          const productId = basePlan.product?.id;
          const currency = (basePlan.currency || "usd") as any;

          if (!companyId || !productId) {
            throw new Error(
              "Whop base plan is missing company/product; cannot build multi-quantity checkout",
            );
          }

          const cfg = await whopsdk.checkoutConfigurations.create({
            plan: {
              company_id: companyId as string,
              currency,
              product_id: productId as string,
              plan_type: "one_time",
              initial_price: amountCents / 100,
              title: `Premium Shares x${parsedQuantity}`,
              visibility: "hidden",
            },
            redirect_url: returnUrl,
            metadata: {
              sessionId: localSession.id,
              userId,
              quantity: parsedQuantity,
            },
          });
          purchaseUrl = cfg.purchase_url;
        }
      } else {
        // Fallback: direct checkout URL (metadata-only). Note: hosted checkout links do not support variable pricing.
        purchaseUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${localSession.id}&metadata[userId]=${userId}&metadata[quantity]=${parsedQuantity}`;
      }

      res.json({
        sessionId: localSession.id,
        purchaseUrl,
        planId,
        quantity: parsedQuantity,
        amountCents,
        email: user.email,
      });
    } catch (error: any) {
      console.error("[WHOP] Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Community shares checkout - create a checkout session and redirect to Whop
  // Community shares are used to create community boosts (+1x multiplier for all holders)
  app.post("/api/community/checkout-session", isAuthenticated, async (req, res) => {
    try {
      if (isNativeIOSRequest(req)) {
        return res.status(403).json({
          code: "ios_purchase_disabled",
          error:
            "Community Share purchases are temporarily unavailable in the iOS app while Apple in-app purchase rollout is in progress.",
        });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { quantity = 1 } = req.body;
      const planId = process.env.WHOP_COMMUNITY_PLAN_ID;
      const whopApiKey = process.env.WHOP_API_KEY;
      const whopCompanyId = process.env.WHOP_COMPANY_ID;

      if (!planId) {
        return res.status(500).json({ error: "Whop community plan ID not configured" });
      }

      const parsedQuantity = Math.max(1, Math.min(100, Number(quantity) || 1));

      const PRICE_PER_SHARE_CENTS = 100; // $1.00 per community share
      const amountCents = parsedQuantity * PRICE_PER_SHARE_CENTS;

      // Create a local checkout session record to track this purchase
      const localSession = await storage.createCommunityCheckoutSession({
        userId: user.id,
        planId,
        quantity: parsedQuantity,
        amountCents,
      });

      console.log(
        `[COMMUNITY] Created checkout session ${localSession.id} for user ${userId}, qty: ${parsedQuantity}`,
      );

      const buildReturnUrl = () => {
        const forwardedProto = (req.headers["x-forwarded-proto"] as string) || "https";
        const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.headers.host;
        const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
        const host = rawHost === "sportfolio.market" ? "www.sportfolio.market" : rawHost;
        return `${forwardedProto}://${host}/checkout/success`;
      };

      const returnUrl = process.env.WHOP_RETURN_URL || buildReturnUrl();

      let purchaseUrl: string;
      if (whopApiKey) {
        const { Whop } = await import("@whop/sdk");
        const whopsdk = new Whop({ apiKey: whopApiKey });

        if (parsedQuantity === 1) {
          const cfg = await whopsdk.checkoutConfigurations.create({
            plan_id: planId,
            redirect_url: returnUrl,
            metadata: {
              sessionId: localSession.id,
              userId,
              quantity: parsedQuantity,
            },
          });
          purchaseUrl = cfg.purchase_url;
        } else {
          const basePlan = await whopsdk.plans.retrieve(planId);
          const companyId = whopCompanyId || basePlan.company?.id;
          const productId = basePlan.product?.id;
          const currency = (basePlan.currency || "usd") as any;

          if (!companyId || !productId) {
            throw new Error(
              "Whop base plan is missing company/product; cannot build multi-quantity checkout",
            );
          }

          const cfg = await whopsdk.checkoutConfigurations.create({
            plan: {
              company_id: companyId as string,
              currency,
              product_id: productId as string,
              plan_type: "one_time",
              initial_price: amountCents / 100,
              title: `Community Shares x${parsedQuantity}`,
              visibility: "hidden",
            },
            redirect_url: returnUrl,
            metadata: {
              sessionId: localSession.id,
              userId,
              quantity: parsedQuantity,
            },
          });
          purchaseUrl = cfg.purchase_url;
        }
      } else {
        // Fallback: direct checkout URL (metadata-only). Note: hosted checkout links do not support variable pricing.
        purchaseUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${localSession.id}&metadata[userId]=${userId}&metadata[quantity]=${parsedQuantity}`;
      }

      res.json({
        sessionId: localSession.id,
        purchaseUrl,
        planId,
        quantity: parsedQuantity,
        amountCents,
        email: user.email,
      });
    } catch (error: any) {
      console.error("[COMMUNITY] Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Checkout success finalization - deterministic/idempotent reconciliation for authenticated user
  app.post("/api/checkout/finalize", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const receiptId = req.body?.receipt_id || req.body?.payment_id;

      if (!receiptId || typeof receiptId !== "string") {
        return res.status(400).json({ error: "receipt_id (or payment_id) is required" });
      }

      const payment = await storage.getWhopPaymentByPaymentId(receiptId);
      if (!payment) {
        return res
          .status(202)
          .json({ success: false, state: "pending", reason: "payment_not_synced" });
      }

      if (payment.creditedAt) {
        if (payment.userId && payment.userId !== userId) {
          return res
            .status(409)
            .json({ success: false, state: "error", reason: "credited_to_other_user" });
        }
        return res.json({
          success: true,
          state: "credited",
          alreadyCredited: true,
          quantity: payment.quantity,
        });
      }

      const raw: any = payment.rawPayload || {};
      const extracted = extractWhopPaymentFields(raw);
      const metadata = extracted.metadata || {};
      const classification = classifyWhopPurchase(
        extracted.planId,
        payment.amountCents || extracted.amountCents,
      );
      if (!classification.assetType) {
        return res
          .status(202)
          .json({ success: false, state: "unresolved", reason: classification.reason });
      }

      const matched = await findDeterministicSessionMatch(
        classification.assetType,
        metadata,
        receiptId,
        payment.email,
        extracted.planId,
      );
      if (!matched || matched.session.userId !== userId) {
        return res
          .status(202)
          .json({ success: false, state: "unresolved", reason: "deterministic_mapping_missing" });
      }

      // Safety: ensure the paid amount matches the session we are about to fulfill.
      const paidAmountCents = payment.amountCents || extracted.amountCents;
      const expectedAmountCents = matched.session.amountCents;
      // Allow paid > expected (taxes/fees). Block underpayment.
      if (expectedAmountCents && paidAmountCents && paidAmountCents < expectedAmountCents) {
        console.warn("[CHECKOUT FINALIZE] Amount mismatch", {
          receiptId,
          userId,
          assetType: classification.assetType,
          expectedAmountCents,
          paidAmountCents,
          sessionId: matched.session.id,
        });
        return res.status(409).json({
          success: false,
          state: "error",
          reason: "underpaid",
          expectedAmountCents,
          paidAmountCents,
        });
      }

      const quantity =
        matched.session.quantity || payment.quantity || Number(metadata.quantity) || 1;
      const avgCost = classification.assetType === "community" ? "1.0000" : "5.0000";
      const creditResult = await creditPaymentAndHoldingAtomic(
        receiptId,
        userId,
        classification.assetType,
        quantity,
        avgCost,
      );

      if (!creditResult) {
        return res.json({ success: true, state: "credited", alreadyCredited: true, quantity });
      }

      if (matched.type === "community" && matched.session.status !== "completed") {
        await storage.completeCommunityCheckoutSession(matched.session.id, receiptId);
      }
      if (matched.type === "premium" && matched.session.status !== "completed") {
        await storage.completePremiumCheckoutSession(matched.session.id, receiptId);
      }

      if (classification.assetType === "premium") {
        await recordPremiumActivityEvent({
          userId,
          eventType: "premium_credit",
          quantityDelta: quantity,
          amountCents:
            paidAmountCents || expectedAmountCents || matched.session.amountCents || undefined,
          referenceId: receiptId,
          metadata: {
            source: "checkout_finalize",
            receiptId,
            sessionId: matched.session.id,
          },
        });

        void sendUserNotification({
          userId,
          category: "billing_premium",
          title: "Premium Purchase Confirmed",
          body: `Added ${quantity} premium share${quantity === 1 ? "" : "s"} to your account.`,
          deepLink: "/premium",
          data: {
            quantity: String(quantity),
            receiptId,
            sessionId: matched.session.id,
          },
          dedupeKey: `checkout_finalize:${receiptId}`,
        }).catch((error) => {
          console.error("[CHECKOUT FINALIZE] Failed to send premium push:", error);
        });
      }

      broadcast({ type: "portfolio" });
      return res.json({
        success: true,
        state: "credited",
        quantity,
        newBalance: creditResult.newQuantity,
      });
    } catch (error: any) {
      console.error("[CHECKOUT FINALIZE] Error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // Dev endpoint to grant premium shares for testing (only in development)
  app.post("/api/dev/grant-premium-shares", async (req, res) => {
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev) {
      return res.status(403).json({ error: "This endpoint is only available in development" });
    }

    try {
      const { userId, quantity = 1 } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const parsedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));

      // Grant premium shares
      const existingHolding = await storage.getHolding(userId, "premium", "premium");
      const currentQuantity = parseFloat(existingHolding?.quantity || "0");
      const newQuantity = currentQuantity + parsedQuantity;

      await storage.updateHolding(userId, "premium", "premium", newQuantity, "5.0000");

      await recordPremiumActivityEvent({
        userId,
        eventType: "premium_admin_credit",
        quantityDelta: parsedQuantity,
        metadata: {
          source: "dev_grant_premium_shares",
          reason: "Development premium grant",
        },
      });

      console.log(
        `[DEV] Granted ${parsedQuantity} premium shares to user ${userId}. Total: ${newQuantity}`,
      );

      res.json({
        success: true,
        userId,
        quantity: parsedQuantity,
        totalShares: newQuantity,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get premium status and shares
  app.get("/api/premium/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userState = await loadEffectiveUserState(userId);
      if (!userState) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = userState.user;

      const premiumHolding = await storage.getHolding(user.id, "premium", "premium");
      const recentSessions = await storage.getUserPremiumCheckoutSessions(user.id);

      res.json({
        isPremium: userState.entitlements.premiumActive,
        premiumActive: userState.entitlements.premiumActive,
        premiumExpiresAt: userState.entitlements.premiumExpiresAt,
        premiumShares: premiumHolding?.quantity || 0,
        rewardedScoutBoostActive: userState.entitlements.rewardedScoutBoostActive,
        rewardedScoutBoostExpiresAt: userState.entitlements.rewardedScoutBoostExpiresAt,
        maxScouts: userState.entitlements.maxScouts,
        recentPurchases: recentSessions.filter((s) => s.status === "completed").slice(0, 5),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get premium share market data with price history and circulation
  // CRITICAL: Only returns actual trade data - never fabricates prices
  app.get("/api/premium/market-data", async (req, res) => {
    try {
      const period = (req.query.period as string) || "1M";

      // Calculate time range based on period
      let startDate: Date;
      const now = new Date();
      switch (period) {
        case "1D":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "1W":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "1M":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "3M":
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "ALL":
        default:
          startDate = new Date("2020-01-01");
          break;
      }

      // Get premium trades within the time range
      const trades = await storage.getPremiumTradesInRange(startDate, now);

      // Get total circulation (sum of all premium holdings) - ensure it's a number
      const circulationRaw = await storage.getTotalPremiumCirculation();
      const circulation =
        typeof circulationRaw === "string" ? parseInt(circulationRaw, 10) : circulationRaw || 0;

      // Get last trade price (market value is ONLY the most recent trade)
      const lastTrade = trades.length > 0 ? trades[0] : null;
      const lastTradePrice = lastTrade ? parseFloat(lastTrade.price) : null;

      // Build price history from actual trades only
      const priceHistory = trades
        .map((trade) => ({
          timestamp: trade.executedAt,
          price: parseFloat(trade.price),
          volume: trade.quantity,
        }))
        .reverse(); // Oldest first for charting

      res.json({
        // Only show prices that are based on actual data - all numbers, no strings
        lastTradePrice, // null if no trades, number otherwise
        circulation,
        priceHistory,
        totalTrades: trades.length,
        period,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Whop webhook handler - receives payment.succeeded events
  // Uses official @whop/sdk for signature verification
  // NOTE: We use req.rawBody captured by express.json verify callback in index.ts
  // This ensures we get the original raw body before JSON parsing
  app.post("/api/webhooks/whop", async (req, res) => {
    try {
      const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;

      // Use rawBody captured by express.json verify callback (see index.ts)
      // This is the actual raw body string needed for signature verification
      const rawBodyBuffer = (req as any).rawBody;
      const rawBody = Buffer.isBuffer(rawBodyBuffer)
        ? rawBodyBuffer.toString("utf8")
        : String(rawBodyBuffer || "");

      // Log that we received a request (helps diagnose if webhook is reaching us)
      console.log("[WHOP WEBHOOK] ========== INCOMING REQUEST ==========");
      console.log("[WHOP WEBHOOK] Timestamp:", new Date().toISOString());
      console.log("[WHOP WEBHOOK] Method:", req.method);
      console.log("[WHOP WEBHOOK] Content-Type:", req.headers["content-type"]);
      console.log("[WHOP WEBHOOK] Body length:", rawBody.length);
      console.log("[WHOP WEBHOOK] Has webhook-id header:", !!req.headers["webhook-id"]);
      console.log(
        "[WHOP WEBHOOK] Has webhook-timestamp header:",
        !!req.headers["webhook-timestamp"],
      );
      console.log(
        "[WHOP WEBHOOK] Has webhook-signature header:",
        !!req.headers["webhook-signature"],
      );
      console.log(
        "[WHOP WEBHOOK] Raw body preview:",
        rawBody.length > 200 ? rawBody.substring(0, 200) + "..." : rawBody,
      );

      if (!webhookSecret) {
        console.error("[WHOP WEBHOOK] WHOP_WEBHOOK_SECRET not configured");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }

      // Enhanced debugging - log all relevant info
      const webhookId = req.headers["webhook-id"] as string;
      const webhookTimestamp = req.headers["webhook-timestamp"] as string;
      const webhookSignature = req.headers["webhook-signature"] as string;

      console.log("[WHOP WEBHOOK] === VERIFICATION DEBUG ===");
      console.log("[WHOP WEBHOOK] webhook-id:", webhookId);
      console.log("[WHOP WEBHOOK] webhook-timestamp:", webhookTimestamp);
      console.log("[WHOP WEBHOOK] webhook-signature:", webhookSignature);
      console.log("[WHOP WEBHOOK] secret first 10 chars:", webhookSecret.substring(0, 10) + "...");
      console.log("[WHOP WEBHOOK] secret length:", webhookSecret.length);
      console.log("[WHOP WEBHOOK] body first 100 chars:", rawBody.substring(0, 100));

      // Convert Express headers to plain object for SDK (filter out undefined values)
      const headersObj: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headersObj[key] = Array.isArray(value) ? value[0] : value;
        }
      }

      let payload: any;
      let verificationSucceeded = false;

      // Standard Webhooks spec requires the secret to be base64 encoded with "whsec_" prefix removed
      // But Whop uses "ws_" prefix - let's try multiple formats
      const keyFormats = [
        { name: "base64-of-raw", key: Buffer.from(webhookSecret).toString("base64") },
        { name: "raw-secret", key: webhookSecret },
        {
          name: "base64-without-prefix",
          key: Buffer.from(webhookSecret.replace(/^ws_/, "")).toString("base64"),
        },
        { name: "raw-without-prefix", key: webhookSecret.replace(/^ws_/, "") },
      ];

      // Try using standardwebhooks library directly first for better error messages
      try {
        const { Webhook } = await import("standardwebhooks");

        for (const format of keyFormats) {
          try {
            const wh = new Webhook(format.key);
            // standardwebhooks expects specific header format
            const headers = {
              "webhook-id": webhookId,
              "webhook-timestamp": webhookTimestamp,
              "webhook-signature": webhookSignature,
            };
            wh.verify(rawBody, headers);
            payload = JSON.parse(rawBody);
            console.log(
              `[WHOP WEBHOOK] standardwebhooks verification SUCCESS with ${format.name}!`,
            );
            verificationSucceeded = true;
            break;
          } catch (err: any) {
            console.log(`[WHOP WEBHOOK] standardwebhooks ${format.name} failed:`, err.message);
          }
        }
      } catch (importErr: any) {
        console.log("[WHOP WEBHOOK] Could not import standardwebhooks:", importErr.message);
      }

      // If standardwebhooks didn't work, try Whop SDK
      if (!verificationSucceeded) {
        const { Whop } = await import("@whop/sdk");

        for (const format of keyFormats) {
          try {
            const whopsdk = new Whop({
              apiKey: process.env.WHOP_API_KEY,
              webhookKey: format.key,
            });

            payload = whopsdk.webhooks.unwrap(rawBody, { headers: headersObj });
            console.log(
              `[WHOP WEBHOOK] SDK verification SUCCESS with ${format.name}! Event type:`,
              payload.type,
            );
            verificationSucceeded = true;
            break;
          } catch (err: any) {
            console.log(`[WHOP WEBHOOK] SDK ${format.name} failed:`, err.message);
          }
        }
      }

      if (!verificationSucceeded) {
        console.error("[WHOP WEBHOOK] === ALL VERIFICATION ATTEMPTS FAILED ===");
        console.error("[WHOP WEBHOOK] This is likely a secret mismatch issue.");
        console.error(
          "[WHOP WEBHOOK] Please verify WHOP_WEBHOOK_SECRET matches the secret in Whop dashboard.",
        );

        // Return 401 immediately - do not process unverified payloads
        return res.status(401).json({ error: "Webhook signature verification failed" });
      }

      // Log the full payload structure for debugging
      console.log("[WHOP WEBHOOK] === PAYLOAD DEBUG ===");
      console.log("[WHOP WEBHOOK] Full payload keys:", Object.keys(payload));
      console.log("[WHOP WEBHOOK] payload.action:", payload.action);
      console.log("[WHOP WEBHOOK] payload.type:", payload.type);
      if (payload.data) {
        console.log("[WHOP WEBHOOK] payload.data keys:", Object.keys(payload.data));
        console.log("[WHOP WEBHOOK] payload.data.id:", payload.data.id);
        console.log("[WHOP WEBHOOK] payload.data.checkout_id:", payload.data.checkout_id);
        console.log("[WHOP WEBHOOK] payload.data.plan_id:", payload.data.plan_id);
        console.log("[WHOP WEBHOOK] payload.data.user_id:", payload.data.user_id);
        console.log("[WHOP WEBHOOK] payload.data.final_amount:", payload.data.final_amount);
        console.log("[WHOP WEBHOOK] payload.data.metadata:", JSON.stringify(payload.data.metadata));
      }

      // Whop uses "action" field, not "type" - check both for compatibility
      const eventAction = payload.action || payload.type;
      console.log("[WHOP WEBHOOK] Event action:", eventAction);

      // Handle payment.succeeded event
      if (eventAction === "payment.succeeded") {
        const payment = payload.data;
        const receiptId = payment.id;

        console.log("[WHOP WEBHOOK] Processing payment.succeeded for:", receiptId);

        // Check if payment already exists in whop_payments table
        const existingPayment = await storage.getWhopPaymentByPaymentId(receiptId);
        if (existingPayment?.creditedAt) {
          console.log("[WHOP WEBHOOK] Payment already credited:", receiptId);
          return res.json({ success: true, message: "Already credited" });
        }

        const extracted = extractWhopPaymentFields(payment);
        const metadata = extracted.metadata || {};
        const planId = extracted.planId;
        const amountCents = extracted.amountCents;

        const classification = classifyWhopPurchase(planId, amountCents);
        if (!classification.assetType) {
          console.error("[WHOP WEBHOOK] Unclassified purchase type; marked unresolved", {
            receiptId,
            planId,
            amountCents,
            reason: classification.reason,
          });

          await storage.upsertWhopPayment({
            paymentId: receiptId,
            email: (extracted.email || "unknown@webhook.local").toLowerCase(),
            userId: null,
            quantity: Number(metadata.quantity) || 1,
            amountCents: amountCents || 0,
            currency: payment.currency || "usd",
            whopStatus: "paid",
            rawPayload: payment,
          });

          return res
            .status(200)
            .json({ success: false, state: "unresolved", reason: classification.reason });
        }

        const assetType = classification.assetType;
        const matched = await findDeterministicSessionMatch(
          assetType,
          metadata,
          receiptId,
          extracted.email,
          planId,
        );
        if (!matched) {
          console.error("[WHOP WEBHOOK] Deterministic mapping failed; marking unresolved", {
            receiptId,
            assetType,
          });
          await storage.upsertWhopPayment({
            paymentId: receiptId,
            email: (extracted.email || "unknown@webhook.local").toLowerCase(),
            userId: null,
            quantity: Number(metadata.quantity) || 1,
            amountCents: amountCents || 0,
            currency: payment.currency || "usd",
            whopStatus: "paid",
            rawPayload: payment,
          });
          return res
            .status(200)
            .json({ success: false, state: "unresolved", reason: "deterministic_mapping_missing" });
        }

        const userId = matched.session.userId;
        const quantity = matched.session.quantity || Number(metadata.quantity) || 1;

        // Safety: do not fulfill a session unless the paid amount matches the session amount.
        // This prevents over-crediting if metadata quantity is manipulated or checkout pricing isn't variable.
        const expectedAmountCents = matched.session.amountCents;
        // Allow paid > expected (taxes/fees). Block underpayment.
        if (expectedAmountCents && amountCents && amountCents < expectedAmountCents) {
          console.error("[WHOP WEBHOOK] Amount mismatch; not crediting", {
            receiptId,
            assetType,
            expectedAmountCents,
            amountCents,
            sessionId: matched.session.id,
          });

          await storage.upsertWhopPayment({
            paymentId: receiptId,
            email: (extracted.email || "unknown@webhook.local").toLowerCase(),
            userId: null,
            quantity,
            amountCents: amountCents || 0,
            currency: payment.currency || "usd",
            whopStatus: "paid",
            rawPayload: payment,
          });

          return res.status(200).json({ success: false, state: "unresolved", reason: "underpaid" });
        }

        const user = await storage.getUser(userId);
        const userEmail = user?.email || payment.user?.email || "unknown@webhook.local";

        await storage.upsertWhopPayment({
          paymentId: receiptId,
          email: userEmail,
          userId: null,
          quantity,
          amountCents: amountCents || quantity * (assetType === "community" ? 100 : 500),
          currency: payment.currency || "usd",
          whopStatus: "paid",
          rawPayload: payment,
        });

        const avgCost = assetType === "community" ? "1.0000" : "5.0000";
        const creditResult = await creditPaymentAndHoldingAtomic(
          receiptId,
          userId,
          assetType,
          quantity,
          avgCost,
        );

        if (!creditResult) {
          console.log(
            "[WHOP WEBHOOK] Payment already credited by another process, skipping:",
            receiptId,
          );
          return res.json({ success: true, message: "Already credited" });
        }

        if (matched.type === "community" && matched.session.status !== "completed") {
          await storage.completeCommunityCheckoutSession(matched.session.id, receiptId);
        }
        if (matched.type === "premium" && matched.session.status !== "completed") {
          await storage.completePremiumCheckoutSession(matched.session.id, receiptId);
        }

        if (assetType === "premium") {
          await recordPremiumActivityEvent({
            userId,
            eventType: "premium_credit",
            quantityDelta: quantity,
            amountCents: amountCents || expectedAmountCents || matched.session.amountCents,
            referenceId: receiptId,
            metadata: {
              source: "whop_webhook",
              receiptId,
              sessionId: matched.session.id,
            },
          });
        }

        const newQuantity = creditResult.newQuantity;
        console.log(
          `[WHOP WEBHOOK] Credited ${quantity} ${assetType} shares to user ${userId} (${creditResult.previousQuantity} -> ${newQuantity})`,
        );

        // Broadcast portfolio update via WebSocket
        broadcast({ type: "portfolio" });

        return res.json({ success: true, quantity, userId, newBalance: newQuantity });
      }

      // Other event types - just acknowledge
      console.log("[WHOP WEBHOOK] Unhandled event type:", eventAction);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[WHOP WEBHOOK] Error processing webhook:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin middleware - validates ADMIN_API_TOKEN (for external cron) OR isAdmin flag (for logged-in users)
  async function adminAuth(req: any, res: any, next: any) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const expectedToken = process.env.ADMIN_API_TOKEN;

    const setAdminContext = (
      method: "token" | "dev_bypass" | "supabase_jwt" | "session",
      ctx?: { userId?: string; email?: string },
    ) => {
      req.adminContext = {
        method,
        userId: ctx?.userId || null,
        email: ctx?.email || null,
        at: new Date().toISOString(),
      };
    };

    // Check 1: Token-based auth (for external cron jobs - using ADMIN_API_TOKEN)
    if (token && expectedToken && token === expectedToken) {
      setAdminContext("token");
      return next();
    }

    // Check 2: Dev mode bypass - allow all admin requests in development
    const isDev = process.env.NODE_ENV === "development";
    const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";

    if (isDev && bypassAuth) {
      console.log(`[ADMIN] Dev bypass: ${req.method} ${req.path}`);
      setAdminContext("dev_bypass");
      return next();
    }

    // Check 3: Verify Supabase JWT token and check isAdmin flag
    if (token) {
      try {
        // Import supabase admin client to verify JWT tokens
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseServiceRoleKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });

          const {
            data: { user: supabaseUser },
            error,
          } = await supabaseAdmin.auth.getUser(token);

          if (!error && supabaseUser) {
            // Token is valid, check if user is admin
            const user = await storage.getUser(supabaseUser.id);
            if (user?.isAdmin) {
              // Set req.user for downstream use
              req.user = {
                claims: {
                  sub: supabaseUser.id,
                  email: supabaseUser.email,
                },
              };
              setAdminContext("supabase_jwt", {
                userId: supabaseUser.id,
                email: supabaseUser.email || undefined,
              });
              console.log(
                `[ADMIN] Admin access granted for user ${supabaseUser.email} (${supabaseUser.id})`,
              );
              return next();
            } else {
              console.warn(
                `[ADMIN] User ${supabaseUser.email} is not an admin (isAdmin: ${user?.isAdmin})`,
              );
            }
          } else if (error) {
            console.log(`[ADMIN] Supabase token verification failed: ${error.message}`);
          }
        }
      } catch (error: any) {
        console.error("[ADMIN] Error verifying Supabase token:", error.message);
      }
    }

    // Check 4: Fallback - check if req.user is already set (from session or other middleware)
    try {
      let userId: string | null = null;

      if (req.user?.claims?.sub) {
        userId = req.user.claims.sub;
      } else if (req.user?.id) {
        userId = req.user.id;
      }

      if (userId) {
        const user = await storage.getUser(userId);
        if (user?.isAdmin) {
          setAdminContext("session", { userId, email: user.email || undefined });
          return next();
        }
      }
    } catch (error) {
      console.error("[ADMIN] Error checking admin status:", error);
    }

    const clientIp = req.ip || req.connection.remoteAddress;
    console.warn(`[ADMIN] Unauthorized access attempt from ${clientIp} to ${req.path}`);
    return res.status(401).json({ error: "Unauthorized - admin access required" });
  }

  // Admin endpoint: Get system statistics
  app.get("/api/admin/stats", adminAuth, async (req, res) => {
    try {
      const nowMs = Date.now();
      if (adminStatsCache && adminStatsCache.expiresAt > nowMs) {
        return res.json({
          ...adminStatsCache.payload,
          adminContext: (req as any).adminContext || null,
        });
      }

      // All scheduled job types in the system (from scheduler config)
      const jobTypes = jobScheduler.getConfiguredJobNames();
      const jobTypesSafe =
        jobTypes.length > 0
          ? jobTypes
          : [
              "roster_sync",
              "sync_player_game_logs",
              "schedule_sync",
              "stats_sync",
              "stats_sync_live",
              "daily_snapshot",
              "weekly_roundup",
              "refresh_player_metrics",
              "refresh_player_volume_24h",
              "api_health_check",
              "update_collections",
              "check_milestones",
              "cleanup_job_logs",
              "prune_price_history",
            ];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        userCountResult,
        playerCountResult,
        playersBySportResult,
        apiRequestsResult,
        latestJobLogs,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)::int` }).from(users),
        db.select({ count: sql<number>`COUNT(*)::int` }).from(players),
        db
          .select({
            sport: players.sport,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(players)
          .groupBy(players.sport),
        db
          .select({
            requestCount: sql<number>`COALESCE(SUM(${jobExecutionLogs.requestCount}), 0)::int`,
          })
          .from(jobExecutionLogs)
          .where(gte(jobExecutionLogs.scheduledFor, today)),
        storage.getLatestJobLogPerType(jobTypesSafe),
      ]);

      const userCount = userCountResult[0]?.count || 0;
      const playerCount = playerCountResult[0]?.count || 0;
      const apiRequestsToday = apiRequestsResult[0]?.requestCount || 0;
      const playersBySport: Record<string, number> = Object.fromEntries(
        SUPPORTED_SPORTS.map((sport) => [sport, 0]),
      );

      for (const row of playersBySportResult) {
        const normalizedSport = (row.sport || "").toUpperCase();
        if (!normalizedSport) {
          continue;
        }
        playersBySport[normalizedSport] = row.count || 0;
      }

      // Build last job runs from the per-type query results
      const lastJobRuns = jobTypesSafe.map((jobName) => {
        const lastLog = latestJobLogs.get(jobName);
        return {
          jobName,
          status: lastLog?.status || "never_run",
          finishedAt: lastLog?.finishedAt || null,
          recordsProcessed: lastLog?.recordsProcessed || 0,
          errorCount: lastLog?.errorCount || 0,
        };
      });

      const payload = {
        ok: true,
        totalUsers: userCount,
        totalPlayers: playerCount,
        playersBySport,
        apiRequestsToday,
        lastJobRuns,
        websocket: getWebSocketStats(),
        server: {
          now: new Date().toISOString(),
          uptimeSec: Math.round(process.uptime()),
        },
      };

      adminStatsCache = {
        expiresAt: nowMs + ADMIN_STATS_CACHE_TTL_MS,
        payload,
      };

      res.json({
        ...payload,
        adminContext: (req as any).adminContext || null,
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to get stats:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/api-health", adminAuth, async (req, res) => {
    try {
      const refresh = String(req.query.refresh || "false") === "true";
      let report = getLatestApiHealthReport();
      let inProgress = false;

      if (refresh || !report) {
        try {
          await jobScheduler.triggerJob("api_health_check");
        } catch (error: any) {
          if (error?.statusCode === 409) inProgress = true;
          else throw error;
        }
        report = getLatestApiHealthReport();
      }

      const staleThresholdMs = getApiHealthStaleThresholdMs();
      const recentRuns = await storage.getRecentJobLogs("api_health_check", 14);

      if (!report && inProgress) {
        return res.status(202).json({
          ok: true,
          inProgress: true,
          message: "API health check is already running",
          report: null,
          isStale: true,
          staleThresholdMs,
          recentRuns: recentRuns.map((run) => ({
            id: run.id,
            status: run.status,
            scheduledFor: run.scheduledFor,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            requestCount: run.requestCount,
            recordsProcessed: run.recordsProcessed,
            errorCount: run.errorCount,
            errorMessage: run.errorMessage || null,
          })),
          recentReports: getRecentApiHealthReports(5),
        });
      }

      if (!report) {
        report = await runApiHealthCheck({
          reason: refresh ? "admin_refresh_fallback" : "admin_initial_fetch",
        });
      }

      const checkedAtMs = report?.checkedAt ? Date.parse(report.checkedAt) : 0;
      const isStale = !checkedAtMs || Date.now() - checkedAtMs > staleThresholdMs;

      res.json({
        ok: true,
        inProgress,
        report,
        isStale,
        staleThresholdMs,
        recentRuns: recentRuns.map((run) => ({
          id: run.id,
          status: run.status,
          scheduledFor: run.scheduledFor,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          requestCount: run.requestCount,
          recordsProcessed: run.recordsProcessed,
          errorCount: run.errorCount,
          errorMessage: run.errorMessage || null,
        })),
        recentReports: getRecentApiHealthReports(5),
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to load API health report:", error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/api-health/run", adminAuth, async (_req, res) => {
    try {
      let jobResult: { requestCount: number; recordsProcessed: number; errorCount: number } | null =
        null;
      try {
        jobResult = await jobScheduler.triggerJob("api_health_check");
      } catch (error: any) {
        if (error?.statusCode === 409) {
          return res.status(409).json({ ok: false, error: error.message });
        }
        throw error;
      }

      const report =
        getLatestApiHealthReport() || (await runApiHealthCheck({ reason: "manual_run_fallback" }));
      const normalizedJobResult = toApiHealthJobResult(report);

      res.json({
        ok: report.status === "success",
        status: report.status,
        report,
        result: jobResult || normalizedJobResult,
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to run API health check:", error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Admin endpoint kept for compatibility; pool seeding is intentionally disabled.
  app.post("/api/admin/seed-missing-pools", adminAuth, async (req, res) => {
    try {
      const clientIp = req.ip || req.connection.remoteAddress;
      console.log(`[ADMIN] Seed missing pools requested by ${clientIp} (disabled endpoint)`);

      const missingPools = await db
        .select({ id: players.id })
        .from(players)
        .leftJoin(playerPools, eq(playerPools.playerId, players.id))
        .where(and(eq(players.isActive, true), sql`${playerPools.playerId} IS NULL`));

      const uninitializedCount = missingPools.length;
      const uninitializedPlayerIds = missingPools.map((entry) => entry.id);
      const normalizedPlayers =
        uninitializedPlayerIds.length === 0
          ? []
          : await db
              .update(players)
              .set({
                currentPrice: "0.00",
                lastTradePrice: null,
                marketCap: "0.00",
                volume24h: 0,
                priceChange24h: "0.00",
                lastUpdated: new Date(),
              })
              .where(inArray(players.id, uninitializedPlayerIds))
              .returning({ id: players.id });

      invalidateAdminStatsCache();

      res.status(200).json({
        ok: true,
        status: "disabled",
        message:
          "Pool seeding is disabled. Active players without pools now remain uninitialized at $0.00 until users add liquidity.",
        totalMissingPools: uninitializedCount,
        normalizedPlayers: normalizedPlayers.length,
        seededCount: 0,
        repairedCount: 0,
        failedCount: 0,
        failed: [],
        adminContext: (req as any).adminContext || null,
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to seed missing pools:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/migrate-nascar-player-ids", adminAuth, async (req, res) => {
    try {
      console.log("[ADMIN] Starting NASCAR player ID migration...");

      // Find all NASCAR players with old format
      const oldPlayers = await db
        .select()
        .from(players)
        .where(
          or(
            like(players.id, "nascar_NCS_%"),
            like(players.id, "nascar_NXS_%"),
            like(players.id, "nascar_NTS_%"),
          ),
        );

      console.log(`[ADMIN] Found ${oldPlayers.length} players with old format`);

      if (oldPlayers.length === 0) {
        return res.json({ ok: true, message: "No players to migrate" });
      }

      // Create ID mapping
      const idMapping: { oldId: string; newId: string }[] = [];
      for (const player of oldPlayers) {
        const match = player.id.match(/^nascar_(NCS|NXS|NTS)_(\d+)$/);
        if (match) {
          idMapping.push({
            oldId: player.id,
            newId: `nascar_${match[2]}`,
          });
        }
      }

      console.log(`[ADMIN] Created ${idMapping.length} ID mappings`);

      let statsUpdated = 0;
      let holdingsUpdated = 0;
      let boostsUpdated = 0;
      let payoutsUpdated = 0;
      let locksUpdated = 0;

      // Migrate each table
      for (const { oldId, newId } of idMapping) {
        // Players table
        await db.update(players).set({ id: newId }).where(eq(players.id, oldId));

        // Player game stats
        const statsResult = await db
          .update(playerGameStats)
          .set({ playerId: newId })
          .where(eq(playerGameStats.playerId, oldId));
        statsUpdated += statsResult.rowCount || 0;

        // Holdings
        const holdingsResult = await db
          .update(holdings)
          .set({ assetId: newId })
          .where(eq(holdings.assetId, oldId));
        holdingsUpdated += holdingsResult.rowCount || 0;

        // Daily boosts
        const boostsResult = await db
          .update(dailyBoosts)
          .set({ playerId: newId })
          .where(eq(dailyBoosts.playerId, oldId));
        boostsUpdated += boostsResult.rowCount || 0;

        // Share payouts
        const payoutsResult = await db
          .update(sharePayouts)
          .set({ playerId: newId })
          .where(eq(sharePayouts.playerId, oldId));
        payoutsUpdated += payoutsResult.rowCount || 0;

        // Holdings locks
        const locksResult = await db
          .update(holdingsLocks)
          .set({ assetId: newId })
          .where(eq(holdingsLocks.assetId, oldId));
        locksUpdated += locksResult.rowCount || 0;
      }

      const result = {
        ok: true,
        playersMigrated: idMapping.length,
        statsUpdated,
        holdingsUpdated,
        boostsUpdated,
        payoutsUpdated,
        locksUpdated,
      };

      console.log("[ADMIN] Migration complete:", result);
      res.json(result);
    } catch (error: any) {
      console.error("[ADMIN] Migration failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Who am I / auth confirmation
  app.get("/api/admin/whoami", adminAuth, async (req: any, res) => {
    try {
      const adminContext = req.adminContext || { method: "unknown", userId: null, email: null };
      const userId = req.user?.claims?.sub || adminContext.userId;
      const user = userId ? await storage.getUser(userId) : null;

      res.json({
        ok: true,
        adminContext,
        user: user
          ? {
              id: user.id,
              email: user.email,
              username: user.username,
              isAdmin: user.isAdmin,
              isPremium: user.isPremium,
              premiumExpiresAt: user.premiumExpiresAt || null,
            }
          : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Diagnostics snapshot (jobs, db, websocket, optional player volume check)
  app.get("/api/admin/diagnostics", adminAuth, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const deep = String(req.query.deep || "false") === "true";
      const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;

      // DB ping latency
      const dbPingStart = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbPingMs = Date.now() - dbPingStart;

      // Jobs
      const configuredJobs = jobScheduler.getConfiguredJobs();
      const scheduledStatus = jobScheduler.getStatus();
      const configuredJobNames = jobScheduler.getConfiguredJobNames();
      const latestLogs =
        configuredJobNames.length > 0
          ? await storage.getLatestJobLogPerType(configuredJobNames)
          : new Map();

      const jobs = configuredJobs
        .map((j) => {
          const live = scheduledStatus.find((s) => s.name === j.name);
          const last = latestLogs.get(j.name);
          return {
            name: j.name,
            schedule: j.schedule,
            enabled: j.enabled,
            running: live?.running || false,
            lastRun: last
              ? {
                  status: last.status,
                  scheduledFor: last.scheduledFor,
                  startedAt: last.startedAt,
                  finishedAt: last.finishedAt,
                  requestCount: last.requestCount,
                  recordsProcessed: last.recordsProcessed,
                  errorCount: last.errorCount,
                  errorMessage: last.errorMessage || null,
                }
              : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      // Optional volume diagnostic for a player
      let volumeDiagnostic: any = null;
      if (playerId) {
        const [p] = await db
          .select({ id: players.id, stored: players.volume24h })
          .from(players)
          .where(eq(players.id, playerId))
          .limit(1);

        const [tradeAgg] = await db
          .select({
            tradesCount24h: sql<number>`COUNT(*)::int`,
            ammTradesCount24h: sql<number>`SUM(CASE WHEN ${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool' THEN 1 ELSE 0 END)::int`,
            shares24h: sql<number>`COALESCE(ROUND(SUM(${trades.quantity}))::int, 0)`,
            lastTradeTs: sql<Date | null>`MAX(${trades.executedAt})`,
          })
          .from(trades)
          .where(
            and(
              eq(trades.playerId, playerId),
              gte(trades.executedAt, sql`NOW() - INTERVAL '24 hours'`),
            ),
          );

        volumeDiagnostic = {
          playerId,
          exists: !!p,
          storedVolume24h: p ? Number(p.stored || 0) : null,
          computedShares24h: Number(tradeAgg?.shares24h || 0),
          tradesCount24h: Number(tradeAgg?.tradesCount24h || 0),
          ammTradesCount24h: Number(tradeAgg?.ammTradesCount24h || 0),
          lastTradeTs: tradeAgg?.lastTradeTs || null,
        };
      }

      // Optional deeper counts (can be slow on huge DBs)
      let deepCounts: any = null;
      if (deep) {
        const playersCount = await db.select({ count: sql<number>`COUNT(*)::int` }).from(players);
        const tradesCount = await db.select({ count: sql<number>`COUNT(*)::int` }).from(trades);
        const usersCount = await db.select({ count: sql<number>`COUNT(*)::int` }).from(users);
        deepCounts = {
          players: Number(playersCount?.[0]?.count || 0),
          trades: Number(tradesCount?.[0]?.count || 0),
          users: Number(usersCount?.[0]?.count || 0),
        };
      }

      res.json({
        ok: true,
        adminContext: req.adminContext || null,
        server: {
          now: new Date().toISOString(),
          node: process.version,
          platform: process.platform,
          pid: process.pid,
          uptimeSec: Math.round(process.uptime()),
          memory: process.memoryUsage(),
          env: {
            NODE_ENV: process.env.NODE_ENV || null,
            hasAdminApiToken: !!process.env.ADMIN_API_TOKEN,
            hasSupabaseUrl: !!process.env.SUPABASE_URL,
            hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            hasPerplexityKey: !!process.env.PERPLEXITY_API_KEY,
            hasTwitterKeys: !!process.env.TWITTER_API_KEY && !!process.env.TWITTER_API_SECRET,
          },
        },
        db: {
          ok: true,
          pingMs: dbPingMs,
        },
        jobs: {
          configuredCount: configuredJobs.length,
          scheduledCount: scheduledStatus.length,
          manualTriggerableJobs: jobScheduler.getAvailableManualJobNames(),
          list: jobs,
        },
        websocket: getWebSocketStats(),
        volume: volumeDiagnostic,
        deepCounts,
        timingMs: Date.now() - startedAt,
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message, timingMs: Date.now() - startedAt });
    }
  });

  // Admin endpoint: Route smoke test (self-fetch critical endpoints)
  // Useful for production confirmation/debugging after deploys.
  app.get("/api/admin/route-smoke", adminAuth, async (req: any, res) => {
    const startedAt = Date.now();
    const timeoutMs = Math.min(
      Math.max(parseInt(String(req.query.timeoutMs || "5000"), 10) || 5000, 500),
      30000,
    );
    const includeHeavy = String(req.query.includeHeavy || "false") === "true";
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;

    const forwardedProto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.get("host");
    const baseUrl =
      typeof req.query.baseUrl === "string" && req.query.baseUrl
        ? req.query.baseUrl
        : `${forwardedProto}://${forwardedHost}`;

    const authHeader = req.headers.authorization;

    type SmokeTarget = {
      name: string;
      method: "GET" | "POST";
      path: string;
      expectedStatus?: number;
    };

    const targets: SmokeTarget[] = [
      { name: "admin.whoami", method: "GET", path: "/api/admin/whoami", expectedStatus: 200 },
      { name: "admin.stats", method: "GET", path: "/api/admin/stats", expectedStatus: 200 },
      ...(includeHeavy
        ? [
            {
              name: "admin.diagnostics",
              method: "GET",
              path: "/api/admin/diagnostics",
              expectedStatus: 200,
            } as SmokeTarget,
          ]
        : []),

      {
        name: "market.scanners",
        method: "GET",
        path: "/api/market/scanners?sport=NBA",
        expectedStatus: 200,
      },
      {
        name: "players.list",
        method: "GET",
        path: "/api/players?sport=NBA&limit=1&offset=0&sortBy=volume&sortOrder=desc",
        expectedStatus: 200,
      },
      {
        name: "players.spotlight.risers",
        method: "GET",
        path: "/api/players/spotlight/top-risers?sport=NBA",
        expectedStatus: 200,
      },
      {
        name: "players.spotlight.pools",
        method: "GET",
        path: "/api/players/spotlight/top-pools?sport=NBA",
        expectedStatus: 200,
      },
      {
        name: "games.today",
        method: "GET",
        path: "/api/games/today?sport=NBA",
        expectedStatus: 200,
      },
      ...(includeHeavy
        ? [
            {
              name: "analytics.overview",
              method: "GET",
              path: "/api/analytics?timeRange=24H",
              expectedStatus: 200,
            } as SmokeTarget,
          ]
        : []),
    ];

    if (playerId) {
      targets.push(
        {
          name: "player.shares-info",
          method: "GET",
          path: `/api/player/${encodeURIComponent(playerId)}/shares-info`,
          expectedStatus: 200,
        },
        {
          name: "amm.pool",
          method: "GET",
          path: `/api/amm/${encodeURIComponent(playerId)}`,
          expectedStatus: 200,
        },
        {
          name: "amm.quote.buy",
          method: "GET",
          path: `/api/amm/${encodeURIComponent(playerId)}/quote?type=buy&amount=10`,
          expectedStatus: 200,
        },
        ...(includeHeavy
          ? [
              {
                name: "admin.diagnostics.player",
                method: "GET",
                path: `/api/admin/diagnostics?playerId=${encodeURIComponent(playerId)}`,
                expectedStatus: 200,
              } as SmokeTarget,
            ]
          : []),
      );
    }

    const fetchOne = async (t: SmokeTarget) => {
      const url = `${baseUrl}${t.path}`;
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: t.method,
          headers: {
            ...(authHeader ? { authorization: authHeader } : {}),
            accept: "application/json",
          },
          signal: controller.signal,
        });

        const ms = Date.now() - started;
        const ct = r.headers.get("content-type") || "";
        let bodySnippet: string | null = null;
        try {
          const text = await r.text();
          bodySnippet = text ? text.slice(0, 400) : "";
        } catch {
          bodySnippet = null;
        }

        const ok = t.expectedStatus ? r.status === t.expectedStatus : r.ok;
        return {
          name: t.name,
          method: t.method,
          url,
          status: r.status,
          ok,
          ms,
          contentType: ct,
          bodySnippet,
        };
      } catch (error: any) {
        const ms = Date.now() - started;
        return {
          name: t.name,
          method: t.method,
          url,
          status: null as any,
          ok: false,
          ms,
          error:
            error?.name === "AbortError"
              ? `timeout_after_${timeoutMs}ms`
              : error?.message || String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    };

    // Run with limited concurrency to avoid self-DOS
    const concurrency = 4;
    const results: any[] = [];
    let idx = 0;

    const workers = Array.from({ length: Math.min(concurrency, targets.length) }).map(async () => {
      while (true) {
        const myIdx = idx;
        idx += 1;
        if (myIdx >= targets.length) break;
        results[myIdx] = await fetchOne(targets[myIdx]);
      }
    });

    await Promise.all(workers);

    const passed = results.filter((r) => r && r.ok).length;
    const failed = results.filter((r) => r && !r.ok).length;

    res.json({
      ok: failed === 0,
      adminContext: req.adminContext || null,
      baseUrl,
      timeoutMs,
      includeHeavy,
      playerId,
      summary: {
        total: results.length,
        passed,
        failed,
      },
      results,
      timingMs: Date.now() - startedAt,
    });
  });

  // Admin endpoint: Manually trigger cron jobs
  app.post("/api/admin/jobs/trigger", adminAuth, async (req, res) => {
    try {
      const { jobName, operationId } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      if (!jobName) {
        return res.status(400).json({ error: "jobName required" });
      }

      const validJobs = jobScheduler.getAvailableManualJobNames();
      if (!validJobs.includes(jobName)) {
        return res
          .status(400)
          .json({ error: `Invalid jobName. Must be one of: ${validJobs.join(", ")}` });
      }

      console.log(
        `[ADMIN] Job trigger requested by ${clientIp}: ${jobName}${operationId ? ` (operation: ${operationId})` : ""}`,
      );

      // Create progress callback if operationId provided
      let progressCallback;
      if (operationId) {
        const { createProgressCallback } = await import("./lib/admin-stream");
        progressCallback = createProgressCallback(operationId);

        // Emit initial event
        progressCallback({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Starting job: ${jobName}`,
          data: { jobName },
        });
      }

      // Trigger job with optional progress callback
      const result = await jobScheduler.triggerJob(jobName, progressCallback);

      console.log(
        `[ADMIN] Job ${jobName} completed - ${result.recordsProcessed} records, ${result.errorCount} errors, ${result.requestCount} requests`,
      );

      // Emit completion event if callback exists
      if (progressCallback) {
        progressCallback({
          type: "complete",
          timestamp: new Date().toISOString(),
          message:
            result.errorCount > 0
              ? `Job ${jobName} completed with ${result.errorCount} errors`
              : `Job ${jobName} completed successfully`,
          data: {
            success: result.errorCount === 0,
            jobName,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
            requestCount: result.requestCount,
          },
        });
      }

      invalidateAdminStatsCache();

      res.json({
        success: true,
        jobName,
        result,
        status: result.errorCount > 0 ? "degraded" : "success",
      });
    } catch (error: any) {
      console.error("[ADMIN] Job trigger failed:", error.message);

      // Emit error event if callback exists (create it from body if available)
      const { operationId } = req.body;
      if (operationId) {
        try {
          const { createProgressCallback } = await import("./lib/admin-stream");
          const progressCallback = createProgressCallback(operationId);
          progressCallback({
            type: "error",
            timestamp: new Date().toISOString(),
            message: `Job failed: ${error.message}`,
            data: { error: error.message, stack: error.stack },
          });
          progressCallback({
            type: "complete",
            timestamp: new Date().toISOString(),
            message: "Job failed",
            data: { success: false },
          });
        } catch (streamError) {
          console.error("[ADMIN] Failed to emit error event:", streamError);
        }
      }

      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      res.status(statusCode).json({ error: error.message });
    }
  });

  // Admin endpoint: SSE stream for operation logs
  app.get("/api/admin/stream/:operationId", adminAuth, async (req, res) => {
    const { operationId } = req.params;

    try {
      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

      // Send initial connection message
      res.write(
        `data: ${JSON.stringify({
          type: "info",
          timestamp: new Date().toISOString(),
          message: `Connected to operation ${operationId}`,
        })}\n\n`,
      );

      // Register this client with the stream manager
      const { adminStreamManager } = await import("./lib/admin-stream");
      adminStreamManager.registerClient(operationId, res);

      console.log(`[SSE] Client connected to operation ${operationId}`);

      // Handle client disconnect
      req.on("close", () => {
        console.log(`[SSE] Client disconnected from operation ${operationId}`);
        adminStreamManager.unregisterClient(operationId, res);
      });

      // Prevent error handler from trying to send JSON response
      req.on("error", (err) => {
        console.error(`[SSE] Stream error for ${operationId}:`, err);
        if (!res.writableEnded) {
          res.end();
        }
      });
    } catch (error: any) {
      console.error(`[SSE] Failed to setup stream for ${operationId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.end();
      }
    }
  });

  // Admin endpoint: Backfill game logs for date range
  app.post("/api/admin/backfill", adminAuth, async (req, res) => {
    try {
      const { startDate, endDate, operationId } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ error: "startDate and endDate required (YYYY-MM-DD format)" });
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      // Parse and normalize dates to UTC midnight
      const start = new Date(startDate + "T00:00:00.000Z");
      const end = new Date(endDate + "T00:00:00.000Z");

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid date values" });
      }

      if (start > end) {
        return res.status(400).json({ error: "startDate must be before or equal to endDate" });
      }

      // Enforce max range (90 days to prevent abuse and rate limit exhaustion)
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const MAX_DAYS = 90;
      if (daysDiff > MAX_DAYS) {
        return res.status(400).json({
          error: `Date range too large. Maximum ${MAX_DAYS} days allowed. You requested ${daysDiff} days.`,
        });
      }

      // Validate dates are not in the future
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (start > now || end > now) {
        return res.status(400).json({ error: "Cannot backfill future dates" });
      }

      // Validate dates are within current season range (Oct 1 to now)
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const seasonStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
      const seasonStart = new Date(seasonStartYear, 9, 1); // Oct 1

      if (start < seasonStart) {
        return res.status(400).json({
          error: `startDate must be on or after season start (${seasonStart.toISOString().split("T")[0]})`,
        });
      }

      console.log(
        `[ADMIN] Backfill requested by ${clientIp}: ${startDate} to ${endDate} (${daysDiff + 1} days)`,
      );

      // Create progress callback if operationId provided
      let progressCallback;
      if (operationId) {
        const { createProgressCallback } = await import("./lib/admin-stream");
        progressCallback = createProgressCallback(operationId);
      }

      // Import syncPlayerGameLogs here to avoid circular dependency
      // @ts-expect-error Legacy admin backfill module is absent from this checkout.
      const { syncPlayerGameLogs } = await import("./jobs/sync-player-game-logs");
      const result = await syncPlayerGameLogs({
        mode: "backfill",
        startDate: start,
        endDate: end,
        progressCallback,
      });

      // Determine status based on errors
      const status = result.errorCount > 0 ? "degraded" : "success";

      console.log(
        `[ADMIN] Backfill ${status} - ${result.recordsProcessed} game logs cached, ${result.errorCount} errors, ${result.requestCount} API requests`,
      );

      // Only send response if headers haven't been sent yet (streaming case)
      if (!res.headersSent) {
        invalidateAdminStatsCache();
        res.json({
          success: status === "success",
          status,
          result,
          message:
            result.errorCount > 0
              ? `Backfill completed with ${result.errorCount} errors. Check logs for details.`
              : "Backfill completed successfully",
        });
      }
    } catch (error: any) {
      console.error("[ADMIN] Backfill failed:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // Admin endpoint: Bot statistics and recent actions
  app.get("/api/admin/bots", adminAuth, async (_req, res) => {
    try {
      const [stats, runtimeStatus] = await Promise.all([getBotStats(), getBotRuntimeStatus()]);

      return res.json({
        runtime: "deterministic_bot_engine_v2",
        stats,
        runtimeStatus,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to load bot runtime status",
      });
    }
  });

  // Admin endpoint: Manually trigger deterministic bot engine
  app.post("/api/admin/bots/trigger", adminAuth, async (_req, res) => {
    try {
      const result = await runBotEngineTick();
      const runtimeStatus = await getBotRuntimeStatus();

      return res.json({
        triggered: true,
        result,
        runtimeStatus,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to trigger bot runtime",
      });
    }
  });

  // Admin endpoint: Manually credit premium shares (for failed Whop purchases)
  app.post("/api/admin/premium/credit", adminAuth, async (req, res) => {
    try {
      const { userId, quantity, reason } = req.body;

      if (!userId || !quantity) {
        return res.status(400).json({ error: "userId and quantity are required" });
      }

      const qty = parseInt(quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "quantity must be a positive integer" });
      }

      // Verify user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get current premium holding
      const existingHolding = await storage.getHolding(userId, "premium", "premium");
      const currentQuantity = parseFloat(existingHolding?.quantity || "0");
      const newQuantity = currentQuantity + qty;

      // Credit the shares
      await storage.updateHolding(userId, "premium", "premium", newQuantity, "5.0000");

      await recordPremiumActivityEvent({
        userId,
        eventType: "premium_admin_credit",
        quantityDelta: qty,
        metadata: {
          source: "admin_premium_credit",
          reason: reason || "Manual credit by admin",
          adminUserId: (req as any).adminContext?.userId || null,
        },
      });

      console.log(
        `[ADMIN] Manually credited ${qty} premium shares to user ${userId}. Reason: ${reason || "No reason provided"}`,
      );

      // Broadcast portfolio update
      broadcast({ type: "portfolio" });

      res.json({
        success: true,
        userId,
        previousQuantity: currentQuantity,
        creditedQuantity: qty,
        newQuantity,
        reason: reason || "Manual credit by admin",
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to credit premium shares:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: View pending premium checkout sessions
  app.get("/api/admin/premium/sessions", adminAuth, async (req, res) => {
    try {
      const sessions = await db
        .select()
        .from(premiumCheckoutSessions)
        .orderBy(desc(premiumCheckoutSessions.createdAt))
        .limit(50);

      res.json({ sessions });
    } catch (error: any) {
      console.error("[ADMIN] Failed to get premium sessions:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== TWEET MANAGEMENT ENDPOINTS ==========

  // Admin endpoint: Get tweet settings and history
  app.get("/api/admin/tweets", adminAuth, async (req, res) => {
    try {
      // Get settings (create default if none exist)
      let settings = await db.select().from(tweetSettings).limit(1);
      if (settings.length === 0) {
        const [newSettings] = await db
          .insert(tweetSettings)
          .values({
            enabled: false,
          })
          .returning();
        settings = [newSettings];
      }

      // Get recent tweet history
      const history = await db
        .select()
        .from(tweetHistory)
        .orderBy(desc(tweetHistory.createdAt))
        .limit(20);

      // Get service status
      const { twitterService } = await import("./services/twitter");
      const { perplexityService } = await import("./services/perplexity");

      res.json({
        settings: settings[0],
        history,
        status: {
          twitter: twitterService.getStatus(),
          perplexity: perplexityService.getStatus(),
        },
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to get tweet settings:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Update tweet settings
  app.patch("/api/admin/tweets/settings", adminAuth, async (req, res) => {
    try {
      const {
        enabled,
        promptTemplate,
        includeRisers,
        includeVolume,
        includeMarketCap,
        maxPlayers,
      } = req.body;

      // Get existing settings or create new
      let settings = await db.select().from(tweetSettings).limit(1);

      if (settings.length === 0) {
        const [newSettings] = await db
          .insert(tweetSettings)
          .values({
            enabled: enabled ?? false,
            promptTemplate: promptTemplate ?? undefined,
            includeRisers: includeRisers ?? true,
            includeVolume: includeVolume ?? true,
            includeMarketCap: includeMarketCap ?? true,
            maxPlayers: maxPlayers ?? 3,
          })
          .returning();
        return res.json({ settings: newSettings });
      }

      // Update existing settings
      const updates: any = { updatedAt: new Date() };
      if (enabled !== undefined) updates.enabled = enabled;
      if (promptTemplate !== undefined) updates.promptTemplate = promptTemplate;
      if (includeRisers !== undefined) updates.includeRisers = includeRisers;
      if (includeVolume !== undefined) updates.includeVolume = includeVolume;
      if (includeMarketCap !== undefined) updates.includeMarketCap = includeMarketCap;
      if (maxPlayers !== undefined) updates.maxPlayers = maxPlayers;

      const [updated] = await db
        .update(tweetSettings)
        .set(updates)
        .where(eq(tweetSettings.id, settings[0].id))
        .returning();

      res.json({ settings: updated });
    } catch (error: any) {
      console.error("[ADMIN] Failed to update tweet settings:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Verify Twitter credentials
  app.post("/api/admin/tweets/verify", adminAuth, async (req, res) => {
    try {
      const { twitterService } = await import("./services/twitter");

      if (!twitterService.isReady()) {
        return res.status(400).json({
          success: false,
          error: "Twitter service not configured - missing API credentials",
          status: twitterService.getStatus(),
        });
      }

      const verification = await twitterService.verifyCredentials();

      if (verification.valid) {
        res.json({
          success: true,
          username: verification.username,
          message: `Successfully connected to Twitter account @${verification.username}`,
        });
      } else {
        res.status(400).json({
          success: false,
          error: verification.error,
          hint: "Make sure your Twitter Developer App has 'Read and Write' permissions enabled, and you've regenerated your Access Token & Secret AFTER enabling those permissions.",
        });
      }
    } catch (error: any) {
      console.error("[ADMIN] Failed to verify Twitter credentials:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Preview a tweet (without posting)
  app.post("/api/admin/tweets/preview", adminAuth, async (req, res) => {
    try {
      const { generateTweetPreview } = await import("./jobs/daily-tweet");
      const preview = await generateTweetPreview();

      res.json({
        content: preview.content,
        playerData: preview.playerData,
        aiSummary: preview.aiSummary,
        characterCount: preview.content.length,
        settings: preview.settings,
      });
    } catch (error: any) {
      console.error("[ADMIN] Failed to generate tweet preview:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Post a tweet immediately (supports custom content)
  app.post("/api/admin/tweets/post", adminAuth, async (req, res) => {
    try {
      const { customContent } = req.body;

      if (customContent) {
        // Post custom content directly
        const { twitterService } = await import("./services/twitter");
        const tweetResult = await twitterService.postTweet(customContent);

        if (tweetResult.success) {
          // Log to tweet history
          await db.insert(tweetHistory).values({
            content: customContent,
            tweetId: tweetResult.tweetId,
            status: "posted",
          });

          res.json({
            success: true,
            tweetId: tweetResult.tweetId,
            content: customContent,
          });
        } else {
          res.status(400).json({
            success: false,
            error: tweetResult.error,
          });
        }
      } else {
        // Use daily tweet generator
        const { postDailyTweet } = await import("./jobs/daily-tweet");
        const result = await postDailyTweet();

        if (result.success) {
          res.json({
            success: true,
            tweetId: result.tweetId,
            content: result.content,
          });
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
          });
        }
      }
    } catch (error: any) {
      console.error("[ADMIN] Failed to post tweet:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Test Twitter connection
  app.post("/api/admin/tweets/test-twitter", adminAuth, async (req, res) => {
    try {
      const { twitterService } = await import("./services/twitter");
      const result = await twitterService.verifyCredentials();
      res.json(result);
    } catch (error: any) {
      console.error("[ADMIN] Failed to test Twitter:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Test Perplexity connection
  app.post("/api/admin/tweets/test-perplexity", adminAuth, async (req, res) => {
    try {
      const { perplexityService } = await import("./services/perplexity");
      const result = await perplexityService.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error("[ADMIN] Failed to test Perplexity:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Get market context for custom tweet drafting
  app.get("/api/admin/tweets/context", adminAuth, async (req, res) => {
    try {
      const { getFullMarketContext } = await import("./jobs/daily-tweet");
      const context = await getFullMarketContext();
      res.json(context);
    } catch (error: any) {
      console.error("[ADMIN] Failed to get market context:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Draft a custom tweet using Perplexity
  app.post("/api/admin/tweets/draft", adminAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const { draftCustomTweet } = await import("./jobs/daily-tweet");
      const result = await draftCustomTweet(prompt);

      if (result.success) {
        res.json({
          success: true,
          content: result.content,
          context: result.context,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      console.error("[ADMIN] Failed to draft custom tweet:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Cron endpoint: Daily tweet (for external cron services like cron-job.net)
  app.post("/api/cron/daily-tweet", adminAuth, async (req, res) => {
    try {
      console.log("[CRON] Daily tweet triggered");
      const { postDailyTweet } = await import("./jobs/daily-tweet");
      const result = await postDailyTweet();

      if (result.success) {
        console.log("[CRON] Daily tweet posted successfully:", result.tweetId);
        res.json({
          success: true,
          tweetId: result.tweetId,
        });
      } else {
        console.warn("[CRON] Daily tweet failed:", result.error);
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      console.error("[CRON] Daily tweet error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== END TWEET MANAGEMENT ==========

  // ========== NEWS HUB ENDPOINTS ==========

  // Get general news feed (last 7 days)
  app.get("/api/news", optionalAuth, async (req, res) => {
    try {
      const { newsFeed } = await import("@shared/schema");

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const news = await db
        .select()
        .from(newsFeed)
        .where(gte(newsFeed.createdAt, sevenDaysAgo))
        .orderBy(desc(newsFeed.createdAt))
        .limit(50);

      const payload = { news };
      if (!(req as any).user) {
        return res.json(
          withPublicDataHeaders(res, payload, {
            maxAgeSeconds: 60,
            sharedMaxAgeSeconds: 60,
          }),
        );
      }

      res.json(payload);
    } catch (error: any) {
      console.error("[news] Error fetching news:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get lightweight player name lookup (for auto-hyperlinking player names)
  app.get("/api/players/lookup", async (req, res) => {
    try {
      const allPlayers = await storage.getPlayers();

      // Return only active players with minimal data needed for name matching
      const players = allPlayers
        .filter((p: Player) => p.isActive)
        .map((p: Player) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          fullName: `${p.firstName} ${p.lastName}`,
          priceChange24h: p.priceChange24h || null,
        }));

      res.json(
        withPublicDataHeaders(res, { players }, { maxAgeSeconds: 60, sharedMaxAgeSeconds: 60 }),
      );
    } catch (error: any) {
      console.error("[players/lookup] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get personalized daily digest for authenticated user
  app.get("/api/news/digest", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { compileUserDigest } = await import("./jobs/compile-digest");

      const digest = await compileUserDigest(userId);

      res.json({ digest });
    } catch (error: any) {
      console.error("[news/digest] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark news as read (updates last_news_viewed_at timestamp)
  app.post("/api/news/mark-read", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);

      await db.update(users).set({ lastNewsViewedAt: new Date() }).where(eq(users.id, userId));

      res.json({ success: true });
    } catch (error: any) {
      console.error("[news/mark-read] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get unread news count for notification badge
  app.get("/api/news/unread-count", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { newsFeed } = await import("@shared/schema");

      // Get user's last viewed timestamp
      const user = await storage.getUser(userId);
      const lastViewed = user?.lastNewsViewedAt || new Date(0);

      // Count news items created after last viewed
      const result = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(newsFeed)
        .where(gte(newsFeed.createdAt, lastViewed));

      const count = result[0]?.count || 0;

      // Daily digest notifications release at 6:00 AM ET
      const now = new Date();
      const todayET = getTodayET();
      const { startOfDay: todayStartET } = getETDayBoundaries(todayET);
      let latestDigestReleaseAt = new Date(todayStartET.getTime() + 6 * 60 * 60 * 1000);

      if (now < latestDigestReleaseAt) {
        latestDigestReleaseAt = new Date(latestDigestReleaseAt.getTime() - 24 * 60 * 60 * 1000);
      }

      const hasUnreadDigest = lastViewed < latestDigestReleaseAt;

      res.json({
        count,
        digestCount: hasUnreadDigest ? 1 : 0,
        hasUnreadDigest,
        digestReleaseAt: latestDigestReleaseAt,
      });
    } catch (error: any) {
      console.error("[news/unread-count] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Trigger a specific job manually (e.g., news_fetch)
  app.post("/api/admin/jobs/:jobName/trigger", adminAuth, async (req, res) => {
    try {
      const adminContext = (req as any).adminContext;
      const adminActor =
        adminContext?.userId || adminContext?.email || adminContext?.method || "admin";

      const { jobName } = req.params;

      // Only allow specific jobs to be triggered from this endpoint
      const allowedJobs = ["news_fetch", "compile_digest"];
      if (!allowedJobs.includes(jobName)) {
        return res.status(400).json({ error: `Job '${jobName}' not allowed via this endpoint` });
      }

      console.log(`[Admin] ${adminActor} triggering job: ${jobName}`);

      const result = await jobScheduler.triggerJob(jobName);

      res.json({
        success: true,
        jobName,
        ...result,
      });
    } catch (error: any) {
      console.error("[admin/jobs/trigger] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== END NEWS HUB ==========

  const ANALYTICS_MARKET_CUTOFF = new Date("2026-02-04T00:00:00.000Z");
  const clampAnalyticsStartDate = (startDate: Date) =>
    startDate < ANALYTICS_MARKET_CUTOFF ? new Date(ANALYTICS_MARKET_CUTOFF) : startDate;

  // Analytics API - market insights and player analysis
  app.get("/api/analytics", async (req, res) => {
    try {
      const timeRange = (req.query.timeRange as string) || "24H";

      // Calculate date range based on timeRange
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "24H":
          startDate.setDate(now.getDate() - 1);
          break;
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30D":
          startDate.setDate(now.getDate() - 30);
          break;
        case "3M":
          startDate.setMonth(now.getMonth() - 3);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "All":
          startDate = new Date(2020, 0, 1);
          break; // From start
        default:
          startDate.setDate(now.getDate() - 1);
      }

      const effectiveStartDate = clampAnalyticsStartDate(startDate);

      // Get market health stats, rankings, and sport breakdown data
      const [
        marketHealth,
        shareEconomy,
        timeSeries,
        shareEconomyTimeSeries,
        powerRankingsData,
        allPlayers,
        sportPlayerStats,
        sportTradeStats,
      ] = await Promise.all([
        storage.getMarketHealthStats(effectiveStartDate, now),
        storage.getShareEconomyStats(effectiveStartDate, now),
        storage.getMarketHealthTimeSeries(effectiveStartDate, now),
        storage.getShareEconomyTimeSeries(effectiveStartDate, now),
        storage.getPowerRankings(50),
        storage.getPlayers(),
        db
          .select({
            sport: players.sport,
            totalPlayers: sql<number>`COUNT(*)::int`,
            activePlayers: sql<number>`COUNT(*) FILTER (WHERE ${players.isActive} = true)::int`,
            totalVolume24h: sql<string>`COALESCE(SUM(CASE WHEN ${players.isActive} = true THEN ${players.volume24h} ELSE 0 END), 0)`,
            totalMarketCap: sql<string>`COALESCE(SUM(CASE WHEN ${players.isActive} = true THEN ${players.marketCap}::numeric ELSE 0 END), 0)`,
            avgPriceChange24h: sql<string>`COALESCE(AVG(CASE WHEN ${players.isActive} = true THEN ${players.priceChange24h}::numeric END), 0)`,
          })
          .from(players)
          .groupBy(players.sport),
        db
          .select({
            sport: players.sport,
            tradesInRange: sql<number>`COUNT(*)::int`,
            tradedVolumeInRange: sql<string>`COALESCE(SUM(${trades.quantity} * ${trades.price}), 0)`,
          })
          .from(trades)
          .innerJoin(players, eq(trades.playerId, players.id))
          .where(and(gte(trades.executedAt, effectiveStartDate), lte(trades.executedAt, now)))
          .groupBy(players.sport),
      ]);

      // Calculate percentage changes
      const transactionChange =
        marketHealth.prevTransactionCount > 0
          ? ((marketHealth.transactionCount - marketHealth.prevTransactionCount) /
              marketHealth.prevTransactionCount) *
            100
          : 0;
      const volumeChange =
        marketHealth.prevTotalVolume > 0
          ? ((marketHealth.totalVolume - marketHealth.prevTotalVolume) /
              marketHealth.prevTotalVolume) *
            100
          : 0;
      const marketCapChange =
        marketHealth.prevTotalMarketCap > 0
          ? ((marketHealth.totalMarketCap - marketHealth.prevTotalMarketCap) /
              marketHealth.prevTotalMarketCap) *
            100
          : 0;

      const powerRankings = powerRankingsData.map((r, idx) => ({
        rank: idx + 1,
        player: {
          id: r.playerId,
          firstName: r.name.split(" ")[0],
          lastName: r.name.split(" ").slice(1).join(" "),
          team: r.team,
          position: r.position,
          lastTradePrice: r.price.toFixed(2),
          volume24h: r.volume,
          priceChange24h: r.priceChange7d.toFixed(2),
        },
        compositeScore: r.compositeScore,
        priceChange7d: r.priceChange7d,
        avgFantasyPoints: r.avgFantasyPoints,
      }));

      // Get position rankings using the effective-share rankings data
      const positions = ["PG", "SG", "SF", "PF", "C"];
      const positionRankings = positions.map((position: string) => {
        const posPlayers = powerRankingsData
          .filter((p) => p.position.includes(position))
          .slice(0, 10)
          .map((p, idx) => ({
            rank: idx + 1,
            player: {
              id: p.playerId,
              firstName: p.name.split(" ")[0],
              lastName: p.name.split(" ").slice(1).join(" "),
              team: p.team,
              position: p.position,
              lastTradePrice: p.price.toFixed(2),
              volume24h: p.volume,
              priceChange24h: p.priceChange7d.toFixed(2),
            },
            avgFantasyPoints: p.avgFantasyPoints,
            priceChange7d: p.priceChange7d,
          }));

        return { position, players: posPlayers };
      });

      // Calculate avg price change from active players
      const activePlayers = allPlayers.filter((p: Player) => p.isActive);
      const priceChanges = activePlayers.map((p: Player) => parseFloat(p.priceChange24h || "0"));
      const avgPriceChange =
        priceChanges.length > 0
          ? priceChanges.reduce((sum: number, c: number) => sum + c, 0) / priceChanges.length
          : 0;

      // Most active team by volume
      const teamVolumes: Record<string, number> = {};
      activePlayers.forEach((p: Player) => {
        teamVolumes[p.team] = (teamVolumes[p.team] || 0) + (p.volume24h || 0);
      });
      const mostActiveTeam =
        Object.entries(teamVolumes).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

      const tradeStatsBySport = new Map(
        sportTradeStats.map((row) => [(row.sport || "").toUpperCase(), row]),
      );
      const sportSet = new Set<string>([
        ...SUPPORTED_SPORTS,
        ...sportPlayerStats.map((row) => (row.sport || "").toUpperCase()),
        ...sportTradeStats.map((row) => (row.sport || "").toUpperCase()),
      ]);
      const supportedSportsSet = new Set<string>(SUPPORTED_SPORTS);
      const sportsInResponse = [
        ...SUPPORTED_SPORTS.filter((sport) => sportSet.has(sport)),
        ...Array.from(sportSet)
          .filter((sport) => !supportedSportsSet.has(sport))
          .sort(),
      ];
      const sportBreakdown = sportsInResponse.map((sport) => {
        const playerStats = sportPlayerStats.find(
          (row) => (row.sport || "").toUpperCase() === sport,
        );
        const tradeStats = tradeStatsBySport.get(sport);

        return {
          sport,
          totalPlayers: playerStats?.totalPlayers || 0,
          activePlayers: playerStats?.activePlayers || 0,
          totalVolume24h: parseFloat(playerStats?.totalVolume24h || "0"),
          totalMarketCap: parseFloat(playerStats?.totalMarketCap || "0"),
          avgPriceChange24h: parseFloat(playerStats?.avgPriceChange24h || "0"),
          tradesInRange: tradeStats?.tradesInRange || 0,
          tradedVolumeInRange: parseFloat(tradeStats?.tradedVolumeInRange || "0"),
        };
      });

      res.json({
        marketHealth: {
          transactions: marketHealth.transactionCount,
          transactionChange,
          volume: marketHealth.totalVolume,
          volumeChange,
          marketCap: marketHealth.totalMarketCap,
          marketCapChange,
          sharesMined: shareEconomy.totalSharesScouted,
          sharesBurned: shareEconomy.totalSharesBurned,
          totalShares: shareEconomy.totalSharesInEconomy,
          periodSharesMined: shareEconomy.periodSharesScouted,
          periodSharesBurned: shareEconomy.periodSharesBurned,
          timeSeries,
          shareEconomyTimeSeries: shareEconomyTimeSeries.map((point) => ({
            ...point,
            sharesMined: point.sharesScouted,
          })),
        },
        powerRankings,
        positionRankings,
        sportBreakdown,
        marketStats: {
          totalVolume24h: marketHealth.totalVolume,
          totalTrades24h: marketHealth.transactionCount,
          avgPriceChange,
          mostActiveTeam,
        },
      });
    } catch (error: any) {
      console.error("[analytics] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Market snapshots API - daily metrics for analytics charts
  app.get("/api/analytics/snapshots", async (req, res) => {
    try {
      const timeRange = (req.query.timeRange as string) || "30D";

      // Calculate date range based on timeRange
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30D":
          startDate.setDate(now.getDate() - 30);
          break;
        case "3M":
          startDate.setMonth(now.getMonth() - 3);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "All":
          startDate = new Date(2020, 0, 1);
          break;
        default:
          startDate.setDate(now.getDate() - 30);
      }

      const effectiveStartDate = clampAnalyticsStartDate(startDate);

      // Query market snapshots from database
      const snapshots = await db
        .select()
        .from(marketSnapshots)
        .where(
          and(
            gte(marketSnapshots.snapshotDate, effectiveStartDate),
            lte(marketSnapshots.snapshotDate, now),
          ),
        )
        .orderBy(marketSnapshots.snapshotDate);

      // Query scout distributions by date for the same time range
      const scoutDistributionsByDate = await db
        .select({
          date: sql<string>`DATE(${scoutDistributions.hourTimestamp})`.as("date"),
          totalShares: sql<string>`COALESCE(SUM(${scoutDistributions.sharesEarned}), 0)`.as(
            "totalShares",
          ),
        })
        .from(scoutDistributions)
        .where(
          and(
            gte(scoutDistributions.hourTimestamp, effectiveStartDate),
            lte(scoutDistributions.hourTimestamp, now),
          ),
        )
        .groupBy(sql`DATE(${scoutDistributions.hourTimestamp})`);

      // Create a map of scout shares by date for easy lookup
      const scoutSharesMap = new Map<string, number>();
      for (const row of scoutDistributionsByDate) {
        scoutSharesMap.set(row.date, Math.floor(parseFloat(row.totalShares || "0")));
      }

      res.json({
        timeRange,
        startDate: effectiveStartDate.toISOString(),
        endDate: now.toISOString(),
        snapshots: snapshots.map((s) => {
          const snapshotDateStr = new Date(s.snapshotDate).toISOString().split("T")[0];
          const sharesScouted = scoutSharesMap.get(snapshotDateStr) || 0;

          return {
            date: s.snapshotDate,
            marketCap: parseFloat(s.marketCap),
            transactions: s.transactionsCount,
            volume: parseFloat(s.volume),
            sharesMined: sharesScouted,
            sharesScouted,
            sharesBurned: s.sharesBurned,
            totalShares: s.totalShares,
          };
        }),
      });
    } catch (error: any) {
      console.error("[analytics/snapshots] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Player comparison with full metrics
  app.get("/api/analytics/compare", async (req, res) => {
    try {
      const playerIds = ((req.query.playerIds as string) || "").split(",").filter(Boolean);
      const timeRange = (req.query.timeRange as string) || "30D";

      if (playerIds.length < 1) {
        return res.json({ players: [] });
      }

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30D":
          startDate.setDate(now.getDate() - 30);
          break;
        case "3M":
          startDate.setMonth(now.getMonth() - 3);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "All":
          startDate = new Date(2020, 0, 1);
          break;
        default:
          startDate.setDate(now.getDate() - 30);
      }

      const effectiveStartDate = clampAnalyticsStartDate(startDate);

      // Get AMM-first comparison data
      const [
        sharesMap,
        poolDataMap,
        totalBoostsResult,
        boostUsageRows,
        ammStatsRows,
        ammHistoryRows,
      ] = await Promise.all([
        storage.getPlayerSharesOutstanding(playerIds),
        storage.getBatchPoolData(playerIds),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(dailyBoosts)
          .where(
            and(gte(dailyBoosts.boostDate, effectiveStartDate), lte(dailyBoosts.boostDate, now)),
          ),
        db
          .select({
            playerId: dailyBoosts.playerId,
            timesUsed: sql<number>`COUNT(*)`,
          })
          .from(dailyBoosts)
          .where(
            and(
              inArray(dailyBoosts.playerId, playerIds),
              gte(dailyBoosts.boostDate, effectiveStartDate),
              lte(dailyBoosts.boostDate, now),
            ),
          )
          .groupBy(dailyBoosts.playerId),
        db
          .select({
            playerId: trades.playerId,
            ammVolume: sql<string>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`,
            ammTrades: sql<number>`COUNT(*)`,
          })
          .from(trades)
          .where(
            and(
              inArray(trades.playerId, playerIds),
              gte(trades.executedAt, effectiveStartDate),
              lte(trades.executedAt, now),
              sql`(${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool')`,
            ),
          )
          .groupBy(trades.playerId),
        db
          .select({
            playerId: trades.playerId,
            date: sql<string>`DATE(${trades.executedAt})`.as("date"),
            volume: sql<string>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`.as(
              "volume",
            ),
          })
          .from(trades)
          .where(
            and(
              inArray(trades.playerId, playerIds),
              gte(trades.executedAt, effectiveStartDate),
              lte(trades.executedAt, now),
              sql`(${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool')`,
            ),
          )
          .groupBy(trades.playerId, sql`DATE(${trades.executedAt})`)
          .orderBy(trades.playerId, sql`DATE(${trades.executedAt})`),
      ]);

      const totalBoosts = totalBoostsResult[0]?.count || 0;
      const boostUsageMap = new Map<string, { timesUsed: number; usagePercent: number }>();
      for (const row of boostUsageRows) {
        const timesUsed = row.timesUsed || 0;
        boostUsageMap.set(row.playerId, {
          timesUsed,
          usagePercent: totalBoosts > 0 ? (timesUsed / totalBoosts) * 100 : 0,
        });
      }

      const ammStatsMap = new Map<string, { ammVolume: number; ammTrades: number }>();
      for (const row of ammStatsRows) {
        ammStatsMap.set(row.playerId, {
          ammVolume: parseFloat(row.ammVolume || "0"),
          ammTrades: row.ammTrades || 0,
        });
      }

      const ammHistoryMap = new Map<string, Array<{ timestamp: string; volume: number }>>();
      for (const row of ammHistoryRows) {
        if (!ammHistoryMap.has(row.playerId)) {
          ammHistoryMap.set(row.playerId, []);
        }
        ammHistoryMap.get(row.playerId)!.push({
          timestamp: `${row.date}T00:00:00.000Z`,
          volume: parseFloat(row.volume || "0"),
        });
      }

      const playersData = await Promise.all(
        playerIds.slice(0, 5).map(async (id: string) => {
          const player = await storage.getPlayer(id);
          if (!player) return null;

          const shares = sharesMap.get(id) || 0;
          const price = parseFloat(player.lastTradePrice || player.currentPrice || "0");
          const marketCap = shares * price;
          const boostUsage = boostUsageMap.get(id) || { timesUsed: 0, usagePercent: 0 };
          const poolData = poolDataMap.get(id) || {
            shares: 0,
            playMoney: 0,
            totalVolume: 0,
            totalTrades: 0,
          };
          const ammStats = ammStatsMap.get(id) || { ammVolume: 0, ammTrades: 0 };
          const ammVolumeHistory = ammHistoryMap.get(id) || [];

          return {
            id: player.id,
            name: `${player.firstName} ${player.lastName}`,
            team: player.team,
            position: player.position,
            shares,
            marketCap,
            price,
            volume: player.volume24h || 0,
            priceChange24h: parseFloat(player.priceChange24h || "0"),
            boostUsagePercent: boostUsage.usagePercent,
            timesUsedInBoosts: boostUsage.timesUsed,
            ammVolume: ammStats.ammVolume,
            ammTrades: ammStats.ammTrades,
            poolLiquidity: poolData.playMoney,
            poolShares: poolData.shares,
            ammVolumeHistory,
          };
        }),
      );

      res.json({ players: playersData.filter(Boolean) });
    } catch (error: any) {
      console.error("[analytics/compare] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Price correlations between players
  app.get("/api/analytics/correlations", async (req, res) => {
    try {
      const allPlayers = await storage.getPlayers();
      const topPlayers = allPlayers
        .filter((p: Player) => p.isActive && p.volume24h && p.volume24h > 0)
        .sort((a: Player, b: Player) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 20);

      // Calculate correlations based on price change patterns
      const correlations: {
        player1: string;
        player2: string;
        player1Id: string;
        player2Id: string;
        correlation: number;
      }[] = [];

      for (let i = 0; i < topPlayers.length; i++) {
        for (let j = i + 1; j < topPlayers.length; j++) {
          const p1 = topPlayers[i];
          const p2 = topPlayers[j];

          const change1 = parseFloat(p1.priceChange24h || "0");
          const change2 = parseFloat(p2.priceChange24h || "0");

          // Correlation based on direction and magnitude similarity
          let correlation = 0;
          if ((change1 > 0 && change2 > 0) || (change1 < 0 && change2 < 0)) {
            // Same direction - higher correlation
            const magnitudeDiff = Math.abs(Math.abs(change1) - Math.abs(change2));
            correlation = Math.max(0.5, 1 - magnitudeDiff / 20);
          } else if (change1 === 0 || change2 === 0) {
            correlation = 0.3;
          } else {
            // Opposite direction - lower correlation
            correlation = Math.max(0, 0.3 - Math.abs(change1 + change2) / 40);
          }

          // Team boost: players on same team tend to correlate
          if (p1.team === p2.team) {
            correlation = Math.min(1, correlation + 0.15);
          }

          correlations.push({
            player1: `${p1.firstName} ${p1.lastName}`,
            player2: `${p2.firstName} ${p2.lastName}`,
            player1Id: p1.id,
            player2Id: p2.id,
            correlation: Math.round(correlation * 100) / 100,
          });
        }
      }

      // Sort by correlation strength
      correlations.sort((a, b) => b.correlation - a.correlation);

      res.json(correlations.slice(0, 20));
    } catch (error: any) {
      console.error("[analytics/correlations] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // STACK SHARES ROUTES
  // ============================================

  const handleStackShares = async (req: any, res: any) => {
    try {
      const userId = getUserId(req);
      const { playerId, sharesToStack } = req.body;

      // Validate input
      if (!playerId) {
        return res.status(400).json({ error: "playerId is required" });
      }

      const shares = parseInt(sharesToStack);
      if (isNaN(shares) || shares < 4) {
        return res.status(400).json({ error: "Minimum 4 shares required to stack" });
      }

      if (shares % 2 !== 0) {
        return res.status(400).json({ error: "Share count must be even" });
      }

      const result = await storage.stackShares(userId, playerId, shares);
      const holdingInfo = await storage.getHoldingMultiplierState(userId, playerId);
      const player = await storage.getPlayer(playerId);
      res.json(
        buildStackSharesResponsePayload({
          sharesStacked: result.sharesStacked,
          multiplier: result.multiplier,
          newMultiplier: result.newMultiplier,
          effectiveSharesBurned: result.effectiveSharesBurned,
          holding: holdingInfo,
          player: player
            ? {
                id: player.id,
                firstName: player.firstName,
                lastName: player.lastName,
                team: player.team,
              }
            : null,
        }),
      );
    } catch (error: any) {
      console.error("[holdings/stack-shares] Error:", error);
      res.status(400).json({ error: error.message });
    }
  };

  app.post("/api/holdings/stack-shares", isAuthenticated, handleStackShares);

  // Get holding with multiplier info for a specific player
  const handleHoldingMultiplierState = async (req: any, res: any) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;

      const holdingInfo = await storage.getHoldingMultiplierState(userId, playerId);

      if (!holdingInfo) {
        return res.json({
          hasHolding: false,
          quantity: 0,
          availableShares: 0,
          effectiveShares: 0,
          multiplier: "0.00",
          hasStackedShare: false,
          canStackShares: false,
          maxStackable: 0,
        });
      }

      res.json({
        hasHolding: true,
        ...holdingInfo,
        canStackShares: holdingInfo.canStackShares,
        maxStackable: holdingInfo.maxStackable,
      });
    } catch (error: any) {
      console.error("[holdings/multiplier-state] Error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  app.get(
    "/api/holdings/:playerId/multiplier-state",
    isAuthenticated,
    handleHoldingMultiplierState,
  );

  // ============================================
  // DAILY BOOSTS ROUTES
  // ============================================

  // Get all daily boosts across all sports (sport-agnostic)
  app.get("/api/daily-boosts/all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const dateStr = resolveEtDateOrToday(req.query.date);
      const targetDate = toNoonForEtDate(dateStr);

      const boosts = await storage.getDailyBoostsAllSports(userId, targetDate);

      // Enrich with player data (share multiplier is stored on the boost)
      const playerIds = boosts.map((b) => b.playerId);
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map((p) => [p.id, p]));

      // Get all community boosts across all sports
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((cb) => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Fetch live player game stats for each boost (for live fantasy points display)
      const enrichedBoosts = await Promise.all(
        boosts.map(async (boost) => {
          let liveFantasyPoints: number | null = null;
          let liveGameStats: any = null;

          // Only fetch live stats if the boost has a gameId
          if (boost.gameId) {
            try {
              // First try direct playerId lookup
              let gameStats = await storage.getPlayerGameStats(boost.playerId, boost.gameId);

              // If not found, try fallback by home/away (handles mismatched player IDs)
              if (!gameStats || !gameStats.fantasyPoints) {
                const player = playerMap.get(boost.playerId);
                if (player?.team) {
                  // Get the game to determine home/away
                  const game = await storage.getDailyGameByGameId(boost.gameId);
                  if (game) {
                    const isHome = player.team === game.homeTeam;
                    const homeAway = isHome ? "home" : "away";

                    // Get all stats for this game and home/away
                    const teamStats = await storage.getPlayerGameStatsByGameAndHomeAway(
                      boost.gameId,
                      homeAway,
                    );

                    // Find stats for this player by looking at their team
                    // (The stats playerId might differ from our DB playerId, so we match by team)
                    gameStats =
                      teamStats.find((s) => s.points > 0 || s.rebounds > 0 || s.assists > 0) ||
                      undefined;
                  }
                }
              }

              if (gameStats && gameStats.fantasyPoints) {
                liveFantasyPoints = parseFloat(gameStats.fantasyPoints);
                liveGameStats = {
                  points: gameStats.points,
                  rebounds: gameStats.rebounds,
                  assists: gameStats.assists,
                  threePointersMade: gameStats.threePointersMade,
                  minutes: gameStats.minutes,
                };
              }
            } catch (err) {
              // Stats might not exist yet for in-progress games
              console.debug(
                `[daily-boosts/all] No live stats for player ${boost.playerId} game ${boost.gameId}`,
              );
            }
          }

          return {
            ...boost,
            player: playerMap.get(boost.playerId),
            communityBoostCount: communityBoostMap.get(boost.playerId) || 0,
            liveFantasyPoints,
            liveGameStats,
          };
        }),
      );

      res.json({
        date: dateStr,
        boosts: enrichedBoosts,
        slotsRemaining: 4 - boosts.length,
        availableSlots: [5, 4, 3, 2].filter((tier) => !boosts.some((b) => b.slotTier === tier)),
      });
    } catch (error: any) {
      console.error("[daily-boosts/all] Error fetching boosts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get community boosts across all sports (for the community list)
  app.get("/api/community-boosts/all", isAuthenticated, async (req: any, res) => {
    try {
      const dateStr = resolveEtDateOrToday(req.query.date);
      const targetDate = toNoonForEtDate(dateStr);

      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);

      // Group by player to count how many community boosts each player has
      const playerBoostCounts = new Map<
        string,
        { count: number; players: typeof communityBoosts }
      >();
      communityBoosts.forEach((cb) => {
        const existing = playerBoostCounts.get(cb.playerId);
        if (existing) {
          existing.count += 1;
          existing.players.push(cb);
        } else {
          playerBoostCounts.set(cb.playerId, { count: 1, players: [cb] });
        }
      });

      const result = Array.from(playerBoostCounts.entries()).map(([playerId, data]) => ({
        playerId,
        player: data.players[0].player,
        communityBoostCount: data.count,
        creators: data.players.map((p) => p.creator),
        sport: data.players[0].sport,
        boostDate: data.players[0].boostDate,
      }));

      res.json({
        date: dateStr,
        communityBoosts: result,
      });
    } catch (error: any) {
      console.error("[community-boosts/all] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all holdings with players (for boost selector) - shows all held players regardless of game status
  app.get("/api/daily-boosts/eligible-all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Parse date query param (YYYY-MM-DD), default to today in ET
      const dateStr = resolveEtDateOrToday(req.query.date);

      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const targetDate = toNoonForEtDate(dateStr);

      // Get all holdings with players
      const allHoldings = await storage.getAllHoldingsWithPlayers(userId);

      // Get all games today for all sports
      const todaysGames = await db
        .select()
        .from(dailyGames)
        .where(and(gte(dailyGames.date, startOfDay), lt(dailyGames.date, endOfDay)));

      // Build a map of team -> game info (include status)
      const teamGameMap = new Map<
        string,
        {
          gameId: string;
          startTime: Date;
          sport: string;
          status: string;
          homeScore: number | null;
          awayScore: number | null;
        }
      >();
      for (const game of todaysGames) {
        const gameSummary = {
          gameId: game.gameId,
          startTime: new Date(game.startTime),
          sport: game.sport,
          status: game.status,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        };
        teamGameMap.set(game.homeTeam, gameSummary);
        teamGameMap.set(game.awayTeam, gameSummary);
      }

      // Get current boosts to show which players are already boosted
      const currentBoosts = await storage.getDailyBoostsAllSports(userId, targetDate);
      const boostedPlayerIds = new Set(currentBoosts.map((b) => b.playerId));

      // Get community boosts for this sport/date (add +1 to multiplier for each)
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((cb) => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's premium shares for community boost option
      const userHoldings = await storage.getUserHoldings(userId);
      const premiumHolding = userHoldings.find((h: Holding) => h.assetType === "premium");
      const userPremiumShares = premiumHolding?.quantity || 0;

      const lockedQuantities = await storage.getBatchTotalLockedQuantities(
        userId,
        "player",
        allHoldings.map((holding) => holding.player.id),
      );

      // Aggregate holdings by playerId to avoid duplicates when user has multiple holding rows
      // (e.g., regular shares + stacked shares for the same player)
      const playerHoldingsMap = new Map<string, typeof allHoldings>();
      for (const holding of allHoldings) {
        if (!holding.player) continue;
        const existing = playerHoldingsMap.get(holding.player.id);
        if (existing) {
          existing.push(holding);
        } else {
          playerHoldingsMap.set(holding.player.id, [holding]);
        }
      }

      const result = Array.from(playerHoldingsMap.entries()).map(([playerId, holdings]) => {
        const player = holdings[0].player;
        const teamGame = teamGameMap.get(player.team);
        const totalLocked = lockedQuantities.get(player.id) || 0;

        // Aggregate share counts across all holding rows
        let regularShares = 0;
        let stackedShares = 0;
        let availableShares = 0;
        let totalEffectiveShares = 0;
        let bestShareMultiplier = 1; // Default to 1 (regular share)

        for (const holding of holdings) {
          const qty = parseFloat(holding.quantity);
          const multiplier = parseFloat(holding.multiplier || "1");
          if (holding.isStackedShare) {
            stackedShares += qty;
          } else {
            regularShares += qty;
          }
          totalEffectiveShares += parseFloat(holding.effectiveShares || holding.quantity || "0");

          // Track the best (highest) share multiplier among holdings with at least 1 share.
          if (qty >= 1 && multiplier > bestShareMultiplier) {
            bestShareMultiplier = multiplier;
          }
        }

        // Tradeable availability only applies to regular shares; stacked shares count as one
        // boost-eligible share each and are not locked via holdings_locks.
        availableShares = Math.max(0, regularShares - totalLocked) + stackedShares;
        const effectiveShares = totalEffectiveShares.toFixed(2);

        const gameStartTime = teamGame?.startTime;
        const hasGameToday = !!teamGame;
        const gameDbStatus = teamGame?.status || "scheduled";
        const gameStatus = getMarketplaceGameStatus(teamGame);

        return {
          holdingId: holdings[0].id,
          playerId: player.id,
          player: player,
          sport: player.sport,
          availableShares,
          regularShares,
          availableRegularShares: Math.max(0, regularShares - totalLocked),
          stackedShares,
          effectiveShares,
          multiplier: bestShareMultiplier.toFixed(2),
          bestShareMultiplier,
          totalShares: totalEffectiveShares.toFixed(2),
          hasStackedShare: stackedShares > 0,
          gameId: teamGame?.gameId || null,
          gameStartTime: gameStartTime || null,
          hasGameToday,
          gameStatus,
          gameDbStatus,
          isAlreadyBoosted: boostedPlayerIds.has(player.id),
          communityBoostCount: communityBoostMap.get(player.id) || 0,
          hasCommunityBoost: communityBoostMap.has(player.id),
          userPremiumShares,
        };
      });

      res.json({
        date: dateStr,
        eligiblePlayers: result,
        totalEligible: result.filter(
          (_, i, arr) => arr.findIndex((a) => a.playerId === _.playerId) === i,
        ).length, // Unique players count
      });
    } catch (error: any) {
      console.error("[daily-boosts/eligible-all] Error:", error.message);
      console.error("[daily-boosts/eligible-all] Stack:", error.stack);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Get eligible players for boosting (holdings with games today)
  app.get("/api/daily-boosts/eligible/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();

      // Parse date query param (YYYY-MM-DD), default to today in ET
      // Use getETDayBoundaries to get proper UTC boundaries for the ET date
      const dateStr = resolveEtDateOrToday(req.query.date);

      // Create a Date object in the middle of the ET day (noon) to avoid timezone edge cases
      const targetDate = toNoonForEtDate(dateStr); // Noon on the ET day

      const eligiblePlayers = await storage.getEligiblePlayersForBoost(userId, sport, targetDate);

      // Get current boosts to show which players are already boosted
      const currentBoosts = await storage.getDailyBoosts(userId, sport, targetDate);
      const boostedPlayerIds = new Set(currentBoosts.map((b) => b.playerId));

      // Get community boosts for this sport/date (add +1 to multiplier for each)
      const communityBoosts = await storage.getCommunityBoostsForDate(sport, targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((cb) => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's premium shares for community boost option
      const userHoldings = await storage.getUserHoldings(userId);
      const premiumHolding = userHoldings.find((h: Holding) => h.assetType === "premium");
      const userPremiumShares = premiumHolding?.quantity || 0;

      const result = eligiblePlayers.map((ep) => ({
        playerId: ep.player.id,
        player: ep.player,
        availableShares: ep.availableShares,
        effectiveShares: ep.effectiveShares,
        multiplier: ep.multiplier,
        totalShares: ep.effectiveShares,
        hasStackedShare: ep.isStackedShare,
        gameId: ep.gameId,
        gameStartTime: ep.gameStartTime,
        isAlreadyBoosted: boostedPlayerIds.has(ep.player.id),
        gameStarted: hasGameStartedForBoost({
          status: ep.gameDbStatus,
          startTime: ep.gameStartTime,
          homeScore: ep.gameHomeScore,
          awayScore: ep.gameAwayScore,
        }),
        communityBoostCount: communityBoostMap.get(ep.player.id) || 0,
        hasCommunityBoost: communityBoostMap.has(ep.player.id),
        userPremiumShares,
      }));

      res.json({
        sport,
        date: dateStr,
        eligiblePlayers: result,
        totalEligible: result.length,
      });
    } catch (error: any) {
      console.error("[daily-boosts/eligible] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Assign a player to a boost slot
  app.post("/api/daily-boosts/assign", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, slotTier, sharesEntered, sport, date } = req.body;

      // Validate input
      if (!playerId || !slotTier || !sharesEntered || !sport) {
        return res
          .status(400)
          .json({ error: "playerId, slotTier, sharesEntered, and sport are required" });
      }

      const tierNum = parseInt(slotTier);
      if (![2, 3, 4, 5].includes(tierNum)) {
        return res.status(400).json({ error: "slotTier must be 2, 3, 4, or 5" });
      }

      const shares = parseInt(sharesEntered);
      if (shares <= 0) {
        return res.status(400).json({ error: "sharesEntered must be positive" });
      }

      // Verify only 1 share is entered per boost slot.
      if (shares !== 1) {
        return res.status(400).json({
          error: `Only 1 share can be placed in a boost slot. You entered ${shares} shares. Use Stack Shares to roll more multiplier into a single share.`,
        });
      }

      const dateStr = resolveEtDateOrToday(date);
      const { boost, canonicalPlayerId, shareMultiplier } = await assignDailyBoostWithValidation({
        userId,
        playerId,
        sport,
        slotTier: tierNum,
        etDate: dateStr,
      });

      // Get player info for response
      const player = await storage.getPlayer(canonicalPlayerId);

      void sendUserNotification({
        userId,
        category: "boost_lifecycle",
        title: "Boost Assigned",
        body: `${player?.firstName || "Player"} ${player?.lastName || ""} is now in your ${tierNum}x slot.`,
        deepLink: "/boosts",
        data: {
          boostId: boost.id,
          playerId: canonicalPlayerId,
          slotTier: String(tierNum),
          shareMultiplier,
        },
        dedupeKey: `boost_assigned:${boost.id}`,
      }).catch((error) => {
        console.error("[daily-boosts/assign] Failed to send boost assignment push:", error);
      });

      res.json({
        success: true,
        boost: {
          ...boost,
          player,
        },
        estimatedPayout: `Estimated based on season average`,
      });
    } catch (error: any) {
      if (error instanceof DailyBoostValidationError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("[daily-boosts/assign] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a player from boost slot (only if game hasn't started)
  app.delete("/api/daily-boosts/:boostId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const boostId = req.params.boostId;

      // Get the boost and verify ownership
      const boosts = await storage.getDailyBoostsByStatus("active");
      const boost = boosts.find((b) => b.id === boostId && b.userId === userId);

      if (!boost) {
        return res.status(404).json({ error: "Boost not found or not owned by you" });
      }

      // Check if boost is still active (not locked)
      if (boost.status !== "active") {
        return res.status(400).json({
          error: `Cannot remove boost - status is ${boost.status}. Boosts are locked when the game starts.`,
        });
      }

      // Double-check game hasn't started
      if (boost.gameId) {
        const game = await storage.getDailyGameByGameId(boost.gameId);
        if (game && hasGameStartedForBoost(game)) {
          return res.status(400).json({ error: "Cannot remove boost - game has already started" });
        }
      }

      // Delete the boost
      await storage.deleteDailyBoost(boostId);

      res.json({ success: true, message: "Boost removed successfully" });
    } catch (error: any) {
      console.error("[daily-boosts/delete] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get live updates for boosts
  app.get("/api/daily-boosts/live/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();
      const dateStr = resolveEtDateOrToday(req.query.date);
      const targetDate = toNoonForEtDate(dateStr);

      const boosts = await storage.getDailyBoosts(userId, sport, targetDate);

      // Get all relevant games for these players to fetch live stats
      const gameIds = boosts.map((b) => b.gameId).filter((id) => !!id) as string[];

      // We need to fetch the dailyGames again to get fresh fantasyPoints data if available
      const games = await db
        .select()
        .from(dailyGames)
        .where(
          and(
            inArray(dailyGames.gameId, gameIds.length > 0 ? gameIds : ["PLACEHOLDER"]),
            eq(dailyGames.sport, sport),
          ),
        );

      const gameMap = new Map(games.map((g) => [g.gameId, g]));

      const liveBoosts = boosts.map((boost) => {
        const game = boost.gameId ? gameMap.get(boost.gameId) : null;

        let liveFantasyPoints = 0;
        let gameStatus = "scheduled"; // scheduled, live, finished

        if (game) {
          const now = new Date();
          const startTime = new Date(game.startTime);

          if (now < startTime) {
            gameStatus = "scheduled";
          } else {
            gameStatus = "live";

            // Use fantasyPoints from boost if settled, OR from game record if available
            if (boost.fantasyPoints) {
              const settledFantasyPoints = Number(boost.fantasyPoints);
              liveFantasyPoints = Number.isFinite(settledFantasyPoints) ? settledFantasyPoints : 0;
              gameStatus = "finished";
            }
            // If we had a live feed updating dailyGames, we'd check game.homeScore etc,
            // but for specific player fantasy points we need a player_stats table or similar.
            // For now, allow reading from boost which is our settlement record.
          }
        }

        const parsedShareMultiplier = Number(boost.shareMultiplier ?? 1);
        const effectivePower = Number.isFinite(parsedShareMultiplier) ? parsedShareMultiplier : 1;
        const parsedSlotTier = Number(boost.slotTier ?? 0);
        const slotTierMultiplier = Number.isFinite(parsedSlotTier) ? parsedSlotTier : 0;
        const estimatedPayoutValue = effectivePower * liveFantasyPoints * slotTierMultiplier;
        const estimatedPayout = Number.isFinite(estimatedPayoutValue)
          ? estimatedPayoutValue.toFixed(2)
          : "0.00";

        return {
          ...boost,
          liveFantasyPoints,
          estimatedPayout,
          gameStatus,
        };
      });

      const totalEstimatedEarnings = liveBoosts
        .reduce((sum, b) => sum + parseFloat(b.estimatedPayout), 0)
        .toFixed(2);

      res.json({
        boosts: liveBoosts,
        totalEstimatedEarnings,
      });
    } catch (error: any) {
      console.error("[daily-boosts/live] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get boost payout history
  app.get("/api/daily-boosts/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;

      const payouts = await storage.getBoostPayoutHistory(userId, limit);

      // Enrich with player data
      const playerIds = [...new Set(payouts.map((p) => p.playerId))];
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map((p) => [p.id, p]));

      const enrichedPayouts = payouts.map((payout) => ({
        ...payout,
        player: playerMap.get(payout.playerId),
      }));

      // Calculate totals
      const totalEarned = payouts.reduce((sum, p) => sum + parseFloat(p.payoutAmount), 0);

      res.json({
        payouts: enrichedPayouts,
        totalEarned: totalEarned.toFixed(2),
        totalBoosts: payouts.length,
      });
    } catch (error: any) {
      console.error("[daily-boosts/history] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get daily boosts state (generic :sport route - MUST be last)
  app.get("/api/daily-boosts/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();
      const dateStr = resolveEtDateOrToday(req.query.date);
      const targetDate = toNoonForEtDate(dateStr);

      const boosts = await storage.getDailyBoosts(userId, sport, targetDate);

      // Enrich with player data (share multiplier is stored on the boost)
      const playerIds = boosts.map((b) => b.playerId);
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map((p) => [p.id, p]));

      // Get community boosts for this sport/date (each adds +1 to multiplier)
      const communityBoosts = await storage.getCommunityBoostsForDate(sport, targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((cb) => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      const enrichedBoosts = boosts.map((boost) => ({
        ...boost,
        player: playerMap.get(boost.playerId),
        communityBoostCount: communityBoostMap.get(boost.playerId) || 0,
      }));

      res.json({
        sport,
        date: dateStr,
        boosts: enrichedBoosts,
        slotsRemaining: 4 - boosts.length,
        availableSlots: [5, 4, 3, 2].filter((tier) => !boosts.some((b) => b.slotTier === tier)),
      });
    } catch (error: any) {
      console.error("[daily-boosts] Error fetching boosts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Community Boosts API
  // Get active community boosts for a sport
  app.get("/api/community-boosts/:sport", isAuthenticated, async (req: any, res, next) => {
    try {
      const rawSport = String(req.params.sport || "").toLowerCase();
      if (rawSport === "history" || rawSport === "eligible-players" || rawSport === "all") {
        return next();
      }

      const sport = req.params.sport.toUpperCase();
      const dateStr = resolveEtDateOrToday(req.query.date);
      const targetDate = toNoonForEtDate(dateStr);

      const boosts = await storage.getCommunityBoostsForDate(sport, targetDate);

      res.json(boosts);
    } catch (error: any) {
      console.error("[community-boosts/list] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new community boost (requires premium share)
  app.post("/api/community-boosts/create", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, sport, date } = req.body;

      if (!playerId || !sport) {
        return res.status(400).json({ error: "playerId and sport are required" });
      }

      // 1. Verify player has a game today that hasn't started
      const sportUpper = sport.toUpperCase();
      const canonicalPlayerId = await storage.getCanonicalPlayerId(playerId);
      const dateStr = resolveEtDateOrToday(date);
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = toNoonForEtDate(dateStr);

      const game = await storage.getPlayerGameForDate(canonicalPlayerId, sportUpper, targetDate);

      if (!game) {
        return res.status(400).json({ error: "This player does not have a game today" });
      }

      if (hasGameStartedForBoost(game)) {
        return res.status(400).json({ error: "Cannot boost - game has already started" });
      }

      // 2. Check if player already has an active community boost
      const existingBoosts = await storage.getCommunityBoostsForDate(sportUpper, targetDate);
      if (existingBoosts.some((b) => b.playerId === canonicalPlayerId)) {
        return res.status(400).json({ error: "This player already has a Community Boost!" });
      }

      // 3. Create boost (storage method handles premium share deduction)
      const boostDate = startOfDay;

      const boost = await storage.createCommunityBoost({
        creatorId: userId,
        playerId: canonicalPlayerId,
        sport: sportUpper,
        boostDate,
        gameId: game.gameId,
      });

      void sendUserNotification({
        userId,
        category: "community_boosts",
        title: "Community Boost Activated",
        body: "1 Community Share was redeemed to activate a boost.",
        deepLink: "/boosts",
        data: {
          boostId: boost.id,
          playerId: canonicalPlayerId,
          sport: sportUpper,
          gameId: game.gameId || "",
        },
        dedupeKey: `community_boost_created:${boost.id}`,
      }).catch((error) => {
        console.error("[community-boosts/create] Failed to send push:", error);
      });

      res.json({
        success: true,
        boost,
        message: "Community Boost activated! 1 Community Share redeemed.",
      });
    } catch (error: any) {
      console.error("[community-boosts/create] Error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get user's community boost history (created by them)
  app.get("/api/community-boosts/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const today = new Date();
      // Simple fetch for now - in future could add dedicated history method
      // For now, filter active ones or we need a specific history query
      // Let's implement a simple query in route or add to storage later if needed.
      // Re-using specific status fetch isn't efficient for user history.
      // Let's rely on frontend to show current active ones, and maybe later add full history.
      // For MVP, returning empty or todo. Actually, let's skip history endpoint for MVP
      // and just show active boosts on the dashboard.
      res.json([]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all players eligible for community boost (all players with games today, regardless of ownership)
  app.get("/api/community-boosts/eligible-players", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Parse date query param (YYYY-MM-DD), default to today in ET
      const dateStr = resolveEtDateOrToday(req.query.date);

      console.log(`[community-boosts/eligible-players] User ${userId}, date: ${dateStr}`);

      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const targetDate = toNoonForEtDate(dateStr);

      // Get all games today for all sports
      const todaysGames = await db
        .select()
        .from(dailyGames)
        .where(and(gte(dailyGames.date, startOfDay), lt(dailyGames.date, endOfDay)));

      console.log(
        `[community-boosts/eligible-players] Found ${todaysGames.length} games for date ${dateStr}`,
      );

      // Get all active community boosts for today
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      console.log(
        `[community-boosts/eligible-players] Found ${communityBoosts.length} community boosts`,
      );
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((cb) => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's community boosts for today (to show which ones they already created)
      const userCommunityBoosts = communityBoosts.filter((cb) => cb.creatorId === userId);
      const userBoostedPlayerIds = new Set(userCommunityBoosts.map((cb) => cb.playerId));

      // Get user's community shares (used for community boosts)
      const userHoldings = await storage.getUserHoldings(userId);
      const communityHolding = userHoldings.find((h: Holding) => h.assetType === "community");
      const userCommunityShares = communityHolding?.quantity || 0;

      // Build team -> game map
      const teamGameMap = new Map<
        string,
        {
          gameId: string;
          startTime: Date;
          sport: string;
          homeTeam: string;
          awayTeam: string;
          status: string;
          homeScore: number | null;
          awayScore: number | null;
        }
      >();
      for (const game of todaysGames) {
        const gameSummary = {
          gameId: game.gameId,
          startTime: new Date(game.startTime),
          sport: game.sport,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          status: game.status,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        };
        teamGameMap.set(game.homeTeam, gameSummary);
        teamGameMap.set(game.awayTeam, gameSummary);
      }

      // Get all players whose teams have games today
      const teamsWithGames = new Set([
        ...todaysGames.map((g) => g.homeTeam),
        ...todaysGames.map((g) => g.awayTeam),
      ]);
      console.log(`[community-boosts/eligible-players] Teams with games: ${teamsWithGames.size}`);

      let playersWithGames: (typeof players.$inferSelect)[] = [];
      if (teamsWithGames.size > 0) {
        playersWithGames = await db
          .select()
          .from(players)
          .where(inArray(players.team, Array.from(teamsWithGames)));
      }
      console.log(
        `[community-boosts/eligible-players] Found ${playersWithGames.length} players with games`,
      );

      const result = playersWithGames.map((player) => {
        const teamGame = teamGameMap.get(player.team);
        const gameStartTime = teamGame?.startTime;
        const hasGameToday = !!teamGame;
        const communityBoostCount = communityBoostMap.get(player.id) || 0;
        const alreadyBoostedByUser = userBoostedPlayerIds.has(player.id);
        const gameStatus = getMarketplaceGameStatus(teamGame);

        return {
          playerId: player.id,
          player: {
            id: player.id,
            firstName: player.firstName,
            lastName: player.lastName,
            team: player.team,
            sport: player.sport,
          },
          sport: player.sport,
          gameId: teamGame?.gameId || null,
          gameStartTime: gameStartTime || null,
          gameStatus,
          hasGameToday,
          communityBoostCount,
          alreadyBoostedByUser,
          opponent: teamGame
            ? teamGame.homeTeam === player.team
              ? `vs ${teamGame.awayTeam}`
              : `@ ${teamGame.homeTeam}`
            : null,
        };
      });

      // Sort by community boost count descending, then by name
      result.sort((a, b) => {
        if (b.communityBoostCount !== a.communityBoostCount) {
          return b.communityBoostCount - a.communityBoostCount;
        }
        const nameA = `${a.player.firstName} ${a.player.lastName}`;
        const nameB = `${b.player.firstName} ${b.player.lastName}`;
        return nameA.localeCompare(nameB);
      });

      console.log(
        `[community-boosts/eligible-players] Returning ${result.length} players, ${userCommunityShares} user shares`,
      );
      res.json({
        date: dateStr,
        players: result,
        userCommunityShares,
        totalPlayers: result.length,
      });
    } catch (error: any) {
      console.error("[community-boosts/eligible-players] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize players on first run by triggering roster sync
  async function initializePlayers() {
    try {
      const existingPlayers = await storage.getPlayers();

      if (existingPlayers.length === 0) {
        console.log(
          "No players found. Triggering roster_sync to fetch real NBA data from BallDontLie...",
        );
        const result = await jobScheduler.triggerJob("roster_sync");
        console.log(
          `Roster sync completed: ${result.recordsProcessed} players loaded, ${result.errorCount} errors`,
        );
      }
    } catch (error: any) {
      console.error("Failed to initialize players:", error.message);
    }
  }

  // Scout Velocity Tracking Endpoints
  // Get scout velocity for a specific player
  app.get("/api/scouts/velocity/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Get current scout count
      const currentScouts = await db
        .select({ total: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)` })
        .from(scoutAssignments)
        .where(eq(scoutAssignments.playerId, playerId));

      const totalScouts = Number(currentScouts[0]?.total || 0);

      // Get scout count from 1 hour ago using scout history
      const previousScouts = await db
        .select({
          total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`,
          maxStartedAt: sql<Date>`MAX(${scoutHistory.startedAt})`,
        })
        .from(scoutHistory)
        .where(
          and(
            eq(scoutHistory.playerId, playerId),
            lt(scoutHistory.startedAt, oneHourAgo),
            sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`,
          ),
        );

      const previousTotal = Number(previousScouts[0]?.total || 0);

      // Calculate velocity (scouts per hour)
      const velocity = totalScouts - previousTotal;
      const isTrending = velocity >= 10;

      res.json({
        playerId,
        velocity,
        totalScouts,
        previousTotal,
        isTrending,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[scouts/velocity] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get trending players (players with scout velocity >= 10/hour)
  app.get("/api/scouts/trending", async (req, res) => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Get all players with active scouts
      const playersWithScouts = await db
        .select({
          playerId: scoutAssignments.playerId,
          totalScouts: sql<number>`SUM(${scoutAssignments.scoutCount})`,
        })
        .from(scoutAssignments)
        .groupBy(scoutAssignments.playerId);

      // Calculate velocity for each player
      const trendingPlayers: string[] = [];

      for (const player of playersWithScouts) {
        const previousScouts = await db
          .select({
            total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`,
          })
          .from(scoutHistory)
          .where(
            and(
              eq(scoutHistory.playerId, player.playerId),
              lt(scoutHistory.startedAt, oneHourAgo),
              sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`,
            ),
          );

        const previousTotal = Number(previousScouts[0]?.total || 0);
        const currentTotal = Number(player.totalScouts || 0);
        const velocity = currentTotal - previousTotal;

        if (velocity >= 10) {
          trendingPlayers.push(player.playerId);
        }
      }

      res.json({
        playerIds: trendingPlayers,
        count: trendingPlayers.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[scouts/trending] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  const runStartupWarmups = async () => {
    await ensureLpFeeGrowthColumns();
    await ensurePremiumActivitySchema();

    try {
      await ensureUserApiTokenSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure user API token schema:", err?.message || err);
    }

    try {
      await ensureAgentThreadSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure agent thread schema:", err?.message || err);
    }

    try {
      await ensureUserAgentStrategySchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure agent strategy schema:", err?.message || err);
    }

    try {
      await ensureAgentSemanticSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure agent semantic schema:", err?.message || err);
    }

    try {
      await ensureAgentSystemSettingsSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure agent system settings schema:", err?.message || err);
    }

    try {
      await ensureUserMcpSourceSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure user MCP source schema:", err?.message || err);
    }

    try {
      await ensureSmsSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure SMS schema:", err?.message || err);
    }

    try {
      await ensureDiscordSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure Discord schema:", err?.message || err);
    }

    try {
      await ensureAccountDeletionSchema();
    } catch (err: any) {
      console.warn("[DB] Could not ensure account deletion schema:", err?.message || err);
    }

    await initializePlayers();
  };

  void runStartupWarmups().catch((error: any) => {
    console.warn("[startup] Warmup tasks failed:", error?.message || error);
  });

  // Register secondary domain route modules after core APIs are available
  registerDomainRoutes(app);

  return httpServer;
}
