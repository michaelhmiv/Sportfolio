import { describe, expect, it } from "vitest";
import type { ImportedCollectionMember } from "./catalog-importer";
import { resolveTradeableMembers } from "./player-resolver";

function member(mlbamId: number): ImportedCollectionMember {
  return {
    mlbamId,
    playerName: `Player ${mlbamId}`,
    rank: 1,
    statKey: "homeRuns",
    qualificationValue: "30",
    position: "OF",
    sourceMetadata: {},
  };
}

describe("MLB collection player resolution", () => {
  it("resolves direct and aliased MLB identities to canonical tradeable players", () => {
    const result = resolveTradeableMembers(
      [member(1), member(2)],
      [
        {
          requestedPlayerId: "mlb_1",
          canonicalPlayerId: "mlb_1",
          sport: "MLB",
          isActive: true,
          poolShares: "100.00",
          poolPlayMoney: "250.00",
        },
        {
          requestedPlayerId: "mlb_2",
          canonicalPlayerId: "mlb_2002",
          sport: "MLB",
          isActive: true,
          poolShares: "10.00",
          poolPlayMoney: "25.00",
        },
      ],
    );

    expect(result.errors).toEqual([]);
    expect(result.members.map((row) => row.playerId)).toEqual(["mlb_1", "mlb_2002"]);
  });

  it("fails preview for missing, wrong-sport, or illiquid players", () => {
    const result = resolveTradeableMembers(
      [member(1), member(2), member(3)],
      [
        {
          requestedPlayerId: "mlb_2",
          canonicalPlayerId: "nba_2",
          sport: "NBA",
          isActive: true,
          poolShares: "10.00",
          poolPlayMoney: "20.00",
        },
        {
          requestedPlayerId: "mlb_3",
          canonicalPlayerId: "mlb_3",
          sport: "MLB",
          isActive: true,
          poolShares: "0.00",
          poolPlayMoney: "20.00",
        },
      ],
    );

    expect(result.members).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "PLAYER_NOT_FOUND", mlbamId: 1 }),
      expect.objectContaining({ code: "PLAYER_SPORT_MISMATCH", mlbamId: 2 }),
      expect.objectContaining({ code: "PLAYER_NOT_TRADEABLE", mlbamId: 3 }),
    ]);
  });

  it("rejects two source people resolving to the same canonical player", () => {
    const result = resolveTradeableMembers(
      [member(1), member(2)],
      [
        {
          requestedPlayerId: "mlb_1",
          canonicalPlayerId: "mlb_canonical",
          sport: "MLB",
          isActive: true,
          poolShares: "10",
          poolPlayMoney: "10",
        },
        {
          requestedPlayerId: "mlb_2",
          canonicalPlayerId: "mlb_canonical",
          sport: "MLB",
          isActive: true,
          poolShares: "10",
          poolPlayMoney: "10",
        },
      ],
    );

    expect(result.members).toEqual([]);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_CANONICAL_PLAYER", mlbamId: 2 }),
    );
  });

  it("rejects inactive players even when residual pool liquidity remains", () => {
    const result = resolveTradeableMembers(
      [member(1)],
      [
        {
          requestedPlayerId: "mlb_1",
          canonicalPlayerId: "mlb_1",
          sport: "MLB",
          isActive: false,
          poolShares: "10.00",
          poolPlayMoney: "20.00",
        },
      ],
    );

    expect(result.members).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "PLAYER_INACTIVE", mlbamId: 1 }),
    ]);
  });
});
