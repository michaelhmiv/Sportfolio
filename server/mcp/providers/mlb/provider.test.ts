import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callMlbPublicTool,
  getMlbProviderHealth,
  MlbProviderError,
  resetMlbProviderStateForTests,
  type MlbProviderConfig,
  type ProviderRuntime,
} from "./provider";

const allTools = [
  "lookup_player",
  "get_league_leader_data",
  "get_player_stats",
  "get_player_splits",
  "get_team_leaders",
  "get_schedule",
  "get_boxscore",
  "get_standings",
  "get_team_roster",
  "get_statcast_batter_expected_stats",
  "get_statcast_pitcher_expected_stats",
];

function config(overrides: Partial<MlbProviderConfig> = {}): MlbProviderConfig {
  return {
    enabled: true,
    endpoint: "http://provider.test/mcp",
    timeoutMs: 1000,
    healthCacheMs: 1000,
    authBearerToken: null,
    maxResponseChars: 10000,
    circuitFailureThreshold: 3,
    circuitResetMs: 1000,
    ...overrides,
  };
}

function runtime(
  options: {
    tools?: string[];
    call?: (input: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  } = {},
): ProviderRuntime {
  return {
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
    createClient: () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: (options.tools ?? allTools).map((name) => ({ name })) }),
      callTool: options.call ?? (async (input) => ({ structuredContent: input })),
      close: async () => undefined,
    }),
  };
}

beforeEach(() => resetMlbProviderStateForTests());

describe("MLB provider", () => {
  it("maps semantic batting leader requests to the provider capability", async () => {
    const call = vi.fn(async (input) => ({ structuredContent: input }));
    const result = await callMlbPublicTool(
      "get_mlb_batting_leaders",
      { metric: "ops", season: 2026, limit: 5, league: "mlb" },
      { config: config(), runtime: runtime({ call }) },
    );

    expect(call).toHaveBeenCalledWith({
      name: "get_league_leader_data",
      arguments: expect.objectContaining({
        stat_group: "hitting",
        leader_categories: "onBasePlusSlugging",
        limit: 5,
      }),
    });
    expect(result.provider).toMatchObject({ remoteTool: "get_league_leader_data" });
  });

  it("returns a typed disabled error", async () => {
    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        {},
        { config: config({ enabled: false }), runtime: runtime() },
      ),
    ).rejects.toMatchObject({ code: "provider_disabled", retryable: false });
  });

  it("fails clearly when a required remote capability is missing", async () => {
    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-06" },
        { config: config(), runtime: runtime({ tools: [] }) },
      ),
    ).rejects.toMatchObject({ code: "provider_missing_tool", retryable: false });
  });

  it("enforces response-size limits", async () => {
    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-06" },
        {
          config: config({ maxResponseChars: 8000 }),
          runtime: runtime({
            call: async () => ({ structuredContent: { value: "x".repeat(9000) } }),
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "provider_response_limit", retryable: false });
  });

  it("retries one transient upstream failure", async () => {
    let attempts = 0;
    const result = await callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-06" },
      {
        config: config(),
        runtime: runtime({
          call: async (input) => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporary network failure");
            return { structuredContent: input };
          },
        }),
      },
    );
    expect(attempts).toBe(2);
    expect(result.summary).toContain("get_mlb_games");
  });

  it("reports provider health without changing the public catalog", async () => {
    const health = await getMlbProviderHealth({ config: config(), runtime: runtime() });
    expect(health).toMatchObject({
      configured: true,
      reachable: true,
      availableCapabilityCount: allTools.length,
    });
  });

  it("redacts bearer credentials from normalized errors", async () => {
    const secret = "top-secret-token";
    try {
      await callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-06" },
        {
          config: config({ authBearerToken: secret }),
          runtime: runtime({
            call: async () => {
              throw new Error(`Bearer ${secret}`);
            },
          }),
        },
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(MlbProviderError);
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });
});

it("rejects malformed provider catalogs as protocol errors", async () => {
  const malformedRuntime: ProviderRuntime = {
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
    createClient: () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: undefined }),
      callTool: async () => ({}),
      close: async () => undefined,
    }),
  };

  await expect(
    callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-06" },
      { config: config(), runtime: malformedRuntime },
    ),
  ).rejects.toMatchObject({ code: "provider_protocol_error", retryable: true });
});

it("times out bounded provider calls", async () => {
  const timeoutRuntime: ProviderRuntime = {
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
    createClient: () => ({
      connect: async () => new Promise<void>(() => undefined),
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({}),
      close: async () => undefined,
    }),
  };

  await expect(
    callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-06" },
      { config: config({ timeoutMs: 15 }), runtime: timeoutRuntime },
    ),
  ).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
});

it("opens the circuit after repeated transient failures and recovers after reset", async () => {
  let now = 1_700_000_000_000;
  const failingRuntime: ProviderRuntime = {
    now: () => now,
    sleep: async () => undefined,
    createClient: () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: allTools.map((name) => ({ name })) }),
      callTool: async () => {
        throw new Error("temporary upstream outage");
      },
      close: async () => undefined,
    }),
  };
  const circuitConfig = config({ circuitFailureThreshold: 2, circuitResetMs: 100 });

  await expect(
    callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-06" },
      { config: circuitConfig, runtime: failingRuntime },
    ),
  ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });

  await expect(
    callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-06" },
      { config: circuitConfig, runtime: failingRuntime },
    ),
  ).rejects.toMatchObject({ details: { circuitOpen: true } });

  now += 101;
  const recoveryRuntime = runtime();
  recoveryRuntime.now = () => now;
  const recovered = await callMlbPublicTool(
    "get_mlb_games",
    { date: "2026-08-06" },
    { config: circuitConfig, runtime: recoveryRuntime },
  );
  expect(recovered.summary).toContain("get_mlb_games");
});

it("rejects out-of-range semantic inputs before calling the provider", async () => {
  await expect(
    callMlbPublicTool(
      "get_mlb_batting_leaders",
      { metric: "ops", season: 1700, limit: 5 },
      { config: config(), runtime: runtime() },
    ),
  ).rejects.toMatchObject({ code: "provider_invalid_request", retryable: false });
});
