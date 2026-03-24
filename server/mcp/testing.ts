import { randomUUID } from "node:crypto";
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
    collections: Array<Record<string, unknown>>;
    milestones: Array<Record<string, unknown>>;
    apiTokens: Array<Record<string, unknown>>;
    smsLink: Record<string, unknown> | null;
    agentProfile: Record<string, unknown>;
    user: Record<string, unknown>;
    premiumShares: number;
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
  let tokenCounter = 2;

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
        jobType: "daily_setup_review",
        enabled: true,
        scheduleCron: "0 8 * * *",
        channelTargets: ["in_app"],
      },
    ] as Array<Record<string, unknown>>,
    collections: [
      {
        id: "collection_1",
        userId: MOCK_USER_ID,
        collectionType: "team",
        targetId: "NYK",
        completed: true,
        updatedAt: createIsoNow(),
      },
    ] as Array<Record<string, unknown>>,
    milestones: [
      {
        id: "milestone_1",
        userId: MOCK_USER_ID,
        milestoneType: "netWorth",
        threshold: "100",
        celebrated: false,
        achievedAt: createIsoNow(),
      },
    ] as Array<Record<string, unknown>>,
    apiTokens: [
      {
        id: "token_1",
        label: "Existing token",
        tokenPrefix: "spt_mock",
        tokenLast4: "1234",
        createdAt: createIsoNow(),
        lastUsedAt: null,
        revokedAt: null,
      },
    ] as Array<Record<string, unknown>>,
    smsLink: {
      id: "sms_link_1",
      phoneE164: "+15555550123",
      verifiedAt: createIsoNow(),
      linkedAt: createIsoNow(),
      lastInboundAt: null,
      lastOutboundAt: null,
      smsEnabled: true,
      smsOptInStatus: "opted_in",
      smsOptInSource: "web_link",
    } as Record<string, unknown> | null,
    agentProfile: {
      profile: {
        id: "agent_profile_1",
        enabled: true,
        displayName: "Mock Agent",
        providerMode: "managed",
        model: "gpt-4.1-mini",
        systemPrompt: "",
        userPromptTemplate: "",
        temperature: "0.7",
        maxTokens: 1200,
        analysisWindowMinutes: 120,
        defaultSport: "NBA",
      },
      secret: null,
      managedProvider: {
        defaultModel: "gpt-4.1-mini",
      },
      capabilities: {
        canAnalyze: true,
        canAutoExecute: false,
        canUseWebResearch: true,
        webResearchProvider: "hosted",
        runtime: "hermes",
        hasDurableMemory: true,
        canScheduleAdvisories: true,
      },
    } as Record<string, unknown>,
    user: {
      id: MOCK_USER_ID,
      username: "mock_user",
      email: "mock@example.com",
      balance: "314.96",
      isPremium: false,
      premiumExpiresAt: null,
      profileImageUrl: "https://example.com/mock.png",
      hasSeenOnboarding: false,
      lastNewsViewedAt: "2026-03-06T14:00:00.000Z",
    } as Record<string, unknown>,
    premiumShares: 2,
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
      multiplier: 1,
      effectiveShares: 4,
    },
    {
      id: "holding_community",
      playerId: "community",
      assetType: "community",
      quantity: 2,
      lockedQuantity: 0,
      multiplier: 1,
      effectiveShares: 2,
    },
    {
      id: "holding_premium",
      playerId: "premium",
      assetType: "premium",
      quantity: state.premiumShares,
      lockedQuantity: 0,
      multiplier: 1,
      effectiveShares: state.premiumShares,
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
    getPlayer: async (playerId: string) => players.find((player) => player.id === playerId),
    getUser: async () => state.user,
    getUserByUsername: async (username: string) =>
      state.user.username === username ? state.user : null,
    getHolding: async (_userId: string, assetType: string, assetId: string) =>
      holdings.find((holding) => holding.assetType === assetType && holding.playerId === assetId),
    getWatchList: async () =>
      state.watchlists.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : [])),
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
    getWatchlists: async () => state.watchlists,
    getUserActivityFeed: async () => ({
      items: [
        {
          id: "activity_1",
          category: "market",
          title: "Bought Jalen Brunson",
          createdAt: createIsoNow(),
        },
      ],
      total: 1,
      hasMore: false,
      nextOffset: null,
    }),
    listUserApiTokens: async () => state.apiTokens,
    createUserApiToken: async (token: Record<string, unknown>) => {
      const created = {
        id: `token_${tokenCounter++}`,
        createdAt: createIsoNow(),
        lastUsedAt: null,
        revokedAt: null,
        ...token,
      };
      state.apiTokens.push(created);
      return created;
    },
    revokeUserApiToken: async (_userId: string, tokenId: string) => {
      const token = state.apiTokens.find((entry) => entry.id === tokenId);
      if (!token) {
        return false;
      }
      token.revokedAt = createIsoNow();
      return true;
    },
    markOnboardingComplete: async () => {
      state.user.hasSeenOnboarding = true;
    },
    getUserPremiumCheckoutSessions: async () => [
      {
        id: "premium_session_1",
        status: "completed",
        createdAt: createIsoNow(),
      },
    ],
    updateUsername: async (_userId: string, username: string) => {
      state.user.username = username;
      return state.user;
    },
    updateProfileImage: async (_userId: string, imageUrl: string) => {
      state.user.profileImageUrl = imageUrl;
      return state.user;
    },
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
            effectiveShares: 4,
            multiplier: 1,
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
        case "get_holding_multiplier_state":
          return {
            playerId: args?.playerId,
            effectiveShares: 4,
            multiplier: 4,
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
              jobType: "daily_setup_review",
              description: "Daily setup review template",
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
            observations: ["One holding row can be stacked right now."],
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
    }) => {
      if (toolName === "preview_lp_add_optimal") {
        if (typeof args?.maxShares !== "number" || typeof args?.maxPlayMoney !== "number") {
          throw new Error("preview_lp_add_optimal requires maxShares and maxPlayMoney");
        }
      }

      return {
        summary: `Preview ready for ${toolName}.`,
        canStage: true,
        stageMessage:
          `stage ${toolName} ${typeof args?.playerId === "string" ? args.playerId : ""}`.trim(),
        warnings: [],
        preview: args || {},
      };
    },
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
    getScoutAgentProfile: async () => state.agentProfile,
    getAgentCapabilities: async () => ({
      domains: ["market", "boosts", "scouting"],
      actionTypes: ["trade", "boost", "watchlist"],
      canAnalyze: true,
      canAutoExecute: false,
      canUseWebResearch: true,
      webResearchProvider: "hosted",
      providerMode: ((state.agentProfile.profile as Record<string, unknown>)?.providerMode ??
        "managed") as string,
      runtime: "hermes",
      hasDurableMemory: true,
      canScheduleAdvisories: true,
    }),
    updateScoutAgentProfile: async (_userId: string, input: unknown) => {
      state.agentProfile = {
        ...state.agentProfile,
        profile: {
          ...(state.agentProfile.profile as Record<string, unknown>),
          ...((input || {}) as Record<string, unknown>),
        },
      };
      return state.agentProfile;
    },
    saveScoutAgentByok: async (_userId: string, input: unknown) => {
      const payload = (input || {}) as Record<string, unknown>;
      state.agentProfile = {
        ...state.agentProfile,
        profile: {
          ...(state.agentProfile.profile as Record<string, unknown>),
          providerMode: "byok",
          baseUrl: payload.baseUrl,
          model: payload.model,
        },
        secret: {
          keyLast4: typeof payload.apiKey === "string" ? payload.apiKey.slice(-4) : "mock",
        },
      };
      return state.agentProfile;
    },
    clearScoutAgentByok: async () => {
      state.agentProfile = {
        ...state.agentProfile,
        profile: {
          ...(state.agentProfile.profile as Record<string, unknown>),
          providerMode: "managed",
        },
        secret: null,
      };
      return state.agentProfile;
    },
    createUserApiTokenMaterial: () => ({
      plaintextToken: "spt_mock_token_material",
      tokenHash: "mock_hash",
      tokenPrefix: "spt_mock",
      tokenLast4: "4321",
    }),
    getSmsSettings: async () => state.smsLink,
    updateSmsSettings: async (_userId: string, smsEnabled: boolean) => {
      if (!state.smsLink) {
        return null;
      }
      state.smsLink.smsEnabled = smsEnabled;
      state.smsLink.smsOptInStatus = smsEnabled ? "opted_in" : "opted_out";
      return state.smsLink;
    },
    startSmsPhoneLink: async (_userId: string, phone: string) => ({
      phoneE164: phone,
      expiresAt: createIsoNow(),
    }),
    completeSmsPhoneLink: async (_userId: string, token: string) => {
      state.smsLink = {
        ...(state.smsLink || {}),
        id: "sms_link_1",
        phoneE164: "+15555550123",
        verifiedAt: createIsoNow(),
        linkedAt: createIsoNow(),
        lastInboundAt: null,
        lastOutboundAt: null,
        smsEnabled: true,
        smsOptInStatus: "opted_in",
        smsOptInSource: "web_link",
        completedToken: token,
      };
      return state.smsLink;
    },
    redeemPremiumShare: async () => {
      if (state.premiumShares < 1) {
        throw new Error("No premium shares to redeem");
      }
      state.premiumShares -= 1;
      state.user.isPremium = true;
      state.user.premiumExpiresAt = createIsoNow();
      const premiumHolding = holdings.find(
        (holding) => holding.assetType === "premium" && holding.playerId === "premium",
      );
      if (premiumHolding) {
        premiumHolding.quantity = state.premiumShares;
        premiumHolding.effectiveShares = state.premiumShares;
      }
      return {
        success: true,
        isPremium: true,
        premiumExpiresAt: state.user.premiumExpiresAt,
        remainingShares: state.premiumShares,
      };
    },
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
    stageAgentThreadBundle: async (input: {
      threadId?: string | null;
      summary: string;
      replyText?: string | null;
      requestMessage?: string | null;
      actions: Array<Record<string, unknown>>;
      warnings?: string[];
      domain?: string;
      title?: string | null;
      channel?: string;
    }) => {
      const threadId = input.threadId?.trim() || `thread_${threadCounter++}`;
      const thread =
        state.threads.get(threadId) ||
        ({
          id: threadId,
          title: input.title?.trim() || "MCP Thread",
          channel:
            typeof input.channel === "string" && ["cli", "in_app", "sms"].includes(input.channel)
              ? (input.channel as MockThreadState["channel"])
              : "cli",
          domain: input.domain || "sportfolio",
          pendingActionBundle: null,
          messages: [],
          createdAt: createIsoNow(),
          updatedAt: createIsoNow(),
        } satisfies MockThreadState);

      state.threads.set(threadId, thread);
      const pendingBundle = {
        id: `bundle_${bundleCounter++}`,
        status: "pending_confirmation",
        summary: input.summary,
        warnings: Array.isArray(input.warnings) ? input.warnings : [],
        actions: Array.isArray(input.actions) ? input.actions : [],
      };
      thread.pendingActionBundle = pendingBundle;
      thread.updatedAt = createIsoNow();

      if (input.requestMessage?.trim()) {
        thread.messages.push({
          id: `message_${messageCounter++}`,
          role: "user",
          contentText: input.requestMessage.trim(),
        });
      }

      const assistantMessage: MockThreadMessage = {
        id: `message_${messageCounter++}`,
        role: "assistant",
        contentText: input.replyText?.trim() || input.summary,
        actionBundle: pendingBundle,
      };
      thread.messages.push(assistantMessage);

      return {
        thread: buildThreadView(thread),
        createdMessages: [assistantMessage],
        pendingActionBundle: pendingBundle,
        pendingClarification: null,
      };
    },
    confirmAgentThread: async (
      _userId: string,
      threadId: string,
      pendingBundleId?: string | null,
    ) => {
      const thread = state.threads.get(threadId);
      if (!pendingBundleId) {
        throw new Error("pendingBundleId is required for confirmAgentThread");
      }
      if (
        !thread ||
        !thread.pendingActionBundle ||
        thread.pendingActionBundle.id !== pendingBundleId
      ) {
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
    cancelAgentThread: async (
      _userId: string,
      threadId: string,
      pendingBundleId?: string | null,
    ) => {
      const thread = state.threads.get(threadId);
      if (!pendingBundleId) {
        throw new Error("pendingBundleId is required for cancelAgentThread");
      }
      if (
        !thread ||
        !thread.pendingActionBundle ||
        thread.pendingActionBundle.id !== pendingBundleId
      ) {
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
    listAgentThreadResearchSources: async () => [],
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
    listCollections: async () => state.collections,
    getCollectionDetail: async (_userId: string, type: string, targetId: string) => {
      const collection =
        state.collections.find(
          (entry) => entry.collectionType === type && entry.targetId === targetId,
        ) || null;
      if (!collection) {
        return null;
      }

      return {
        collection,
        ownedPlayers:
          type === "team"
            ? [
                {
                  playerId: "player_1",
                  firstName: "Jalen",
                  lastName: "Brunson",
                  position: "PG",
                  team: targetId,
                  quantity: 4,
                },
              ]
            : [],
      };
    },
    listMilestones: async () => state.milestones,
    celebrateMilestone: async (_userId: string, milestoneId: string) => {
      const milestone = state.milestones.find((entry) => entry.id === milestoneId);
      if (!milestone) {
        return false;
      }
      milestone.celebrated = true;
      return true;
    },
    markNewsRead: async () => {
      state.user.lastNewsViewedAt = createIsoNow();
    },
    getNewsUnreadCount: async () => ({
      count: 3,
      digestCount: 1,
      hasUnreadDigest: true,
      digestReleaseAt: new Date(createIsoNow()),
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
  const sessions = new Map<string, MockMcpSession>();
  app.use(express.json());

  function getSessionId(req: express.Request) {
    const sessionId = req.header("mcp-session-id");
    return sessionId?.trim() || null;
  }

  function isInitializeBody(body: unknown): boolean {
    return (
      !!body &&
      !Array.isArray(body) &&
      typeof body === "object" &&
      (body as { method?: unknown }).method === "initialize"
    );
  }

  async function createSession() {
    const server = await createSportfolioMcpServer(harness.userId, harness.deps);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (createdSessionId) => {
        sessions.set(createdSessionId, {
          server,
          transport,
        });
      },
    });

    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) {
        sessions.delete(closedSessionId);
      }
    };

    await server.connect(transport);
    return {
      server,
      transport,
    } satisfies MockMcpSession;
  }

  app.post("/mcp", async (req, res) => {
    const authorization = req.header("authorization") || "";
    if (authorization !== `Bearer ${requiredAuthToken}`) {
      res.status(401).json({ message: "A valid Sportfolio API token is required" });
      return;
    }

    const sessionId = getSessionId(req);
    const session = sessionId ? sessions.get(sessionId) || null : null;
    if (sessionId && !session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found",
        },
        id: null,
      });
      return;
    }

    if (!session && !isInitializeBody(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    try {
      const activeSession = session ?? (await createSession());
      await activeSession.transport.handleRequest(req, res, req.body);
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
    }
  });

  app.get("/mcp", async (req, res) => {
    const authorization = req.header("authorization") || "";
    if (authorization !== `Bearer ${requiredAuthToken}`) {
      res.status(401).json({ message: "A valid Sportfolio API token is required" });
      return;
    }

    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found",
        },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const authorization = req.header("authorization") || "";
    if (authorization !== `Bearer ${requiredAuthToken}`) {
      res.status(401).json({ message: "A valid Sportfolio API token is required" });
      return;
    }

    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found",
        },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res);
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
        Promise.all(
          Array.from(sessions.values()).map(async ({ server: mcpServer }) => mcpServer.close()),
        )
          .catch(() => undefined)
          .finally(() => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });
      }),
  };
}
