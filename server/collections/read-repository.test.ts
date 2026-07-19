import { describe, expect, it } from "vitest";
import {
  computeMaxAllocatableQuantities,
  computeSlotAvailabilityDetails,
  isCollectionPrerequisiteAvailable,
} from "./read-repository";

const units = (value: string) => {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * BigInt(10_000) + BigInt(fraction.padEnd(4, "0"));
};

describe("computeMaxAllocatableQuantities", () => {
  it("preserves slot indexes for vacant and duplicate-player slots", () => {
    const result = computeMaxAllocatableQuantities(
      [
        { playerId: null, lockReferenceId: null, requiredQuantity: "1.0000" },
        { playerId: "player-a", lockReferenceId: null, requiredQuantity: "2.0000" },
        { playerId: "player-a", lockReferenceId: "own-lock", requiredQuantity: "5.0000" },
      ],
      new Map([["player-a", new Set(["player-a", "player-a-alias"])]]),
      new Map([
        ["player-a", units("3.0000")],
        ["player-a-alias", units("2.0000")],
      ]),
      new Map([
        [
          "player-a",
          new Map([
            ["other-lock", units("1.5000")],
            ["own-lock", units("2.0000")],
          ]),
        ],
      ]),
    );

    expect(result.has(0)).toBe(false);
    expect(result.get(1)).toBe("1.5000");
    expect(result.get(2)).toBe("3.5000");
  });

  it("returns zero when other locks exhaust the holding", () => {
    const result = computeMaxAllocatableQuantities(
      [{ playerId: "player-b", lockReferenceId: null, requiredQuantity: "1.0000" }],
      new Map([["player-b", new Set(["player-b"])]]),
      new Map([["player-b", units("0.5000")]]),
      new Map([["player-b", new Map([["other-lock", units("1.0000")]])]]),
    );

    expect(result.get(0)).toBe("0.0000");
  });
});

describe("computeSlotAvailabilityDetails", () => {
  it("distinguishes no holdings from holdings locked by another collection", () => {
    const result = computeSlotAvailabilityDetails(
      [
        { playerId: "owned", lockReferenceId: null, requiredQuantity: "2.0000" },
        { playerId: "unowned", lockReferenceId: null, requiredQuantity: "2.0000" },
      ],
      new Map([
        ["owned", new Set(["owned"])],
        ["unowned", new Set(["unowned"])],
      ]),
      new Map([["owned", units("1.5000")]]),
      new Map([["owned", new Map([["another-collection", units("1.5000")]])]]),
    );

    expect(result.get(0)).toEqual({
      ownedQuantity: "1.5000",
      lockedElsewhereQuantity: "1.5000",
      maxAllocatableQuantity: "0.0000",
    });
    expect(result.get(1)).toEqual({
      ownedQuantity: "0.0000",
      lockedElsewhereQuantity: "0.0000",
      maxAllocatableQuantity: "0.0000",
    });
  });
});

describe("isCollectionPrerequisiteAvailable", () => {
  it("requires both the definition lifecycle and version state to be published", () => {
    expect(isCollectionPrerequisiteAvailable("tracking", "tracking")).toBe(true);
    expect(isCollectionPrerequisiteAvailable("final", "final")).toBe(true);
    expect(isCollectionPrerequisiteAvailable("tracking", "draft")).toBe(false);
    expect(isCollectionPrerequisiteAvailable("disabled", "final")).toBe(false);
  });
});
