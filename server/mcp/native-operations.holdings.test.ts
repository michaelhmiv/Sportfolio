import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../storage";
import { runNativeReadTool } from "./native-operations";

afterEach(() => vi.restoreAllMocks());

describe("native get_holdings", () => {
  it("honors sport and limit without leaking holdings from another sport", async () => {
    vi.spyOn(storage, "getUserHoldingsWithPlayers").mockResolvedValue([
      { holding: { assetId: "nascar_1" }, player: { id: "nascar_1", sport: "NASCAR" } },
      { holding: { assetId: "mlb_1" }, player: { id: "mlb_1", sport: "MLB" } },
      { holding: { assetId: "nascar_2" }, player: { id: "nascar_2", sport: "NASCAR" } },
    ] as any);

    const result = (await runNativeReadTool({
      toolName: "get_holdings",
      userId: "user-1",
      args: { sport: "nascar", limit: 1 },
    })) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].player.id).toBe("nascar_1");
    expect(result.every((row) => row.player.sport === "NASCAR")).toBe(true);
  });
});
