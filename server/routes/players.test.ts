import express, { type RequestHandler } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPlayersRoutes, type RegisterPlayersRoutesDeps } from "./players";

function createTestServer() {
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    app,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function createDependencies(optionalAuth: RequestHandler): {
  deps: RegisterPlayersRoutesDeps;
  storage: RegisterPlayersRoutesDeps["storage"];
} {
  const storage: RegisterPlayersRoutesDeps["storage"] = {
    getPriceHistory: vi.fn().mockResolvedValue([]),
    getDailyGames: vi.fn().mockResolvedValue([]),
    getDailyGamesBySport: vi.fn().mockResolvedValue([]),
    getPlayersPaginated: vi.fn().mockResolvedValue({ players: [], total: 0 }),
    getBatchPlayerSeasonStatsFromLogs: vi.fn().mockResolvedValue(new Map()),
    getBatchSentiment: vi.fn().mockResolvedValue(new Map()),
    getBatchAllTimeAvgFantasyPoints: vi.fn().mockResolvedValue(new Map()),
    getBatchPlayerPriceChange24h: vi.fn().mockResolvedValue(new Map()),
    getBatchActiveScoutCounts: vi.fn().mockResolvedValue(new Map()),
    getBatchPoolData: vi.fn().mockResolvedValue(new Map()),
    getCommunityBoostsAllSports: vi.fn().mockResolvedValue([]),
  };

  const deps: RegisterPlayersRoutesDeps = {
    storage,
    optionalAuth,
    getTodayET: () => "2026-04-23",
    getETDayBoundaries: () => ({
      startOfDay: new Date("2026-04-23T04:00:00.000Z"),
      endOfDay: new Date("2026-04-24T04:00:00.000Z"),
    }),
    getMarketplaceGameStatus: () => "upcoming",
    enrichPlayerWithMarketValue: (player) => player,
    isAmmOnlyMode: true,
    getMlbPlayerPregameLookup: vi.fn().mockResolvedValue({
      probableStarterKeys: new Set<string>(),
      probableStarterContextByKey: new Map<string, unknown>(),
      matchupsByTeam: new Map<string, unknown>(),
    }),
    getMlbPitcherMatchupChip: vi.fn().mockReturnValue({
      isProbableStarter: false,
      probablePitcherGameId: null,
      mlbMatchupChip: null,
      mlbPregameSummary: null,
    }),
  };

  return { deps, storage };
}

describe("registerPlayersRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty payload for watchlist-scoped requests without an authenticated user", async () => {
    const { app, baseUrl, close } = createTestServer();
    const optionalAuth: RequestHandler = (_req, _res, next) => next();
    const { deps, storage } = createDependencies(optionalAuth);

    registerPlayersRoutes(app, deps);

    try {
      const response = await fetch(`${baseUrl}/api/players?isWatchlist=true`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ players: [], total: 0 });
      expect(storage.getPlayersPaginated).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("normalizes watchlist + sorting + ET date filters for authenticated player list requests", async () => {
    const { app, baseUrl, close } = createTestServer();
    const optionalAuth: RequestHandler = (req: any, _res, next) => {
      const headerUserId = req.headers["x-test-user-id"];
      if (typeof headerUserId === "string" && headerUserId.trim().length > 0) {
        req.user = { id: headerUserId, claims: { sub: headerUserId } };
      }
      next();
    };
    const { deps, storage } = createDependencies(optionalAuth);

    vi.mocked(storage.getDailyGames).mockResolvedValue([
      {
        homeTeam: "AAA",
        awayTeam: "BBB",
      } as any,
    ]);

    registerPlayersRoutes(app, deps);

    try {
      const response = await fetch(
        `${baseUrl}/api/players?isWatchlist=true&watchlistId=wl-42&sortBy=liquidity&sortOrder=asc&teamsPlayingOnDate=2026-04-23&limit=20&page=2&sport=NBA`,
        {
          headers: { "x-test-user-id": "user-42" },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ players: [], total: 0 });
      expect(storage.getPlayersPaginated).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          offset: 20,
          sortBy: "tvl",
          sortOrder: "asc",
          watchlistUserId: "user-42",
          watchlistId: "wl-42",
          teamsPlayingOnDate: ["AAA", "BBB"],
        }),
      );
      expect(storage.getBatchPoolData).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("serves sparkline points keyed by requested player id", async () => {
    const { app, baseUrl, close } = createTestServer();
    const optionalAuth: RequestHandler = (_req, _res, next) => next();
    const { deps, storage } = createDependencies(optionalAuth);

    vi.mocked(storage.getPriceHistory).mockImplementation(async (playerId) => [
      {
        timestamp: new Date("2026-04-23T12:00:00.000Z"),
        price: playerId === "p-1" ? "10.5" : "7.25",
      } as any,
    ]);

    registerPlayersRoutes(app, deps);

    try {
      const response = await fetch(`${baseUrl}/api/players/sparklines?ids=p-1,p-2&days=7`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        "p-1": [10.5],
        "p-2": [7.25],
      });
    } finally {
      await close();
    }
  });
});
