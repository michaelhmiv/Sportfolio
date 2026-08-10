import type { Express, RequestHandler } from "express";
import type { DatabaseStorage } from "../storage";
import {
  normalizeEtDateParam,
  normalizePlayersPagination,
  normalizePlayersSearchQuery,
  normalizePlayersSortField,
  normalizePlayersSortOrder,
  resolvePlayersWatchlistScope,
} from "./players-query";
import { normalizePlayerActivityFilter } from "../player-lifecycle";

type MarketplaceGameStatus = "none" | "upcoming" | "live" | "ended";

type MlbPregameLookup = {
  probableStarterKeys: Set<string>;
  probableStarterContextByKey: Map<string, unknown>;
  matchupsByTeam: Map<string, unknown>;
};

type MlbPitcherMatchupChip = {
  isProbableStarter: boolean;
  probablePitcherGameId: string | null;
  mlbMatchupChip: string | null;
  mlbPregameSummary: string | null;
};

type PlayersRouteStorage = Pick<
  DatabaseStorage,
  | "getPriceHistory"
  | "getDailyGames"
  | "getDailyGamesBySport"
  | "getPlayersPaginated"
  | "getBatchPlayerSeasonStatsFromLogs"
  | "getBatchSentiment"
  | "getBatchAllTimeAvgFantasyPoints"
  | "getBatchPlayerPriceChange24h"
  | "getBatchActiveScoutCounts"
  | "getBatchPoolData"
  | "getCommunityBoostsAllSports"
>;

export interface RegisterPlayersRoutesDeps {
  storage: PlayersRouteStorage;
  optionalAuth: RequestHandler;
  getTodayET: () => string;
  getETDayBoundaries: (gameDay: string) => { startOfDay: Date; endOfDay: Date };
  getMarketplaceGameStatus: (...args: any[]) => MarketplaceGameStatus;
  enrichPlayerWithMarketValue: (player: any) => any;
  getMlbPlayerPregameLookup: (...args: any[]) => Promise<MlbPregameLookup>;
  getMlbPitcherMatchupChip: (...args: any[]) => MlbPitcherMatchupChip;
  getCanonicalPlayerMarkets?: (playerIds: string[]) => Promise<Map<string, any>>;
}

export function registerPlayersRoutes(app: Express, deps: RegisterPlayersRoutesDeps): void {
  const {
    storage,
    optionalAuth,
    getTodayET,
    getETDayBoundaries,
    getMarketplaceGameStatus,
    enrichPlayerWithMarketValue,
    getMlbPlayerPregameLookup,
    getMlbPitcherMatchupChip,
    getCanonicalPlayerMarkets,
  } = deps;

  // Batch price sparklines for multiple players - powers mini-sparkline UX in the marketplace
  app.get("/api/players/sparklines", async (req, res) => {
    try {
      const raw = typeof req.query.ids === "string" ? req.query.ids : "";
      const days = Math.min(365, Math.max(1, parseInt((req.query.days as string) || "7", 10)));
      const withDates = req.query.dates === "true";
      const ids = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 50); // cap at 50 players per request

      if (ids.length === 0) {
        return res.json({});
      }

      // Fetch price history for all requested players in parallel.
      const results = await Promise.all(
        ids.map(async (playerId) => {
          const rows = await storage.getPriceHistory(playerId, days);
          if (withDates) {
            return {
              playerId,
              points: rows.map((row) => ({
                date: row.timestamp.toISOString(),
                price: parseFloat(row.price),
              })),
            };
          }
          return {
            playerId,
            points: rows.map((row) => parseFloat(row.price)),
          };
        }),
      );

      const out: Record<string, any> = {};
      for (const { playerId, points } of results) {
        out[playerId] = points;
      }
      res.json(out);
    } catch (error: any) {
      console.error("[sparklines]", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all players with advanced filtering.
  app.get("/api/players", optionalAuth, async (req: any, res) => {
    try {
      const { team, position, sortBy, sortOrder, teamsPlayingOnDate, sport } = req.query;
      const activity = normalizePlayerActivityFilter(req.query.activity);
      const rawSearch = normalizePlayersSearchQuery({
        q: req.query.q,
        search: req.query.search,
      });
      const { limit: safeLimit, offset: safeOffset } = normalizePlayersPagination({
        limit: req.query.limit,
        offset: req.query.offset,
        page: req.query.page,
      });
      const safeSortBy = normalizePlayersSortField(sortBy);
      const safeSortOrder = normalizePlayersSortOrder(sortOrder);
      const watchlistScope = resolvePlayersWatchlistScope({
        isWatchlist: req.query.isWatchlist,
        watchlistId: req.query.watchlistId,
        requestUser: req.user,
      });

      if (watchlistScope.isUnauthorized) {
        // Preserve current behavior: watchlist requests without auth resolve to empty result.
        return res.json({ players: [], total: 0 });
      }

      // Handle teams playing on date filter.
      let teamsPlayingFilter: string[] | undefined;
      const teamsPlayingDate = normalizeEtDateParam(teamsPlayingOnDate);
      if (teamsPlayingDate) {
        const { startOfDay, endOfDay } = getETDayBoundaries(teamsPlayingDate);
        const games = await storage.getDailyGames(startOfDay, endOfDay);

        const teamsSet = new Set<string>();
        games.forEach((game: any) => {
          teamsSet.add(game.homeTeam);
          teamsSet.add(game.awayTeam);
        });
        teamsPlayingFilter = Array.from(teamsSet);
      }

      const { players: playersRaw, total } = await storage.getPlayersPaginated({
        search: rawSearch,
        team: team as string,
        position: position as string,
        sport: sport as string,
        activity,
        limit: safeLimit,
        offset: safeOffset,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
        teamsPlayingOnDate: teamsPlayingFilter,
        watchlistUserId: watchlistScope.watchlistUserId,
        watchlistId: watchlistScope.scopedWatchlistId,
      });

      if (playersRaw.length === 0) {
        return res.json({ players: [], total });
      }

      // Enrich only the returned page to keep response latency bounded.
      const playerIds = playersRaw.map((player: any) => player.id);
      const todayET = getTodayET();
      const { startOfDay, endOfDay } = getETDayBoundaries(todayET);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const [
        seasonStatsMap,
        sentimentMap,
        avgFantasyPointsMap,
        priceChange24hMap,
        globalScoutMap,
        poolDataMap,
        todaysGames,
        communityBoosts,
        canonicalMarkets,
      ] = await Promise.all([
        storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
        storage.getBatchSentiment(playerIds),
        storage.getBatchAllTimeAvgFantasyPoints(playerIds),
        storage.getBatchPlayerPriceChange24h(playerIds),
        storage.getBatchActiveScoutCounts(playerIds),
        storage.getBatchPoolData(playerIds),
        sport && typeof sport === "string" && sport.toUpperCase() !== "ALL"
          ? storage.getDailyGamesBySport(sport.toUpperCase(), startOfDay, endOfDay)
          : storage.getDailyGames(startOfDay, endOfDay),
        storage.getCommunityBoostsAllSports(targetDate),
        getCanonicalPlayerMarkets
          ? getCanonicalPlayerMarkets(playerIds)
          : Promise.resolve(new Map()),
      ]);

      const teamGameMap = new Map<
        string,
        {
          gameId: string;
          homeTeam: string;
          awayTeam: string;
          status: MarketplaceGameStatus;
          startTime: string | null;
        }
      >();
      todaysGames.forEach((game: any) => {
        const gameContext = {
          gameId: game.gameId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          status: getMarketplaceGameStatus(game),
          startTime: game.startTime ? new Date(game.startTime).toISOString() : null,
        };
        teamGameMap.set(game.homeTeam, gameContext);
        teamGameMap.set(game.awayTeam, gameContext);
      });

      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach((boost: any) => {
        const current = communityBoostMap.get(boost.playerId) || 0;
        communityBoostMap.set(boost.playerId, current + 1);
      });

      const hasMlbPlayersOnPage = playersRaw.some(
        (player: any) => String(player.sport || "").toUpperCase() === "MLB",
      );
      const mlbPregameLookup = hasMlbPlayersOnPage
        ? await getMlbPlayerPregameLookup(todaysGames, todayET)
        : {
            probableStarterKeys: new Set<string>(),
            probableStarterContextByKey: new Map<string, unknown>(),
            matchupsByTeam: new Map<string, unknown>(),
          };

      const players = playersRaw.map((player: any) => {
        const enriched = enrichPlayerWithMarketValue(player);
        const seasonStats = seasonStatsMap.get(player.id) || {
          gamesPlayed: 0,
          avgFantasyPointsPerGame: "0.0",
        };
        const sentimentData = sentimentMap.get(player.id) || {
          buyPressure: 50,
          totalVolume24h: 0,
        };
        const poolData = poolDataMap.get(player.id);
        const market = canonicalMarkets.get(player.id);
        const ammSpotPrice = market
          ? market.marketPrice
          : poolData && poolData.shares > 0 && poolData.playMoney > 0
            ? poolData.playMoney / poolData.shares
            : null;

        const leagueAvgPe = 0.43;
        const price = ammSpotPrice ?? 0;
        const avgFP = avgFantasyPointsMap.get(player.id) || 0;
        const peRatio = avgFP > 0 ? price / avgFP : 0;
        const derivedValueIndex = leagueAvgPe > 0 ? (peRatio / leagueAvgPe) * 100 : 0;

        const metricBuyPressure =
          player._metricBuyPressure != null ? parseFloat(player._metricBuyPressure) : null;
        const metricValueIndex =
          player._metricValueIndex != null ? parseFloat(player._metricValueIndex) : null;
        const metricAvgFantasyPoints =
          player._metricAvgFantasyPoints != null
            ? parseFloat(player._metricAvgFantasyPoints)
            : null;

        const poolTvl =
          poolData?.shares && poolData.shares > 0
            ? poolData.playMoney * 2
            : (poolData?.playMoney ?? 0);
        const gameContext = teamGameMap.get(player.team);
        const priceChange24h = (priceChange24hMap.get(player.id) || 0).toFixed(2);
        const mlbPregameContext =
          String(player.sport || "").toUpperCase() === "MLB"
            ? getMlbPitcherMatchupChip({
                playerName: `${player.firstName} ${player.lastName}`.trim(),
                playerTeam: player.team,
                playerPosition: player.position,
                probableStarterKeys: mlbPregameLookup.probableStarterKeys,
                probableStarterContextByKey: mlbPregameLookup.probableStarterContextByKey,
                matchupsByTeam: mlbPregameLookup.matchupsByTeam,
              })
            : {
                isProbableStarter: false,
                probablePitcherGameId: null,
                mlbMatchupChip: null,
                mlbPregameSummary: null,
              };

        return {
          ...enriched,
          marketStatus: market?.marketStatus || (ammSpotPrice !== null ? "priced" : "unpriced"),
          marketPrice: ammSpotPrice,
          priceSource: ammSpotPrice !== null ? "amm_spot" : null,
          currentPrice: ammSpotPrice !== null ? ammSpotPrice.toFixed(2) : null,
          marketCap: market?.marketCap?.toFixed(2) ?? null,
          poolInitialized: market?.poolInitialized ?? Boolean(poolData),
          priceChange24h,
          avgFantasyPointsPerGame: (
            metricAvgFantasyPoints ?? parseFloat(seasonStats.avgFantasyPointsPerGame || "0")
          ).toFixed(1),
          buyPressure: metricBuyPressure ?? sentimentData.buyPressure,
          valueIndex: metricValueIndex ?? derivedValueIndex,
          globalScoutCount: globalScoutMap.get(player.id) || 0,
          poolLiquidity: poolData?.playMoney || 0,
          poolTvl,
          poolShares: poolData?.shares || 0,
          poolTotalTrades: poolData?.totalTrades || 0,
          hasGameToday: Boolean(gameContext),
          gameStatus: gameContext?.status || "none",
          gameStartTime: gameContext?.startTime || null,
          communityBoostCount: communityBoostMap.get(player.id) || 0,
          isProbableStarter: mlbPregameContext.isProbableStarter,
          probablePitcherGameId: mlbPregameContext.probablePitcherGameId,
          mlbMatchupChip: mlbPregameContext.mlbMatchupChip,
          mlbPregameSummary: mlbPregameContext.mlbPregameSummary,
        };
      });

      res.json({ players, total });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
