import { describe, expect, it, vi } from "vitest";
import { invokeComposedPublicTool } from "./composed-tool";

describe("composed public-tool invocation", () => {
  it("uses the public schema and accepts the scouting sport/limit contract", async () => {
    const runNativeScanTool = vi.fn(async (input) => ({ candidates: [], args: input.args }));
    const context = { userId: "u1", deps: { runNativeScanTool } } as any;
    const result = await invokeComposedPublicTool(context, "list_scout_opportunities", {
      sport: "mlb",
      limit: 6,
    });
    expect(result.state).toBe("ok");
    expect(runNativeScanTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "scan_scout_opportunities",
        args: { sport: "mlb", limit: 6 },
      }),
    );
  });

  it("surfaces schema drift as unavailable before the child implementation executes", async () => {
    const runNativeScanTool = vi.fn();
    const context = { userId: "u1", deps: { runNativeScanTool } } as any;
    const result = await invokeComposedPublicTool(context, "list_scout_opportunities", {
      sport: "mlb",
      limit: 6,
      unexpected: true,
    });
    expect(result.state).toBe("unavailable");
    expect(runNativeScanTool).not.toHaveBeenCalled();
  });

  it("distinguishes empty results and normalizes player names without using IDs", async () => {
    const emptyContext = {
      userId: "u1",
      deps: { runNativeScanTool: vi.fn(async () => ({})) },
    } as any;
    expect(
      (await invokeComposedPublicTool(emptyContext, "list_scout_opportunities", {})).state,
    ).toBe("empty");

    const playerContext = {
      userId: "u1",
      deps: {
        runNativeScanTool: vi.fn(async () => ({ candidates: [{ playerId: "player_123" }] })),
      },
    } as any;
    const result = await invokeComposedPublicTool(playerContext, "list_scout_opportunities", {});
    expect(result).toMatchObject({
      state: "ok",
      data: { candidates: [{ playerId: "player_123", displayName: "Name unavailable" }] },
    });
  });
});
