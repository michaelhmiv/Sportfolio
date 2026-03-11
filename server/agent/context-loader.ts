import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { dailyGames, players } from "@shared/schema";
import type { UserAgentProfile } from "@shared/schema";
import { db } from "../db";
import { listAgentKnowledgeArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import type { ScoutAgentContext, ScoutAgentSelectionWindow } from "./types";

const SUPPORTED_SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;
const MAX_CANDIDATES = 40;
const DAILY_BOOST_SLOT_COUNT = 4;

type FocusResolution = {
  selectionWindow: ScoutAgentSelectionWindow | null;
  sportScope: string[];
};

function resolveSportScope(requestMessage: string | null | undefined, defaultSport: string | null) {
  const text = (requestMessage || "").toLowerCase();
  const explicitSports = SUPPORTED_SPORTS.filter((sport) => text.includes(sport.toLowerCase()));

  if (explicitSports.length > 0) {
    return explicitSports;
  }

  if (defaultSport) {
    return [defaultSport];
  }

  return [...SUPPORTED_SPORTS];
}

function resolveSelectionWindow(
  requestMessage: string | null | undefined,
  defaultSport: string | null,
): FocusResolution {
  const text = (requestMessage || "").toLowerCase();
  const sportScope = resolveSportScope(requestMessage, defaultSport);
  const todayET = getTodayET();
  let label: string | null = null;
  let date = todayET;

  if (text.includes("tomorrow")) {
    label = "tomorrow";
    const todayStart = getETDayBoundaries(todayET).startOfDay;
    date = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
  } else if (
    text.includes("today") ||
    text.includes("tonight") ||
    text.includes("this evening") ||
    text.includes("playing today")
  ) {
    label = "today";
  }

  if (!label) {
    return {
      selectionWindow: null,
      sportScope,
    };
  }

  const { startOfDay } = getETDayBoundaries(date);

  return {
    selectionWindow: {
      label,
      date,
      gameCount: 0,
      sportScope,
    },
    sportScope,
  };
}

function toNumericString(value: string | null | undefined) {
  return Number(value || "0");
}

function computeScoutOpportunityScore(input: {
  avgFantasyPointsPerGame: string;
  volume24h: number;
  priceChange24h: string;
  globalScoutCount: number;
  injuryStatus: string | null;
  hasGameInFocusWindow: boolean;
  currentScoutCount: number;
}) {
  const fantasyComponent = Math.min(35, toNumericString(input.avgFantasyPointsPerGame) * 0.9);
  const opportunityComponent = Math.max(0, 22 - input.globalScoutCount * 1.35);
  const volumeComponent = Math.min(12, input.volume24h / 250);
  const marketMomentumComponent = Math.max(-8, Math.min(8, toNumericString(input.priceChange24h)));
  const injuryPenalty = input.injuryStatus ? 14 : 0;
  const focusWindowBonus = input.hasGameInFocusWindow ? 28 : 0;
  const continuityBonus = input.currentScoutCount > 0 ? 4 : 0;

  return Number(
    Math.max(
      0,
      fantasyComponent +
        opportunityComponent +
        volumeComponent +
        marketMomentumComponent +
        focusWindowBonus +
        continuityBonus -
        injuryPenalty,
    ).toFixed(2),
  );
}

function buildRecommendationReason(input: {
  hasGameInFocusWindow: boolean;
  injuryStatus: string | null;
  globalScoutCount: number;
}) {
  const parts: string[] = [];

  if (input.hasGameInFocusWindow) {
    parts.push("scheduled in the requested window");
  }

  if (input.globalScoutCount <= 5) {
    parts.push("lighter scout competition");
  }

  if (input.injuryStatus) {
    parts.push(`injury risk: ${input.injuryStatus}`);
  }

  if (parts.length === 0) {
    parts.push("balanced upside based on current market and production");
  }

  return parts.join(", ");
}

export async function loadScoutAgentContext(
  userId: string,
  profile: UserAgentProfile,
  options?: {
    chatRequest?: string | null;
    sportOverride?: string | null;
  },
): Promise<ScoutAgentContext> {
  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const requestMessage = options?.chatRequest || null;
  const normalizedSportOverride =
    typeof options?.sportOverride === "string" && options.sportOverride.trim()
      ? options.sportOverride.trim().toUpperCase()
      : null;
  const { selectionWindow, sportScope: inferredSportScope } = resolveSelectionWindow(
    requestMessage,
    profile.defaultSport,
  );
  const sportScope = normalizedSportOverride ? [normalizedSportOverride] : inferredSportScope;
  const marketSport =
    normalizedSportOverride ||
    (sportScope.length === 1 ? sportScope[0] : profile.defaultSport || "ALL");

  const [
    assignments,
    totalScouts,
    marketPlayers,
    availableBalance,
    holdingsWithPlayers,
    watchlists,
    communitySharesAvailable,
    activeBoosts,
  ] = await Promise.all([
    storage.getUserScoutAssignments(userId),
    storage.getTotalScoutsForUser(userId),
    storage.getPlayersPaginated({
      sport: marketSport,
      limit: MAX_CANDIDATES,
      sortBy: "volume",
      sortOrder: "desc",
    }),
    storage.getAvailableBalance(userId),
    storage.getUserHoldingsWithPlayers(userId),
    storage.getWatchlists(userId),
    storage.getUserCommunityBoostShares(userId),
    storage.getDailyBoostsAllSports(userId, new Date()),
  ]);

  const maxScouts = user.isPremium ? 10 : 5;
  const playerHoldings = holdingsWithPlayers.filter(
    (entry: any) => entry?.holding?.assetType === "player" && entry?.player?.id,
  );
  let focusGames: Array<{
    sport: string;
    homeTeam: string;
    awayTeam: string;
    startTime: Date;
  }> = [];

  if (selectionWindow) {
    if (normalizedSportOverride) {
      selectionWindow.sportScope = [normalizedSportOverride];
    }

    const { startOfDay, endOfDay } = getETDayBoundaries(selectionWindow.date);
    focusGames = await db
      .select({
        sport: dailyGames.sport,
        homeTeam: dailyGames.homeTeam,
        awayTeam: dailyGames.awayTeam,
        startTime: dailyGames.startTime,
      })
      .from(dailyGames)
      .where(
        and(
          gte(dailyGames.startTime, startOfDay),
          lte(dailyGames.startTime, endOfDay),
          inArray(dailyGames.sport, sportScope),
        ),
      )
      .orderBy(asc(dailyGames.startTime));

    selectionWindow.gameCount = focusGames.length;
  }

  const focusTeams = Array.from(
    new Set(focusGames.flatMap((game) => [game.homeTeam, game.awayTeam]).filter(Boolean)),
  );
  const focusPlayers =
    focusTeams.length > 0
      ? await db
          .select()
          .from(players)
          .where(
            and(
              eq(players.isActive, true),
              inArray(players.team, focusTeams),
              inArray(players.sport, sportScope),
            ),
          )
          .orderBy(desc(players.volume24h))
          .limit(MAX_CANDIDATES)
      : [];

  const candidateIdSet = new Set<string>();

  for (const assignment of assignments) {
    candidateIdSet.add(assignment.playerId);
  }

  for (const player of focusPlayers) {
    candidateIdSet.add(player.id);
    if (candidateIdSet.size >= MAX_CANDIDATES) {
      break;
    }
  }

  for (const player of marketPlayers.players) {
    candidateIdSet.add(player.id);
    if (candidateIdSet.size >= MAX_CANDIDATES) {
      break;
    }
  }

  const candidateIds = Array.from(candidateIdSet).slice(0, MAX_CANDIDATES);
  const [candidatePlayers, globalScoutCounts, seasonStats] =
    candidateIds.length > 0
      ? await Promise.all([
          storage.getPlayersByIds(candidateIds),
          storage.getBatchActiveScoutCounts(candidateIds),
          storage.getBatchPlayerSeasonStatsFromLogs(candidateIds),
        ])
      : [[], new Map<string, number>(), new Map<string, { avgFantasyPointsPerGame: string }>()];

  const now = new Date();
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const uniqueSports = Array.from(
    new Set([
      ...candidatePlayers.map((player) => player.sport),
      ...playerHoldings.map((entry: any) => entry.player.sport as string),
    ]),
  );
  const upcomingGames =
    uniqueSports.length > 0
      ? await db
          .select({
            sport: dailyGames.sport,
            homeTeam: dailyGames.homeTeam,
            awayTeam: dailyGames.awayTeam,
            startTime: dailyGames.startTime,
          })
          .from(dailyGames)
          .where(
            and(
              gte(dailyGames.startTime, now),
              lte(dailyGames.startTime, windowEnd),
              inArray(dailyGames.sport, uniqueSports),
            ),
          )
          .orderBy(asc(dailyGames.startTime))
      : [];

  const assignmentMap = new Map(assignments.map((assignment) => [assignment.playerId, assignment]));

  const candidates = candidateIds
    .map((playerId) => candidatePlayers.find((player) => player.id === playerId))
    .filter((player): player is (typeof candidatePlayers)[number] => Boolean(player))
    .map((player) => {
      const assignment = assignmentMap.get(player.id);
      const nextGame = upcomingGames.find(
        (game) =>
          game.sport === player.sport &&
          (game.homeTeam === player.team || game.awayTeam === player.team),
      );
      const focusGame =
        selectionWindow &&
        focusGames.find(
          (game) =>
            game.sport === player.sport &&
            (game.homeTeam === player.team || game.awayTeam === player.team),
        );
      const avgFantasyPointsPerGame = seasonStats.get(player.id)?.avgFantasyPointsPerGame || "0.0";
      const globalScoutCount = globalScoutCounts.get(player.id) || 0;
      const currentScoutCount = assignment?.scoutCount || 0;
      const hasGameInFocusWindow = Boolean(focusGame);
      const scoutOpportunityScore = computeScoutOpportunityScore({
        avgFantasyPointsPerGame,
        volume24h: player.volume24h || 0,
        priceChange24h: player.priceChange24h || "0.00",
        globalScoutCount,
        injuryStatus: player.injuryStatus,
        hasGameInFocusWindow,
        currentScoutCount,
      });

      return {
        playerId: player.id,
        name: `${player.firstName} ${player.lastName}`,
        sport: player.sport,
        team: player.team,
        position: player.position,
        currentPrice: player.currentPrice,
        lastTradePrice: player.lastTradePrice,
        volume24h: player.volume24h || 0,
        priceChange24h: player.priceChange24h || "0.00",
        marketCap: player.marketCap || "0.00",
        injuryStatus: player.injuryStatus,
        avgFantasyPointsPerGame,
        globalScoutCount,
        currentScoutCount,
        upcomingGame: nextGame ? new Date(nextGame.startTime).toISOString() : null,
        hasGameInFocusWindow,
        scoutOpportunityScore,
      };
    })
    .sort((a, b) => b.scoutOpportunityScore - a.scoutOpportunityScore);

  const recommendedTargets = candidates.slice(0, 5).map((candidate) => ({
    playerId: candidate.playerId,
    name: candidate.name,
    sport: candidate.sport,
    score: candidate.scoutOpportunityScore,
    reason: buildRecommendationReason({
      hasGameInFocusWindow: candidate.hasGameInFocusWindow,
      injuryStatus: candidate.injuryStatus,
      globalScoutCount: candidate.globalScoutCount,
    }),
  }));

  const watchlistEntryCount = watchlists.reduce(
    (sum, watchlist) => sum + Math.max(0, Number(watchlist.itemCount || 0)),
    0,
  );
  const stackedHoldingRows = playerHoldings.filter((entry: any) =>
    Boolean(entry?.holding?.isStackedShare),
  ).length;
  const stackReadyHoldingRows = playerHoldings.filter((entry: any) => {
    const quantity = toNumericString(entry?.holding?.quantity);

    return !entry?.holding?.isStackedShare && quantity >= 4;
  }).length;
  const totalPlayerShares = playerHoldings.reduce(
    (sum: number, entry: any) => sum + toNumericString(entry?.holding?.quantity),
    0,
  );
  const activeDailyBoostSlots = activeBoosts.filter((boost) => boost.status !== "cancelled").length;
  const openDailyBoostSlots = Math.max(0, DAILY_BOOST_SLOT_COUNT - activeDailyBoostSlots);
  const topHoldings = [...playerHoldings]
    .sort(
      (left: any, right: any) =>
        toNumericString(right?.holding?.quantity) - toNumericString(left?.holding?.quantity),
    )
    .slice(0, 5)
    .map((entry: any) => {
      const quantity = toNumericString(entry?.holding?.quantity);
      const multiplier = toNumericString(entry?.holding?.multiplier || "1");
      const lockedQuantity =
        typeof entry?.totalLocked === "number"
          ? entry.totalLocked
          : toNumericString(entry?.totalLocked);
      const nextGame = upcomingGames.find(
        (game) =>
          game.sport === entry.player.sport &&
          (game.homeTeam === entry.player.team || game.awayTeam === entry.player.team),
      );

      return {
        playerId: entry.player.id,
        name: `${entry.player.firstName} ${entry.player.lastName}`,
        sport: entry.player.sport,
        shares: quantity,
        multiplier,
        availableShares: Math.max(0, quantity - lockedQuantity),
        nextGameAt: nextGame ? new Date(nextGame.startTime).toISOString() : null,
      };
    });
  const nextBestLevers: string[] = [];
  const knowledgeBrief = listAgentKnowledgeArticles(true);

  if (openDailyBoostSlots > 0 && playerHoldings.length > 0) {
    nextBestLevers.push(
      activeDailyBoostSlots === 0
        ? "fill a daily boost slot before lock"
        : `use the ${openDailyBoostSlots} open daily boost slot${openDailyBoostSlots === 1 ? "" : "s"} before lock`,
    );
  }

  if (Math.max(0, maxScouts - totalScouts) > 0) {
    const openScouts = Math.max(0, maxScouts - totalScouts);
    nextBestLevers.push(`deploy the ${openScouts} unassigned scout${openScouts === 1 ? "" : "s"}`);
  }

  if (communitySharesAvailable > 0) {
    nextBestLevers.push(
      `use ${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} on a live community boost`,
    );
  }

  if (stackReadyHoldingRows > 0) {
    nextBestLevers.push(
      `stack shares ${stackReadyHoldingRows} raw holding row${stackReadyHoldingRows === 1 ? "" : "s"} into stacked shares`,
    );
  }

  if (availableBalance >= 25) {
    nextBestLevers.push("deploy part of the idle play-money balance into a cleaner position");
  }

  return {
    generatedAt: now.toISOString(),
    analysisWindowMinutes: profile.analysisWindowMinutes,
    userPromptTemplate: profile.userPromptTemplate,
    maxScouts,
    totalScouts,
    remainingScouts: Math.max(0, maxScouts - totalScouts),
    defaultSport: profile.defaultSport,
    assignments: assignments.map((assignment) => ({
      playerId: assignment.playerId,
      name: assignment.player
        ? `${assignment.player.firstName} ${assignment.player.lastName}`
        : assignment.playerId,
      scoutCount: assignment.scoutCount,
      globalScoutCount: globalScoutCounts.get(assignment.playerId) || 0,
      sport: assignment.player?.sport || "NBA",
    })),
    candidates,
    selectionWindow,
    recommendedTargets,
    operatorOverview: {
      availableBalance,
      portfolioPlayerCount: playerHoldings.length,
      totalPlayerShares,
      stackedHoldingRows,
      stackReadyHoldingRows,
      watchlistCount: watchlists.length,
      watchlistEntryCount,
      communitySharesAvailable,
      activeDailyBoostSlots,
      openDailyBoostSlots,
      topHoldings,
      nextBestLevers,
    },
    knowledgeBrief,
  };
}
