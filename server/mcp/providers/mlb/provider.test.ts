import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  call: vi.fn(),
  health: vi.fn(),
}));

vi.mock("./native-provider", () => ({
  callNativeMlbTool: native.call,
  nativeMlbHealth: native.health,
}));

import {
  callMlbPublicTool,
  getMlbProviderHealth,
  MlbProviderError,
  resetMlbProviderStateForTests,
  resolveMlbProviderConfig,
  type MlbProviderConfig,
  type ProviderRuntime,
} from "./provider";

function config(overrides: Partial<MlbProviderConfig> = {}): MlbProviderConfig {
  return {
    ...resolveMlbProviderConfig(),
    ...overrides,
  };
}

function runtime(): ProviderRuntime {
  return {
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
  };
}

beforeEach(() => {
  resetMlbProviderStateForTests();
  native.call.mockReset();
  native.health.mockReset();
  native.call.mockResolvedValue({ games: [] });
  native.health.mockResolvedValue({ reachable: true, checkedAt: "2026-08-07T22:00:00.000Z" });
});

describe("native MLB provider wrapper", () => {
  it("defaults to the in-process StatsAPI backend without Railway MLB variables", () => {
    expect(resolveMlbProviderConfig()).toMatchObject({
      enabled: true,
      endpoint: "native://mlb-statsapi",
      authBearerToken: null,
    });
  });

  it("returns the stable public response envelope", async () => {
    native.call.mockResolvedValue({ games: [{ game_id: 1 }] });
    const result = await callMlbPublicTool(
      "get_mlb_games",
      { date: "2026-08-07" },
      { config: config(), runtime: runtime(), requestId: "request-1" },
    );

    expect(native.call).toHaveBeenCalledWith(
      "get_mlb_games",
      { date: "2026-08-07" },
      { timeoutMs: 12_000 },
    );
    expect(result).toEqual({
      summary: "Loaded MLB data for get_mlb_games.",
      data: { games: [{ game_id: 1 }] },
      warnings: [],
      provider: {
        name: "mlb-statsapi-native",
        capability: "get_mlb_games",
        requestId: "request-1",
      },
    });
  });

  it("returns a typed disabled error when explicitly disabled", async () => {
    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-07" },
        { config: config({ enabled: false }), runtime: runtime() },
      ),
    ).rejects.toMatchObject({ code: "provider_disabled", retryable: false });
  });

  it("retries one transient native upstream failure", async () => {
    native.call
      .mockRejectedValueOnce(new Error("temporary upstream outage"))
      .mockResolvedValueOnce({ games: [] });

    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-07" },
        { config: config(), runtime: runtime() },
      ),
    ).resolves.toMatchObject({ data: { games: [] } });
    expect(native.call).toHaveBeenCalledTimes(2);
  });

  it("does not retry invalid semantic input", async () => {
    native.call.mockRejectedValue(new Error("teamId must be an integer between 1 and 9999."));
    await expect(
      callMlbPublicTool(
        "get_mlb_team_leaders",
        { teamId: 0 },
        { config: config(), runtime: runtime() },
      ),
    ).rejects.toMatchObject({ code: "provider_invalid_request", retryable: false });
    expect(native.call).toHaveBeenCalledTimes(1);
  });

  it("enforces response-size limits", async () => {
    native.call.mockResolvedValue({ value: "x".repeat(9000) });
    await expect(
      callMlbPublicTool(
        "get_mlb_games",
        { date: "2026-08-07" },
        { config: config({ maxResponseChars: 8000 }), runtime: runtime() },
      ),
    ).rejects.toMatchObject({ code: "provider_response_limit", retryable: false });
  });

  it("reports all published MLB capabilities available when native health is green", async () => {
    const health = await getMlbProviderHealth({ config: config(), runtime: runtime() });
    expect(health).toMatchObject({
      configured: true,
      reachable: true,
      requiredCapabilityCount: 12,
      availableCapabilityCount: 12,
      lastErrorCode: null,
    });
  });

  it("reports native upstream health failures without throwing", async () => {
    native.health.mockRejectedValue(new Error("network failure"));
    const health = await getMlbProviderHealth({ config: config(), runtime: runtime() });
    expect(health).toMatchObject({
      configured: true,
      reachable: false,
      availableCapabilityCount: 0,
      lastErrorCode: "provider_upstream_error",
    });
  });

  it("preserves the provider error class contract", () => {
    const error = new MlbProviderError("provider_timeout", "timeout", true);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "provider_timeout", retryable: true });
  });
});
