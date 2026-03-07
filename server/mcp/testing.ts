import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createServer } from "node:http";
import type { PublicMcpDependencies } from "./public-tool-registry";
import { createSportfolioMcpServer } from "../routes/mcp";

type MockPlayer = {
  id: string;
  firstName: string;
  lastName: string;
  sport: string;
  team: string;
  position: string;
  lastTradePrice: string;
  priceChange24h: string;
  isActive: boolean;
};

type MockThreadMessage = {
  id: string;
  role: "user" | "assistant";
  contentText: string;
  actionBundle?: Record<string, unknown> | null;
};

type MockThreadState = {
  id: string;
  title: string;
  channel: "cli" | "in_app" | "sms";
  domain: string;
  pendingActionBundle: Record<string, unknown> | null;
  messages: MockThreadMessage[];
  createdAt: string;
  updatedAt: string;
};

export type MockMcpHarness = {
  userId: string;
  deps: PublicMcpDependencies;
  state: {
    threads: Map<string, MockThreadState>;
    watchlists: Array<Record<string, unknown>>;
    schedules: Array<Record<string, unknown>>;
  };
};

export type MockMcpHttpServer = {
  harness: MockMcpHarness;
  authToken: string;
  url: string;
  close: () => Promise<void>;
};

const MOCK_USER_ID = "user_mcp_smoke";
const MOCK_NOW = "2026-03-07T14:00:00.000Z";

function createIsoNow() {
  return MOCK_NOW;
}

function buildThreadView(thread: MockThreadState) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  return {
    id: thread.id,
    title: thread.title,
    channel: thread.channel,
    domain: thread.domain,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessagePreview: lastMessage?.contentText || null,
    pendingActionBundle: thread.pendingActionBundle,
  };
}

function createBundle(id: string, summary: string, message: string) {
  return {
    id,
    status: "pending_confirmation",
    summary,
    warnings: [],
    actionPayload: [
      {
        actionType: "mock_action",
        message,
      },
    ],
  };
}

export function createMockPublicMcpDependencies(): MockMcpHarness {
  let threadCounter = 1;
  let bundleCounter = 1;
  let messageCounter = 1;
  let watchlistCounter = 2;

  const players: MockPlayer[] = [
    {
      id: "player_1",
      firstName: "Jalen",
      lastName: "Brunson",
      sport: "NBA",
      team: "NYK",
      position: "PG",
      lastTradePrice: "12.34",
      priceChange24h: "1.5",
      isActive: true,
    },
    {
      id: "player_2",
      firstName: "Anthony",
      lastName: "Edwards",
      sport: "NBA",
      team: "MIN",
      position: "SG",
      lastTradePrice: "10.12",
      priceChange24h: "-0.8",
      isActive: true,
    },
  ];

  const state = {
    threads: new Map<string, MockThreadState>(),
    watchlists: [
      {
        id: "watchlist_1",
        name: "Core Targets",
        color: "blue",
        items: ["player_1"],
      },
    ] as Array<Record<string, unknown>>,
    schedules: [
      {
        id: "schedule_1",
        jobType: "daily_digest",
        enabled: true,
        scheduleCron: "0 8 * * *",
        channelTargets: ["in_app"],
      },
    ] as Array<Record<string, unknown>>,
  };

  const seedThread: MockThreadState = {
    id: "thread_1",
    title: "Seed Thread",
    channel: "cli",
    domain: "sportfolio",
    pendingActionBundle: createBundle("bundle_1", "Pending staged action.", "stage preview"),
    messages: [
      {
        id: "message_1",
        role: "assistant",
        contentText: "Seed pending action.",
      },
    ],
    createdAt: createIsoNow(),
    updatedAt: createIsoNow(),
  };
  state.threads.set(seedThread.id, seedThread);
  bundleCounter = 2;
  messageCounter = 2;

  const holdings = [
    {
      id: "holding_1",
      playerId: "player_1",
      assetType: "player",
      quantity: 4,
      lockedQuantity: 0,
      power: 1,
      powerLevel: 4,
    },
    {
      id: "holding_community",
      playerId: "community",
      assetType: "community",
      quantity: 2,
      lockedQuantity: 0,
      power: 1,
      powerLevel: 2,
    },
  ];

  const holdingsWithPlayers = [
    {
      holding: holdings[0],
      player: players[0],
    },
  ];

  const games = [
    {
      gameId: "game_1",
      sport: "NBA",
      status: "scheduled",
      startTime: "2026-03-07T23:00:00.000Z",
      homeTeam: "NYK",
      awayTeam: "MIN",
      homeScore: 0,
      awayScore: 0,
    },
  ];

  const communityBoosts = [
    {
      id: "community_boost_1",
      playerId: "player_2",
      creatorId: "other_user",
      status: "active",
    },
  ];

  const dailyBoosts = [
    {
      id: "daily_boost_1",
      playerId: "player_1",
      gameId: "game_1",
      slotTier: 5,
      status: "active",
    },
  ];

  const storage = {
    getPlayers: async (filters?: Record<string, unknown>) => {
      const search = typeof filters?.search === "string" ? filters.search.toLowerCase() : "";
      const team = typeof filters?.team === "string" ? filters.team.toUpperCase() : "";
      const position = typeof filters?.position === "string" ? filters.position.toUpperCase() : "";
      return players.filter((player) => {
        const name = `${player.firstName} ${player.lastName}`.toLowerCase();
        return (
          (!search || name.includes(search)) &&
          (!team || player.team.toUpperCase() === team) &&
          (!position || player.position.toUpperCase() === position)
        );
      });
    },
    getUser: async () => ({
      id: MOCK_USER_ID,
      username: "mock_user",
      isPremium: false,
    }),
    getUserHoldings: async () => holdings,
    getUserHoldingsWithPlayers: async () => holdingsWithPlayers,
    getUserCommunityBoostShares: async () => 2,
    getCommunityBoostsAllSports: async () => communityBoosts,
    getDailyGames: async () => games,
    getDailyGamesBySport: async (sport: string) =>
      games.filter((game) => game.sport.toUpperCase() === sport.toUpperCase()),
    getFinancialMarketScanners: async () => ({
      momentum: [{ player: players[0] }],
      undervalued: [{ player: players[1] }],
      sentiment: [{ player: players[0] }],
    }),
    getScoutStatus: async () => ({
      earnedMinutes: 120,
      nextDistribution: "2026-03-07T15:00:00.000Z",
      perPlayer: {
        player_1: 60,
        player_2: 60,
      },
    }),
    getTotalScoutsForUser: async () => 2,
    getUserScoutAssignments: async () => [
      {
        playerId: "player_1",
        playerName: "Jalen Brunson",
        scoutCount: 2,
      },
    ],
    getScoutRoster: async () =>
      players.map((player) => ({
        playerId: player.id,
        playerName: `${player.firstName} ${player.lastName}`,
      })),
  } as unknown as PublicMcpDependencies["storage"];

  const deps = {
    storage,
    runHermesReadTool: async ({
      toolName,
      threadId,
      args,
    }: {
      toolName: string;
      threadId?: string | null;
      args?: Record<string, unknown>;
    }) => {
      switch (toolName) {
        case "get_balance_state":
          return {
            availableBalance: 314.96,
            openBoostSlots: [4, 3, 2],
            communitySharesAvailable: 2,
          };
        case "get_portfolio_summary":
          return {
            operatorOverview: {
              availableBalance: 314.96,
              topHoldings: [
                {
                  playerId: "player_1",
                  name: "Jalen Brunson",
                  shares: 4,
                },
              ],
            },
            selectionWindow: {
              sport: "NBA",
            },
            recommendedTargets: [
              {
                playerId: "player_1",
                name: "Jalen Brunson",
              },
            ],
          };
        case "get_holdings":
          return { holdings: holdingsWithPlayers };
        case "get_trade_history":
          return {
            trades: [
              {
                id: "trade_1",
                playerId: "player_1",
                side: "buy",
                amount: 25,
              },
            ],
          };
        case "get_portfolio_history":
          return {
            history: [
              {
                timestamp: createIsoNow(),
                value: 425.5,
              },
            ],
          };
        case "get_player_detail":
          return {
            player: players.find((player) => player.id === args?.playerId) || players[0],
          };
        case "get_player_stats":
          return {
            playerId: args?.playerId,
            stats: {
              fantasyPointsPerGame: 47.3,
            },
          };
        case "get_player_recent_games":
          return {
            playerId: args?.playerId,
            games,
          };
        case "get_player_financial_metrics":
          return {
            playerId: args?.playerId,
            metrics: {
              volatility: 0.14,
            },
          };
        case "get_player_shares_info":
          return {
            playerId: args?.playerId,
            totalShares: 4,
            lockedShares: 0,
            powerLevel: 4,
          };
        case "get_watchlists":
          return { watchlists: state.watchlists };
        case "get_watchlist_items": {
          const watchlistId =
            typeof args?.watchlistId === "string"
              ? args.watchlistId
              : (state.watchlists[0]?.id as string | undefined);
          const watchlist = state.watchlists.find((entry) => entry.id === watchlistId);
          const items = Array.isArray(watchlist?.items)
            ? watchlist.items.map((playerId) => ({
                playerId,
              }))
            : [];
          return {
            watchlistId,
            items,
          };
        }
        case "get_player_watchlists":
          return {
            playerId: args?.playerId,
            watchlists: state.watchlists.filter((entry) =>
              Array.isArray(entry.items) ? entry.items.includes(args?.playerId) : false,
            ),
          };
        case "get_holdings_power_level":
          return {
            playerId: args?.playerId,
            powerLevel: 4,
          };
        case "get_daily_boost_state":
          return {
            boosts: dailyBoosts,
          };
        case "get_daily_boost_eligibility":
          return {
            eligiblePlayers: [
              {
                playerId: "player_1",
                playerName: "Jalen Brunson",
                openSlots: [4, 3, 2],
              },
            ],
          };
        case "get_daily_boost_history":
          return {
            history: [
              {
                id: "daily_boost_history_1",
                payout: 12.5,
              },
            ],
          };
        case "get_community_boost_state":
          return {
            sharesAvailable: 2,
            boosts: communityBoosts,
          };
        case "get_lp_positions":
          return {
            positions: [
              {
                playerId: "player_1",
                lpShares: 1.5,
                playMoney: 25,
              },
            ],
          };
        case "get_lp_position":
          return {
            position: {
              playerId: args?.playerId,
              lpShares: 1.5,
              playMoney: 25,
            },
          };
        case "get_lp_history":
          return {
            history: [
              {
                id: "lp_history_1",
              },
            ],
          };
        case "get_amm_pool_state":
          return {
            playerId: args?.playerId,
            price: 12.34,
            liquidity: 1000,
          };
        case "get_amm_trade_quote":
          return {
            quote: {
              playerId: args?.playerId,
              type: args?.type,
              amount: args?.amount,
              estimatedShares: 2,
            },
          };
        case "get_user_schedules":
          return state.schedules;
        case "get_schedule_templates":
          return [
            {
              jobType: "daily_digest",
              description: "Daily digest template",
            },
          ];
        case "get_pending_bundle":
          return {
            pendingActionBundle: threadId
              ? state.threads.get(threadId)?.pendingActionBundle || null
              : null,
          };
        case "get_thread_state": {
          const thread = threadId ? state.threads.get(threadId) : null;
          return {
            thread: thread ? buildThreadView(thread) : null,
            messages: thread?.messages || [],
          };
        }
        case "get_hosted_research":
          return {
            summary: "Hosted research result.",
            citations: [
              {
                title: "Mock citation",
                url: "https://example.com/mock",
              },
            ],
          };
        default:
          return {
            summary: `Mock read response for ${toolName}.`,
          };
      }
    },
    runHermesScanTool: async ({ toolName }: { toolName: string }) => {
      switch (toolName) {
        case "scan_idle_balance_options":
          return {
            toolName,
            domain: "portfolio",
            intentFocus: "cash_deployment",
            summary: "Idle-capital deployment review.",
            replyText:
              "Use a direct buy if you have conviction, LP if you want steadier fee exposure, and hold some dry powder for later windows.",
            observations: ["$314.96 is currently uncommitted."],
            warnings: [],
            context: {
              availableBalance: 314.96,
              candidatePlayerId: "player_1",
            },
          };
        case "scan_daily_boost_candidates":
          return {
            toolName,
            domain: "boosts",
            summary: "Ranked daily boost candidates.",
            replyText:
              "Jalen Brunson is the best daily boost candidate and you still have open boost slots.",
            observations: ["3 open daily boost slots."],
            warnings: [],
            context: {
              openSlots: [4, 3, 2],
              candidates: [
                {
                  playerId: "player_1",
                  playerName: "Jalen Brunson",
                },
              ],
            },
          };
        case "scan_scout_opportunities":
          return {
            toolName,
            domain: "scouting",
            summary: "Ranked scout opportunities.",
            replyText: "Jalen Brunson and Anthony Edwards are the clearest scout targets.",
            observations: ["2 of 5 scouts assigned."],
            warnings: [],
            context: {
              recommendedTargets: players.map((player) => ({
                playerId: player.id,
                name: `${player.firstName} ${player.lastName}`,
              })),
            },
          };
        case "scan_top_market_opportunities":
          return {
            toolName,
            domain: "market",
            summary: "Ranked market opportunities.",
            replyText: "Jalen Brunson is the strongest near-term market opportunity.",
            observations: ["Momentum scanner is active on Jalen Brunson."],
            warnings: [],
            context: {
              candidates: [{ playerId: "player_1" }],
            },
          };
        case "scan_news_impact":
          return {
            toolName,
            domain: "research",
            summary: "Reviewed current news impact.",
            replyText: "No severe injury signal is hitting your current core holdings.",
            observations: ["News digest loaded successfully."],
            warnings: [],
            context: {},
          };
        case "scan_portfolio_cleanup_levers":
          return {
            toolName,
            domain: "portfolio",
            summary: "Reviewed portfolio cleanup levers.",
            replyText:
              "Your portfolio is fairly concentrated and could support condensing raw shares.",
            observations: ["One holding row can be condensed right now."],
            warnings: [],
            context: {},
          };
        default:
          return {
            toolName,
            domain: "general",
            summary: `Mock scan response for ${toolName}.`,
            replyText: `Mock scan response for ${toolName}.`,
            observations: [],
            warnings: [],
            context: {},
          };
      }
    },
    runHermesPlanTool: async ({
      toolName,
      args,
    }: {
      toolName: string;
      args?: Record<string, unknown>;
    }) => ({
      summary: `Preview ready for ${toolName}.`,
      canStage: true,
      stageMessage:
        `stage ${toolName} ${typeof args?.playerId === "string" ? args.playerId : ""}`.trim(),
      warnings: [],
      preview: args || {},
    }),
    runHermesActionTool: async ({
      toolName,
      args,
    }: {
      toolName: string;
      args?: Record<string, unknown>;
    }) => {
      switch (toolName) {
        case "create_watchlist": {
          const next = {
            id: `watchlist_${watchlistCounter++}`,
            name: args?.name || "New Watchlist",
            color: args?.color || "blue",
            items: [],
          };
          state.watchlists.push(next);
          return {
            summary: "Created watchlist.",
            watchlist: next,
          };
        }
        case "update_watchlist": {
          const watchlist = state.watchlists.find((entry) => entry.id === args?.watchlistId);
          if (watchlist) {
            if (typeof args?.name === "string") {
              watchlist.name = args.name;
            }
            if (typeof args?.color === "string") {
              watchlist.color = args.color;
            }
          }
          return {
            summary: "Updated watchlist.",
            watchlist,
          };
        }
        case "delete_watchlist":
          state.watchlists.splice(
            state.watchlists.findIndex((entry) => entry.id === args?.watchlistId),
            1,
          );
          return {
            summary: "Deleted watchlist.",
            watchlistId: args?.watchlistId,
          };
        case "add_watchlist_player": {
          const watchlist =
            state.watchlists.find((entry) => entry.id === args?.watchlistId) || state.watchlists[0];
          const items = Array.isArray(watchlist.items) ? watchlist.items : [];
          if (!items.includes(args?.playerId)) {
            items.push(args?.playerId);
          }
          watchlist.items = items;
          return {
            summary: "Added player to watchlist.",
            watchlist,
          };
        }
        case "remove_watchlist_player": {
          const watchlist =
            state.watchlists.find((entry) => entry.id === args?.watchlistId) || state.watchlists[0];
          watchlist.items = Array.isArray(watchlist.items)
            ? watchlist.items.filter((playerId) => playerId !== args?.playerId)
            : [];
          return {
            summary: "Removed player from watchlist.",
            watchlist,
          };
        }
        case "upsert_user_schedule": {
          const existing = state.schedules.find((entry) => entry.jobType === args?.jobType);
          if (existing) {
            Object.assign(existing, args);
            return {
              summary: "Updated schedule.",
              schedule: existing,
            };
          }
          const created = {
            id: `schedule_${state.schedules.length + 1}`,
            ...args,
          };
          state.schedules.push(created);
          return {
            summary: "Created schedule.",
            schedule: created,
          };
        }
        case "delete_user_schedule":
          state.schedules.splice(
            state.schedules.findIndex((entry) => entry.jobType === args?.jobType),
            1,
          );
          return {
            summary: "Deleted schedule.",
            jobType: args?.jobType,
          };
        default:
          return {
            summary: `Executed ${toolName}.`,
            args,
          };
      }
    },
    planDirectAgentOperation: async ({ message }: { message?: unknown }) => ({
      summary: "Setup review complete.",
      replyText:
        typeof message === "string" && message.toLowerCase().includes("idle balance")
          ? "Use direct buys or LP for idle cash and keep some dry powder."
          : "Your setup is balanced across market, boosts, and scouting.",
      observations: ["Mock planner executed."],
      warnings: [],
      actions: [],
      contextSnapshot: {
        intent:
          typeof message === "string" && message.toLowerCase().includes("idle balance")
            ? "idle_capital_review"
            : "setup_review",
      },
      trace: {
        framework: "mock",
      },
      pendingClarification: null,
      errorMessage: null,
      domain: "sportfolio",
      requestMessage: typeof message === "string" ? message : "",
    }),
    getScoutAgentProfile: async () => ({
      profile: {
        displayName: "Hermes",
        defaultSport: "NBA",
        providerMode: "managed",
      },
    }),
    createAgentThread: async (_userId: string, input: unknown) => {
      const threadInput = (input || {}) as Record<string, unknown>;
      const id = `thread_${threadCounter++}`;
      const thread: MockThreadState = {
        id,
        title: typeof threadInput.title === "string" ? threadInput.title : "MCP Thread",
        channel:
          typeof threadInput.channel === "string" &&
          ["cli", "in_app", "sms"].includes(threadInput.channel)
            ? (threadInput.channel as MockThreadState["channel"])
            : "cli",
        domain: typeof threadInput.domain === "string" ? threadInput.domain : "sportfolio",
        pendingActionBundle: null,
        messages: [],
        createdAt: createIsoNow(),
        updatedAt: createIsoNow(),
      };
      state.threads.set(id, thread);
      return buildThreadView(thread);
    },
    sendAgentThreadMessage: async (_userId: string, threadId: string, input: unknown) => {
      const messageInput = (input || {}) as Record<string, unknown>;
      const thread = state.threads.get(threadId);
      if (!thread) {
        throw new Error("Agent thread not found");
      }

      const messageText = typeof messageInput.message === "string" ? messageInput.message : "";
      const shouldStage = /^stage /i.test(messageText);
      const pendingBundle = shouldStage
        ? createBundle(
            `bundle_${bundleCounter++}`,
            `Pending action for ${messageText}.`,
            messageText,
          )
        : null;

      thread.pendingActionBundle = pendingBundle;
      thread.updatedAt = createIsoNow();
      const userMessage: MockThreadMessage = {
        id: `message_${messageCounter++}`,
        role: "user",
        contentText: messageText,
      };
      const assistantMessage: MockThreadMessage = {
        id: `message_${messageCounter++}`,
        role: "assistant",
        contentText: shouldStage
          ? `Staged action from "${messageText}".`
          : `Processed "${messageText}".`,
        actionBundle: pendingBundle,
      };
      thread.messages.push(userMessage, assistantMessage);

      return {
        thread: buildThreadView(thread),
        createdMessages: [assistantMessage],
        pendingActionBundle: pendingBundle,
        pendingClarification: null,
      };
    },
    confirmAgentThread: async (_userId: string, threadId: string) => {
      const thread = state.threads.get(threadId);
      if (!thread || !thread.pendingActionBundle) {
        throw new Error("No pending plan remains on this thread");
      }

      const appliedBundle = thread.pendingActionBundle;
      thread.pendingActionBundle = null;
      thread.updatedAt = createIsoNow();
      const assistantMessage: MockThreadMessage = {
        id: `message_${messageCounter++}`,
        role: "assistant",
        contentText: "Confirmed pending action bundle.",
        actionBundle: appliedBundle,
      };
      thread.messages.push(assistantMessage);

      return {
        thread: buildThreadView(thread),
        createdMessages: [assistantMessage],
        pendingActionBundle: null,
      };
    },
    cancelAgentThread: async (_userId: string, threadId: string) => {
      const thread = state.threads.get(threadId);
      if (!thread || !thread.pendingActionBundle) {
        throw new Error("No pending plan remains on this thread");
      }

      const cancelledBundle = thread.pendingActionBundle;
      thread.pendingActionBundle = null;
      thread.updatedAt = createIsoNow();
      const assistantMessage: MockThreadMessage = {
        id: `message_${messageCounter++}`,
        role: "assistant",
        contentText: "Cancelled pending action bundle.",
        actionBundle: cancelledBundle,
      };
      thread.messages.push(assistantMessage);

      return {
        thread: buildThreadView(thread),
        createdMessages: [assistantMessage],
        pendingActionBundle: null,
      };
    },
    getAgentThread: async (_userId: string, threadId: string) => {
      const thread = state.threads.get(threadId);
      if (!thread) {
        throw new Error("Agent thread not found");
      }
      return buildThreadView(thread);
    },
    listAgentThreadMessages: async (_userId: string, threadId: string) => {
      const thread = state.threads.get(threadId);
      return thread?.messages || [];
    },
    listAgentThreads: async () =>
      Array.from(state.threads.values()).map((thread) => buildThreadView(thread)),
    listDocsArticles: () => [
      {
        id: "doc_1",
        section: "agent",
        slug: "product-mechanics",
        title: "Product Mechanics",
        summary: "Gameplay overview",
      },
    ],
    searchDocsArticles: (query: string) => [
      {
        id: "doc_1",
        section: "agent",
        slug: "product-mechanics",
        title: "Product Mechanics",
        summary: `Search results for ${query}`,
        excerpt: "Gameplay overview",
      },
    ],
    getDocsArticle: (section: string, slug: string) => ({
      id: "doc_1",
      section,
      slug,
      title: "Product Mechanics",
      summary: "Gameplay overview",
      bodyMarkdown: "# Product Mechanics\n\nMock article body.",
    }),
    compileUserDigest: async () => ({
      generatedAt: createIsoNow(),
      items: [
        {
          title: "Mock digest headline",
        },
      ],
    }),
  } as unknown as PublicMcpDependencies;

  return {
    userId: MOCK_USER_ID,
    deps,
    state,
  };
}

export async function startMockMcpHttpServer(
  requiredAuthToken = "test-token",
): Promise<MockMcpHttpServer> {
  const harness = createMockPublicMcpDependencies();
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const authorization = req.header("authorization") || "";
    if (authorization !== `Bearer ${requiredAuthToken}`) {
      res.status(401).json({ message: "A valid Sportfolio API token is required" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    let mcpServer: Awaited<ReturnType<typeof createSportfolioMcpServer>> | null = null;
    try {
      mcpServer = await createSportfolioMcpServer(harness.userId, harness.deps);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[Mock MCP] Route error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        if (mcpServer) {
          void mcpServer.close();
        }
      });
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock MCP server did not expose a numeric port");
  }

  return {
    harness,
    authToken: requiredAuthToken,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
