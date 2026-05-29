import { describe, expect, it } from "vitest";
import { isSportOverTarget, shouldBlockMarketActionForPlayer } from "./player-selector";
import type { ActionType } from "./bot-profiles-v2";

describe("player-selector policy guards", () => {
  it("blocks market actions when the per-bot per-player cap is reached", () => {
    const result = shouldBlockMarketActionForPlayer({
      actionType: "buy",
      marketActionTypes: new Set<ActionType>(["buy", "sell", "pool_create"]),
      playerId: "player_1",
      botCountsByPlayer: new Map([["player_1", 1]]),
      globalCountsByPlayer: new Map([["player_1", 1]]),
      maxBotActionsPerPlayer24h: 1,
      maxGlobalActionsPerPlayer24h: 4,
    });

    expect(result).toBe(true);
  });

  it("blocks market actions when the global per-player cap is reached", () => {
    const result = shouldBlockMarketActionForPlayer({
      actionType: "sell",
      marketActionTypes: new Set<ActionType>(["buy", "sell", "pool_create"]),
      playerId: "player_2",
      botCountsByPlayer: new Map([["player_2", 0]]),
      globalCountsByPlayer: new Map([["player_2", 4]]),
      maxBotActionsPerPlayer24h: 1,
      maxGlobalActionsPerPlayer24h: 4,
    });

    expect(result).toBe(true);
  });

  it("does not apply market caps to scout actions", () => {
    const result = shouldBlockMarketActionForPlayer({
      actionType: "scout_assign",
      marketActionTypes: new Set<ActionType>(["buy", "sell", "pool_create"]),
      playerId: "player_3",
      botCountsByPlayer: new Map([["player_3", 100]]),
      globalCountsByPlayer: new Map([["player_3", 100]]),
      maxBotActionsPerPlayer24h: 1,
      maxGlobalActionsPerPlayer24h: 4,
    });

    expect(result).toBe(false);
  });

  it("flags sports that exceed their target share plus tolerance", () => {
    const result = isSportOverTarget({
      sport: "NBA",
      sportActionCounts: new Map([
        ["NBA", 8],
        ["NFL", 2],
      ]),
      sportTargets: new Map([
        ["NBA", 0.55],
        ["NFL", 0.45],
      ]),
      tolerance: 0.05,
    });

    expect(result).toBe(true);
  });

  it("allows sports that are at or below target band", () => {
    const result = isSportOverTarget({
      sport: "NFL",
      sportActionCounts: new Map([
        ["NBA", 5],
        ["NFL", 5],
      ]),
      sportTargets: new Map([
        ["NBA", 0.55],
        ["NFL", 0.45],
      ]),
      tolerance: 0.05,
    });

    expect(result).toBe(false);
  });
});
