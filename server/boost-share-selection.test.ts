import { describe, expect, it } from "vitest";
import { pickRegularBoostHolding } from "./boost-share-selection";

describe("pickRegularBoostHolding", () => {
  it("prefers the alias row with unlocked shares over a fully locked canonical row", () => {
    const selection = pickRegularBoostHolding({
      canonicalPlayerId: "nba_canonical",
      sharesToBurn: 1,
      lockedByAssetId: new Map([["nba_canonical", 1]]),
      holdingsRows: [
        {
          id: "holding_canonical",
          assetId: "nba_canonical",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "holding_alias",
          assetId: "nba_alias",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T09:00:00.000Z"),
        },
      ],
    });

    expect(selection?.holding.id).toBe("holding_alias");
    expect(selection?.availableQuantity).toBe(1);
    expect(selection?.lockedQuantity).toBe(0);
  });

  it("keeps the canonical row preference only after unlocked availability ties", () => {
    const selection = pickRegularBoostHolding({
      canonicalPlayerId: "nba_canonical",
      sharesToBurn: 1,
      lockedByAssetId: new Map<string, number>(),
      holdingsRows: [
        {
          id: "holding_alias",
          assetId: "nba_alias",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T09:00:00.000Z"),
        },
        {
          id: "holding_canonical",
          assetId: "nba_canonical",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T08:00:00.000Z"),
        },
      ],
    });

    expect(selection?.holding.id).toBe("holding_canonical");
  });

  it("returns undefined when every identity row is fully locked", () => {
    const selection = pickRegularBoostHolding({
      canonicalPlayerId: "nba_canonical",
      sharesToBurn: 1,
      lockedByAssetId: new Map([
        ["nba_canonical", 1],
        ["nba_alias", 1],
      ]),
      holdingsRows: [
        {
          id: "holding_alias",
          assetId: "nba_alias",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T09:00:00.000Z"),
        },
        {
          id: "holding_canonical",
          assetId: "nba_canonical",
          quantity: "1.0000",
          lastUpdated: new Date("2026-03-13T08:00:00.000Z"),
        },
      ],
    });

    expect(selection).toBeUndefined();
  });
});
