import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { PublicMcpDependencies } from "./public-tool-registry";
import { createSportfolioMcpServer } from "../routes/mcp";
import { SportsAdapterRegistry } from "../sports/adapter-registry";
import type { ProviderMetadata } from "../sports/contracts";
import { getDocsArticle, listDocsArticles, searchDocsArticles } from "../docs-service";

type TransactionState = {
  transactionId: string;
  userId: string;
  status: "pending_confirmation" | "confirmed" | "cancelled";
  summary: string;
  warnings: string[];
  action: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MockMcpHarness = {
  userId: string;
  deps: PublicMcpDependencies;
  state: {
    user: Record<string, any>;
    players: Array<Record<string, any>>;
    watchlists: Array<Record<string, any>>;
    collections: Array<Record<string, any>>;
    milestones: Array<Record<string, any>>;
    apiTokens: Array<Record<string, any>>;
    transactions: Map<string, TransactionState>;
  };
};

export type MockMcpHttpServer = {
  harness: MockMcpHarness;
  authToken: string;
  url: string;
  close: () => Promise<void>;
};

type MockMcpSession = {
  transport: StreamableHTTPServerTransport;
  server: Awaited<ReturnType<typeof createSportfolioMcpServer>>;
};

const MOCK_USER_ID = "user_mcp_smoke";
const MOCK_NOW = "2026-08-06T16:00:00.000Z";
const provider: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: MOCK_NOW,
  staleAfterSeconds: 60,
  isStale: false,
};

function createMockSportsRegistry() {
  const registry = new SportsAdapterRegistry();
  registry.register({
    sport: "mlb",
    async searchAthletes(query) {
      return query.toLowerCase().includes("ohtani")
        ? [
            {
              id: "mlb_660271",
              sport: "mlb",
              name: "Shohei Ohtani",
              teamId: "mlb_team_119",
              position: "DH",
              active: true,
              provider,
            },
          ]
        : [];
    },
    async getAthlete(id) {
      return id === "mlb_660271"
        ? {
            id,
            sport: "mlb",
            name: "Shohei Ohtani",
            teamId: "mlb_team_119",
            position: "DH",
            active: true,
            provider,
          }
        : null;
    },
    async getTeams() {
      return [
        {
          id: "mlb_team_119",
          sport: "mlb",
          name: "Los Angeles Dodgers",
          abbreviation: "LAD",
          provider,
        },
      ];
    },
    async getSchedule() {
      return [
        {
          id: "mlb_game_1",
          sport: "mlb",
          startsAt: "2026-08-06T23:10:00.000Z",
          status: "scheduled",
          homeTeamId: "mlb_team_119",
          awayTeamId: "mlb_team_144",
          provider,
        },
      ];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "in_progress",
        clock: null,
        period: "5th",
        summary: "Top 5th",
        provider,
      };
    },
  });
  registry.register({
    sport: "nhl",
    async getSchedule() {
      return [];
    },
  });
  registry.register({
    sport: "nascar",
    async getSchedule() {
      return [];
    },
  });
  return registry;
}

function nativeReadResult(toolName: string) {
  switch (toolName) {
    case "get_balance_state":
      return { summary: "Loaded balance.", balance: 10000 };
    case "get_portfolio_summary":
      return { summary: "Loaded portfolio.", totalValue: 12500, cashBalance: 10000 };
    case "get_holdings":
      return { summary: "Loaded holdings.", holdings: [] };
    case "get_trade_history":
      return { summary: "Loaded trade history.", trades: [] };
    case "get_portfolio_history":
      return { summary: "Loaded portfolio history.", snapshots: [] };
    case "get_player_detail":
      return {
        summary: "Loaded player.",
        player: { id: "player_1", firstName: "Mock", lastName: "Player" },
      };
    case "get_player_stats":
      return { summary: "Loaded player stats.", stats: [] };
    case "get_player_recent_games":
      return { summary: "Loaded recent games.", games: [] };
    case "get_player_financial_metrics":
      return { summary: "Loaded metrics.", metrics: { price: 25 } };
    case "get_player_shares_info":
      return { summary: "Loaded share data.", shares: { available: 1000 } };
    case "get_watchlists":
      return {
        summary: "Loaded watchlists.",
        watchlists: [{ id: "watchlist_1", name: "Targets" }],
      };
    case "get_watchlist_items":
      return { summary: "Loaded watchlist items.", items: [{ playerId: "player_1" }] };
    case "get_player_watchlists":
      return { summary: "Loaded player watchlists.", watchlists: [{ id: "watchlist_1" }] };
    case "get_holding_multiplier_state":
      return { summary: "Loaded multiplier.", multiplier: 1 };
    case "get_daily_boost_state":
      return { summary: "Loaded boosts.", boosts: [] };
    case "get_daily_boost_history":
      return { summary: "Loaded boost history.", boosts: [] };
    case "get_daily_boost_eligibility":
      return { summary: "Loaded eligibility.", eligible: true };
    case "get_community_boost_state":
      return { summary: "Loaded community boosts.", boosts: [] };
    case "get_lp_positions":
      return { summary: "Loaded LP positions.", positions: [] };
    case "get_lp_position":
      return { summary: "Loaded LP position.", position: null };
    case "get_lp_history":
      return { summary: "Loaded LP history.", events: [] };
    case "get_amm_pool_state":
      return { summary: "Loaded pool.", pool: { playerId: "player_1", price: 25 } };
    case "get_amm_trade_quote":
      return { summary: "Loaded quote.", quote: { estimatedShares: 1 } };
    default:
      return { summary: `Loaded ${toolName}.`, data: {} };
  }
}

export function createMockPublicMcpDependencies(): MockMcpHarness {
  const state: MockMcpHarness["state"] = {
    user: {
      id: MOCK_USER_ID,
      username: "mock-user",
      email: "mock@example.com",
      balance: "10000.00",
      isPremium: true,
      premiumExpiresAt: null,
      profileImageUrl: null,
      hasSeenOnboarding: true,
      lastNewsViewedAt: null,
    },
    players: [
      {
        id: "player_1",
        firstName: "Mock",
        lastName: "Player",
        sport: "MLB",
        team: "ATL",
        position: "OF",
        lastTradePrice: "25.00",
        priceChange24h: "1.25",
        isActive: true,
      },
    ],
    watchlists: [{ id: "watchlist_1", userId: MOCK_USER_ID, name: "Targets" }],
    collections: [{ id: "collection_1", collectionType: "team", targetId: "NYK", completed: true }],
    milestones: [
      { id: "milestone_1", milestoneType: "netWorth", threshold: "100", celebrated: false },
    ],
    apiTokens: [
      {
        id: "token_1",
        label: "Existing token",
        tokenPrefix: "spt_mock",
        tokenLast4: "1234",
        createdAt: new Date(MOCK_NOW),
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    transactions: new Map<string, TransactionState>(),
  };

  const storage = {
    getPlayers: async ({ search }: { search?: string } = {}) =>
      search
        ? state.players.filter((player) =>
            `${player.firstName} ${player.lastName}`.toLowerCase().includes(search.toLowerCase()),
          )
        : state.players,
    getPlayersBySport: async (sport: string) =>
      state.players.filter((player) => player.sport === sport),
    getPlayer: async (id: string) => state.players.find((player) => player.id === id),
    getUser: async (id: string) => (id === MOCK_USER_ID ? state.user : undefined),
    getUserByUsername: async (username: string) =>
      state.user.username === username ? state.user : undefined,
    getHolding: async () => ({ quantity: 2 }),
    getWatchList: async () => ["player_1"],
    getUserHoldings: async () => [],
    getUserHoldingsWithPlayers: async () => [],
    getUserCommunityBoostShares: async () => 1,
    getCommunityBoostsAllSports: async () => [],
    getDailyGames: async () => [],
    getDailyGamesBySport: async () => [],
    getDailyBoostsAllSports: async () => [
      { id: "boost_1", playerId: "player_1", slotTier: 2, status: "active" },
    ],
    getFinancialMarketScanners: async () => [],
    getScoutStatus: async () => ({ earnedMinutes: 60, nextDistribution: MOCK_NOW, perPlayer: {} }),
    getTotalScoutsForUser: async () => 1,
    getUserScoutAssignments: async () => [{ playerId: "player_1", scoutCount: 1 }],
    getScoutRoster: async () => [],
    getWatchlists: async () => state.watchlists,
    getUserActivityFeed: async () => ({ items: [], total: 0, hasMore: false }),
    listUserApiTokens: async () => state.apiTokens,
    createUserApiToken: async (input: Record<string, unknown>) => {
      const token = {
        id: `token_${state.apiTokens.length + 1}`,
        ...input,
        createdAt: new Date(MOCK_NOW),
        lastUsedAt: null,
        revokedAt: null,
      };
      state.apiTokens.push(token);
      return token;
    },
    revokeUserApiToken: async (_userId: string, tokenId: string) => {
      const token = state.apiTokens.find((entry) => entry.id === tokenId);
      if (!token) return false;
      token.revokedAt = new Date(MOCK_NOW);
      return true;
    },
    markOnboardingComplete: async () => {
      state.user.hasSeenOnboarding = true;
    },
    updateUserPremiumStatus: async (_id: string, active: boolean) => {
      state.user.isPremium = active;
      return state.user;
    },
    getUserPremiumCheckoutSessions: async () => [],
    getActiveRewardedScoutBoostForUser: async () => null,
    updateUsername: async (_id: string, username: string) => {
      state.user.username = username;
      return state.user;
    },
    updateProfileImage: async (_id: string, url: string) => {
      state.user.profileImageUrl = url;
      return state.user;
    },
  } as unknown as PublicMcpDependencies["storage"];

  const deps: PublicMcpDependencies = {
    storage,
    runNativeReadTool: async ({ toolName }: any) => nativeReadResult(toolName),
    runNativeScanTool: async ({ toolName }: any) => ({
      summary: `Completed ${toolName}.`,
      results: [],
    }),
    runNativePlanTool: async ({ toolName }: any) => ({ summary: `Planned ${toolName}.`, plan: {} }),
    runNativeActionTool: async ({ toolName }: any) => ({
      summary: `Completed ${toolName}.`,
      success: true,
    }),
    stageGameplayTransaction: async ({ userId, action }: any) => {
      const transactionId = randomUUID();
      const transaction: TransactionState = {
        transactionId,
        userId,
        status: "pending_confirmation",
        summary: "Staged gameplay transaction.",
        warnings: [],
        action,
        createdAt: MOCK_NOW,
        updatedAt: MOCK_NOW,
      };
      state.transactions.set(transactionId, transaction);
      return transaction as any;
    },
    getGameplayTransaction: async (userId, transactionId) => {
      const transaction = state.transactions.get(transactionId);
      return transaction?.userId === userId ? (transaction as any) : null;
    },
    confirmGameplayTransaction: async (userId, transactionId) => {
      const transaction = state.transactions.get(transactionId);
      if (!transaction || transaction.userId !== userId) throw new Error("Transaction not found");
      transaction.status = "confirmed";
      transaction.updatedAt = MOCK_NOW;
      return transaction as any;
    },
    cancelGameplayTransaction: async (userId, transactionId) => {
      const transaction = state.transactions.get(transactionId);
      if (!transaction || transaction.userId !== userId) throw new Error("Transaction not found");
      transaction.status = "cancelled";
      transaction.updatedAt = MOCK_NOW;
      return transaction as any;
    },
    callMlbPublicTool: async (toolName, args) => ({
      summary: `Loaded MLB fixture for ${toolName}.`,
      data: { toolName, args, games: [], data: [] },
      warnings: [],
      provider: { name: "fixture", remoteTool: "fixture", requestId: "fixture-request" },
    }),
    getMlbProviderHealth: async () => ({
      configured: true,
      reachable: true,
      checkedAt: MOCK_NOW,
      requiredCapabilityCount: 11,
      availableCapabilityCount: 11,
      circuitOpen: false,
      lastErrorCode: null,
    }),
    listDocsArticles,
    searchDocsArticles,
    getDocsArticle,
    redeemPremiumShare: async () => ({
      success: true,
      isPremium: true,
      premiumExpiresAt: "2026-09-06T16:00:00.000Z",
      remainingShares: 1,
    }),
    getLeaderboardReadResponse: async (category: any, currentUserId?: string | null) => ({
      category,
      categoryLabel: "Net Worth",
      description: "Total virtual account value.",
      unit: "currency",
      updatedAt: MOCK_NOW,
      totalEntries: 1,
      leaderboard: [
        {
          rank: 1,
          userId: MOCK_USER_ID,
          username: state.user.username,
          profileImageUrl: null,
          value: 12500,
          rankChange: 0,
        },
      ],
      currentUser:
        currentUserId === MOCK_USER_ID
          ? {
              rank: 1,
              userId: MOCK_USER_ID,
              username: state.user.username,
              profileImageUrl: null,
              value: 12500,
              rankChange: 0,
            }
          : null,
      currentUserWindow: [],
    }),
    listCollections: async () => state.collections,
    getCollectionDetail: async (_userId, type, targetId) => {
      const collection = state.collections.find(
        (item) => item.collectionType === type && item.targetId === targetId,
      );
      return collection ? { collection, ownedPlayers: [] } : null;
    },
    listMilestones: async () => state.milestones,
    celebrateMilestone: async (_userId, id) => {
      const milestone = state.milestones.find((item) => item.id === id);
      if (!milestone) return false;
      milestone.celebrated = true;
      return true;
    },
    sportsRegistry: createMockSportsRegistry(),
  };

  return { userId: MOCK_USER_ID, deps, state };
}

export async function startMockMcpHttpServer(
  input: string | { authToken?: string; mlbTools?: unknown } = "test-token",
): Promise<MockMcpHttpServer> {
  const authToken = typeof input === "string" ? input : input.authToken || "test-token";
  const harness = createMockPublicMcpDependencies();
  const app = express();
  const sessions = new Map<string, MockMcpSession>();
  app.use(express.json());

  async function createSession() {
    const server = await createSportfolioMcpServer(harness.userId, harness.deps);
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId): void => {
        sessions.set(sessionId, { server, transport });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return { server, transport };
  }

  app.post("/mcp", async (req, res) => {
    if ((req.header("authorization") || "") !== `Bearer ${authToken}`) {
      res.status(401).json({ message: "A valid Sportfolio API token is required" });
      return;
    }
    const sessionId = req.header("mcp-session-id")?.trim() || null;
    const existing = sessionId ? sessions.get(sessionId) || null : null;
    if (sessionId && !existing) {
      res
        .status(404)
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      return;
    }
    const isInitialize = req.body && !Array.isArray(req.body) && req.body.method === "initialize";
    if (!existing && !isInitialize) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }
    const active = existing ?? (await createSession());
    await active.transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    if ((req.header("authorization") || "") !== `Bearer ${authToken}`)
      return void res.status(401).end();
    const session = sessions.get(req.header("mcp-session-id") || "");
    if (!session) return void res.status(404).end();
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    if ((req.header("authorization") || "") !== `Bearer ${authToken}`)
      return void res.status(401).end();
    const session = sessions.get(req.header("mcp-session-id") || "");
    if (!session) return void res.status(404).end();
    await session.transport.handleRequest(req, res);
  });

  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Mock MCP server failed to bind");

  return {
    harness,
    authToken,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await Promise.all(
        [...sessions.values()].map(({ transport }) => transport.close().catch(() => undefined)),
      );
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
