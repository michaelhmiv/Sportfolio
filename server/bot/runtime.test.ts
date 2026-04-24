import { afterEach, describe, expect, it } from "vitest";
import { __botRuntime } from "./runtime";

const originalBotCycleMinutes = process.env.BOT_ENGINE_CYCLE_MINUTES;
const originalBotsPerTick = process.env.BOT_ENGINE_BOTS_PER_TICK;
const originalSpreadPolicyEnabled = process.env.BOT_SPREAD_POLICY_ENABLED;
const originalSpreadPolicyWindow = process.env.BOT_SPREAD_POLICY_WINDOW_HOURS;
const originalSpreadPolicyCap = process.env.BOT_SPREAD_POLICY_PLAYER_CAP_PER_WINDOW;
const originalSpreadPolicyCooldown = process.env.BOT_SPREAD_POLICY_PLAYER_COOLDOWN_HOURS;
const originalSpreadPolicySportMinShare = process.env.BOT_SPREAD_POLICY_SPORT_MIN_SHARE;
const originalSpreadPolicySportMaxShare = process.env.BOT_SPREAD_POLICY_SPORT_MAX_SHARE;
const originalSpreadPolicyMinPools = process.env.BOT_SPREAD_POLICY_SPORT_MIN_INITIALIZED_POOLS;

afterEach(() => {
  if (originalBotCycleMinutes === undefined) {
    delete process.env.BOT_ENGINE_CYCLE_MINUTES;
  } else {
    process.env.BOT_ENGINE_CYCLE_MINUTES = originalBotCycleMinutes;
  }

  if (originalBotsPerTick === undefined) {
    delete process.env.BOT_ENGINE_BOTS_PER_TICK;
  } else {
    process.env.BOT_ENGINE_BOTS_PER_TICK = originalBotsPerTick;
  }

  if (originalSpreadPolicyEnabled === undefined) {
    delete process.env.BOT_SPREAD_POLICY_ENABLED;
  } else {
    process.env.BOT_SPREAD_POLICY_ENABLED = originalSpreadPolicyEnabled;
  }
  if (originalSpreadPolicyWindow === undefined) {
    delete process.env.BOT_SPREAD_POLICY_WINDOW_HOURS;
  } else {
    process.env.BOT_SPREAD_POLICY_WINDOW_HOURS = originalSpreadPolicyWindow;
  }
  if (originalSpreadPolicyCap === undefined) {
    delete process.env.BOT_SPREAD_POLICY_PLAYER_CAP_PER_WINDOW;
  } else {
    process.env.BOT_SPREAD_POLICY_PLAYER_CAP_PER_WINDOW = originalSpreadPolicyCap;
  }
  if (originalSpreadPolicyCooldown === undefined) {
    delete process.env.BOT_SPREAD_POLICY_PLAYER_COOLDOWN_HOURS;
  } else {
    process.env.BOT_SPREAD_POLICY_PLAYER_COOLDOWN_HOURS = originalSpreadPolicyCooldown;
  }
  if (originalSpreadPolicySportMinShare === undefined) {
    delete process.env.BOT_SPREAD_POLICY_SPORT_MIN_SHARE;
  } else {
    process.env.BOT_SPREAD_POLICY_SPORT_MIN_SHARE = originalSpreadPolicySportMinShare;
  }
  if (originalSpreadPolicySportMaxShare === undefined) {
    delete process.env.BOT_SPREAD_POLICY_SPORT_MAX_SHARE;
  } else {
    process.env.BOT_SPREAD_POLICY_SPORT_MAX_SHARE = originalSpreadPolicySportMaxShare;
  }
  if (originalSpreadPolicyMinPools === undefined) {
    delete process.env.BOT_SPREAD_POLICY_SPORT_MIN_INITIALIZED_POOLS;
  } else {
    process.env.BOT_SPREAD_POLICY_SPORT_MIN_INITIALIZED_POOLS = originalSpreadPolicyMinPools;
  }
});

describe("bot runtime helpers", () => {
  const baseSpreadConfig = {
    enabled: true,
    windowHours: 6,
    playerCapPerWindow: 4,
    playerCooldownHours: 12,
    sportMinShare: 0.1,
    sportMaxShare: 0.55,
    sportMinInitializedPools: 20,
  };

  it("builds cycle keys with the configured cycle interval", () => {
    process.env.BOT_ENGINE_CYCLE_MINUTES = "1";
    expect(__botRuntime.buildCycleKey(new Date("2026-03-10T22:13:42.500Z"))).toBe(
      "2026-03-10T22:13:00.000Z",
    );

    process.env.BOT_ENGINE_CYCLE_MINUTES = "15";
    expect(__botRuntime.buildCycleKey(new Date("2026-03-10T22:13:42.500Z"))).toBe(
      "2026-03-10T22:00:00.000Z",
    );
  });

  it("rotates a smaller bot slice across successive cycles", () => {
    process.env.BOT_ENGINE_CYCLE_MINUTES = "1";
    process.env.BOT_ENGINE_BOTS_PER_TICK = "2";

    const bots = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((botName, index) => ({
      id: `bot-${index}`,
      botName,
    })) as any;

    const firstSlice = __botRuntime
      .selectBotsForTick(bots, new Date("2026-03-10T22:13:00.000Z"))
      .map((bot: any) => bot.botName);
    const secondSlice = __botRuntime
      .selectBotsForTick(bots, new Date("2026-03-10T22:14:00.000Z"))
      .map((bot: any) => bot.botName);

    expect(firstSlice).toHaveLength(2);
    expect(secondSlice).toHaveLength(2);
    expect(secondSlice).not.toEqual(firstSlice);
  });

  it("only exposes hosted research to the shared brief when explicitly allowed", () => {
    expect(__botRuntime.buildSharedBriefToolAllowlist(true)).toContain("get_hosted_research");
    expect(__botRuntime.buildSharedBriefToolAllowlist(false)).not.toContain("get_hosted_research");
  });

  it("builds a bounded bot tool allowlist from allowed mechanics", () => {
    const tools = __botRuntime.buildBotToolAllowlist(["market", "liquidity", "boosts"]);

    expect(tools).toContain("preview_pool_buy");
    expect(tools).toContain("preview_pool_sell");
    expect(tools).toContain("preview_lp_add");
    expect(tools).toContain("preview_lp_remove");
    expect(tools).toContain("preview_lp_zap");
    expect(tools).toContain("preview_daily_boost_assign");
    expect(tools).toContain("preview_daily_boost_remove");
    expect(tools).not.toContain("preview_scout_adjustment");
    expect(tools).not.toContain("get_hosted_research");
  });

  it("filters executable actions by mechanic and max action cap", () => {
    const { executable, dropped } = __botRuntime.filterExecutableActions(
      [
        {
          actionType: "pool_buy",
          playerId: "p1",
          playerName: "Player One",
          sbAmount: 50,
          maxSlippage: 0.05,
          reasoning: "first move",
          confidence: 0.8,
        },
        {
          actionType: "pool_add_liquidity",
          playerId: "p2",
          playerName: "Player Two",
          shares: 10,
          playMoney: 100,
          reasoning: "not allowed",
          confidence: 0.7,
        },
        {
          actionType: "scout_set_count",
          playerId: "p3",
          playerName: "Player Three",
          currentCount: 0,
          targetCount: 2,
          reasoning: "second move",
          confidence: 0.75,
          evidence: [],
          riskFlags: [],
        },
      ],
      ["market", "scouting"],
      1,
    );

    expect(executable).toHaveLength(1);
    expect(executable[0]?.actionType).toBe("pool_buy");
    expect(dropped).toHaveLength(2);
  });

  it("detects explicit no-action summaries and direct tool loop failures", () => {
    expect(
      __botRuntime.isExplicitNoAction(
        "NO_ACTION: stale market and no clean edge after shared brief review.",
        "Holding fire.",
      ),
    ).toBe(true);
    expect(__botRuntime.isExplicitNoAction("Hold if needed.", "General commentary.")).toBe(false);

    expect(
      __botRuntime.classifyPlanningFailure({
        outcome: "advisory",
        summary: "Hermes could not complete the direct tool loop for the latest turn.",
        assistantText: "No usable answer.",
        toolCallsUsed: ["model_first_fallback"],
        fallbackUsed: false,
      }),
    ).toBe("direct_loop_unusable");
    expect(
      __botRuntime.classifyPlanningFailure({
        outcome: "advisory",
        summary: "General advisory.",
        assistantText: "Market is quiet.",
        toolCallsUsed: [],
        fallbackUsed: false,
      }),
    ).toBe("advisory_only");
  });

  it("normalizes mechanics and objective weights with sane fallbacks", () => {
    expect(__botRuntime.normalizeAllowedMechanics(["market", "invalid"], ["boosts"])).toEqual([
      "market",
    ]);
    expect(__botRuntime.normalizeAllowedMechanics(null, ["boosts"])).toEqual(["boosts"]);

    expect(
      __botRuntime.normalizeObjectiveWeights(
        {
          priceMovement: 0.6,
          variety: 0.1,
        },
        {
          priceMovement: 0.4,
          liquidityCoverage: 0.3,
          variety: 0.3,
        },
      ),
    ).toEqual({
      priceMovement: 0.6,
      liquidityCoverage: 0.3,
      variety: 0.1,
    });
  });

  it("builds a synthetic shared brief from the internal market snapshot", () => {
    const brief = __botRuntime.buildSyntheticSharedBrief(
      {
        generatedAt: "2026-03-10T23:30:00.000Z",
        activeBots: 3,
        liveGames: 2,
        upcomingGames: 4,
        pools: {
          total: 100,
          lowTradeCount: 75,
          avgTrades: 1.5,
        },
        coldPools: [
          {
            playerId: "p1",
            playerName: "Cold One",
            sport: "NBA",
            team: "BOS",
            totalTrades: 0,
            lastPrice: 10,
            lastUpdated: "2026-03-10T22:00:00.000Z",
          },
        ],
        movers: [
          {
            playerId: "p2",
            playerName: "Mover One",
            sport: "NFL",
            team: "BUF",
            priceChange24h: 12.5,
            volume24h: 50,
            currentPrice: 18,
          },
        ],
      },
      [{ botRole: "market_maker" }, { botRole: "trader" }, { botRole: "casual" }] as any,
      "Hermes brief timed out",
    );

    expect(brief.summary).toBe("Synthetic internal market brief");
    expect(brief.sharedPrompt).toContain("Hermes brief timed out");
    expect(brief.sharedPrompt).toContain("Cold One");
    expect(brief.sharedPrompt).toContain("Mover One");
    expect(brief.usedResearch).toBe(false);
  });

  it("builds a deterministic fallback market buy when a bot has balance and cold pools exist", () => {
    const result = __botRuntime.chooseFallbackAction({
      profile: {
        botRole: "market_maker",
        minOrderSize: 10,
        maxOrderSize: 50,
      },
      sharedBrief: {
        briefPayload: {
          snapshot: {
            generatedAt: "2026-03-10T23:30:00.000Z",
            activeBots: 1,
            liveGames: 0,
            upcomingGames: 0,
            pools: {
              total: 10,
              lowTradeCount: 8,
              avgTrades: 1.2,
            },
            coldPools: [
              {
                playerId: "cold_1",
                playerName: "Cold One",
                sport: "NBA",
                team: "BOS",
                totalTrades: 0,
                lastPrice: 12,
                lastUpdated: "2026-03-10T22:00:00.000Z",
              },
            ],
            movers: [],
          },
        },
      },
      context: {
        operatorOverview: {
          availableBalance: 500,
        },
        remainingScouts: 0,
        candidates: [],
      },
      recentActions: [],
      allowedMechanics: ["market"],
    } as any);

    expect(result.action).toMatchObject({
      actionType: "pool_buy",
      playerId: "cold_1",
      playerName: "Cold One",
    });
    expect((result.action as any)?.sbAmount).toBeGreaterThanOrEqual(13);
  });

  it("bumps low-budget fallback buys up to a viable one-share spend", () => {
    expect(
      __botRuntime.resolveFallbackBuySize(
        {
          botRole: "casual",
          minOrderSize: 5,
          maxOrderSize: 10,
        } as any,
        100,
        10,
      ),
    ).toBe(11);
  });

  it("falls back to scouting when market actions are unavailable", () => {
    const result = __botRuntime.chooseFallbackAction({
      profile: {
        botRole: "contest",
        minOrderSize: 10,
        maxOrderSize: 40,
      },
      sharedBrief: {
        briefPayload: {
          snapshot: {
            generatedAt: "2026-03-10T23:30:00.000Z",
            activeBots: 1,
            liveGames: 1,
            upcomingGames: 2,
            pools: {
              total: 10,
              lowTradeCount: 8,
              avgTrades: 1.2,
            },
            coldPools: [],
            movers: [],
          },
        },
      },
      context: {
        operatorOverview: {
          availableBalance: 0,
        },
        remainingScouts: 2,
        candidates: [
          {
            playerId: "focus_1",
            name: "Focus Player",
            sport: "NBA",
            team: "DEN",
            currentScoutCount: 1,
            scoutOpportunityScore: 42,
            hasGameInFocusWindow: true,
            upcomingGame: "2026-03-11T00:00:00.000Z",
            injuryStatus: null,
          },
        ],
      },
      recentActions: [],
      allowedMechanics: ["scouting"],
    } as any);

    expect(result.action).toMatchObject({
      actionType: "scout_set_count",
      playerId: "focus_1",
      targetCount: 2,
    });
  });

  it("blocks non-parity bot actions", () => {
    const result = __botRuntime.enforcePlayerExecutionParity([
      {
        actionType: "pool_buy",
        playerId: "p1",
        sbAmount: 20,
        maxSlippage: 0.1,
        reasoning: "buy",
        confidence: 0.7,
      },
      {
        actionType: "watchlist_add_player",
        playerId: "p2",
        reasoning: "not parity",
        confidence: 0.5,
      },
      {
        actionType: "community_boost_create",
        playerId: "p3",
        sport: "NBA",
        boostDate: "2026-04-01",
        gameId: "g1",
        reasoning: "not parity",
        confidence: 0.5,
      },
    ] as any);

    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0]?.actionType).toBe("pool_buy");
    expect(result.blocked).toHaveLength(2);
    expect(result.warnings[0]).toContain("watchlist_add_player");
    expect(result.warnings[0]).toContain("community_boost_create");
  });

  it("reroutes LP actions when player cap is exceeded", () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const result = __botRuntime.applySpreadPolicyToActions({
      actions: [
        {
          actionType: "pool_add_liquidity_optimal",
          playerId: "hot_player",
          playerName: "Hot Player",
          maxShares: 3,
          maxPlayMoney: 60,
          reasoning: "original",
          confidence: 0.7,
        },
      ],
      now,
      config: baseSpreadConfig,
      spreadStats: {
        totalLpActionsInWindow: 30,
        lpActionsByPlayer: new Map([
          ["hot_player", 4],
          ["cold_player", 0],
        ]),
        lpActionsBySport: new Map([
          ["NBA", 15],
          ["NFL", 15],
        ]),
        botLastLpActionAtByPlayer: new Map(),
        initializedPoolsBySport: new Map([
          ["NBA", 100],
          ["NFL", 100],
        ]),
      },
      spreadCandidates: [
        {
          playerId: "cold_player",
          playerName: "Cold Player",
          sport: "NFL",
          availableShares: 5,
          hasPool: true,
          totalTrades: 1,
          hoursSinceUpdate: 48,
          estimatedPrice: 11,
          lpActionsInWindow: 0,
          sportLpActionsInWindow: 15,
          score: 200,
        },
      ],
      playerMetaById: new Map([
        [
          "hot_player",
          {
            playerId: "hot_player",
            sport: "NBA",
            hasPool: true,
            totalTrades: 120,
            updatedAt: now,
          },
        ],
      ]),
      allowedMechanics: ["liquidity"],
      availableBalance: 100,
      remainingScouts: 0,
      noPoolScoutCandidates: [] as any,
    });

    expect(result.executable).toHaveLength(1);
    expect(result.executable[0]?.actionType).toBe("pool_add_liquidity_optimal");
    expect((result.executable[0] as any)?.playerId).toBe("cold_player");
    expect(result.spreadRewrites).toBe(1);
    expect(result.spreadPlayerCapHits).toBe(1);
    expect(result.spreadDroppedCount).toBe(0);
  });

  it("reroutes LP actions when per-player cooldown is active", () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const result = __botRuntime.applySpreadPolicyToActions({
      actions: [
        {
          actionType: "pool_add_liquidity_optimal",
          playerId: "repeat_player",
          playerName: "Repeat Player",
          maxShares: 2,
          maxPlayMoney: 40,
          reasoning: "repeat",
          confidence: 0.7,
        },
      ],
      now,
      config: baseSpreadConfig,
      spreadStats: {
        totalLpActionsInWindow: 8,
        lpActionsByPlayer: new Map([
          ["repeat_player", 1],
          ["other_player", 0],
        ]),
        lpActionsBySport: new Map([
          ["NBA", 6],
          ["NFL", 2],
        ]),
        botLastLpActionAtByPlayer: new Map([
          ["repeat_player", new Date("2026-04-23T08:30:00.000Z")],
        ]),
        initializedPoolsBySport: new Map([
          ["NBA", 100],
          ["NFL", 100],
        ]),
      },
      spreadCandidates: [
        {
          playerId: "other_player",
          playerName: "Other Player",
          sport: "NFL",
          availableShares: 4,
          hasPool: true,
          totalTrades: 2,
          hoursSinceUpdate: 12,
          estimatedPrice: 9,
          lpActionsInWindow: 0,
          sportLpActionsInWindow: 4,
          score: 150,
        },
      ],
      playerMetaById: new Map([
        [
          "repeat_player",
          {
            playerId: "repeat_player",
            sport: "NBA",
            hasPool: true,
            totalTrades: 50,
            updatedAt: now,
          },
        ],
      ]),
      allowedMechanics: ["liquidity"],
      availableBalance: 75,
      remainingScouts: 0,
      noPoolScoutCandidates: [] as any,
    });

    expect((result.executable[0] as any)?.playerId).toBe("other_player");
    expect(result.spreadCooldownHits).toBe(1);
    expect(result.spreadRewrites).toBe(1);
  });

  it("reroutes LP actions when sport concentration exceeds ceiling", () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const result = __botRuntime.applySpreadPolicyToActions({
      actions: [
        {
          actionType: "pool_add_liquidity_optimal",
          playerId: "nba_player",
          playerName: "NBA Player",
          maxShares: 2,
          maxPlayMoney: 50,
          reasoning: "too concentrated",
          confidence: 0.7,
        },
      ],
      now,
      config: {
        ...baseSpreadConfig,
        sportMinInitializedPools: 1,
      },
      spreadStats: {
        totalLpActionsInWindow: 10,
        lpActionsByPlayer: new Map([
          ["nba_player", 1],
          ["nfl_player", 0],
        ]),
        lpActionsBySport: new Map([
          ["NBA", 8],
          ["NFL", 2],
        ]),
        botLastLpActionAtByPlayer: new Map(),
        initializedPoolsBySport: new Map([
          ["NBA", 100],
          ["NFL", 100],
        ]),
      },
      spreadCandidates: [
        {
          playerId: "nfl_player",
          playerName: "NFL Player",
          sport: "NFL",
          availableShares: 2,
          hasPool: true,
          totalTrades: 1,
          hoursSinceUpdate: 20,
          estimatedPrice: 7,
          lpActionsInWindow: 0,
          sportLpActionsInWindow: 2,
          score: 180,
        },
      ],
      playerMetaById: new Map([
        [
          "nba_player",
          {
            playerId: "nba_player",
            sport: "NBA",
            hasPool: true,
            totalTrades: 40,
            updatedAt: now,
          },
        ],
      ]),
      allowedMechanics: ["liquidity"],
      availableBalance: 60,
      remainingScouts: 0,
      noPoolScoutCandidates: [] as any,
    });

    expect((result.executable[0] as any)?.playerId).toBe("nfl_player");
    expect(result.spreadSportCapHits).toBe(1);
    expect(result.spreadRewrites).toBe(1);
  });

  it("uses scout-only bootstrap when LP action cannot be rerouted to eligible shares", () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const result = __botRuntime.applySpreadPolicyToActions({
      actions: [
        {
          actionType: "pool_add_liquidity_optimal",
          playerId: "hot_player",
          playerName: "Hot Player",
          maxShares: 2,
          maxPlayMoney: 35,
          reasoning: "lp",
          confidence: 0.7,
        },
      ],
      now,
      config: baseSpreadConfig,
      spreadStats: {
        totalLpActionsInWindow: 20,
        lpActionsByPlayer: new Map([["hot_player", 4]]),
        lpActionsBySport: new Map([["NBA", 20]]),
        botLastLpActionAtByPlayer: new Map([["hot_player", new Date("2026-04-23T11:30:00.000Z")]]),
        initializedPoolsBySport: new Map([["NBA", 100]]),
      },
      spreadCandidates: [],
      playerMetaById: new Map([
        [
          "hot_player",
          {
            playerId: "hot_player",
            sport: "NBA",
            hasPool: true,
            totalTrades: 100,
            updatedAt: now,
          },
        ],
        [
          "new_pool_target",
          {
            playerId: "new_pool_target",
            sport: "NBA",
            hasPool: false,
            totalTrades: 0,
            updatedAt: null,
          },
        ],
      ]),
      allowedMechanics: ["liquidity", "scouting"],
      availableBalance: 50,
      remainingScouts: 2,
      noPoolScoutCandidates: [
        {
          playerId: "new_pool_target",
          name: "New Pool Target",
          sport: "NBA",
          team: "BOS",
          currentScoutCount: 0,
          scoutOpportunityScore: 60,
          hasGameInFocusWindow: true,
          upcomingGame: "2026-04-23T23:00:00.000Z",
          injuryStatus: null,
        },
      ] as any,
    });

    expect(result.executable).toHaveLength(1);
    expect(result.executable[0]?.actionType).toBe("scout_set_count");
    expect((result.executable[0] as any)?.playerId).toBe("new_pool_target");
    expect(result.bootstrapScoutsPlaced).toBe(1);
    expect(result.spreadDroppedCount).toBe(0);
  });
});
