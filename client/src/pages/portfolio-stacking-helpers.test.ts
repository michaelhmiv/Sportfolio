import { describe, expect, it } from "vitest";

import {
  buildStackingCandidates,
  getCompactStackStatus,
  sortStackingCandidates,
  type PortfolioStackingEligibility,
  type PortfolioStackingHolding,
} from "@/pages/portfolio-stacking-helpers";

const basePlayer = {
  createdAt: new Date("2026-03-08T00:00:00Z"),
  sport: "NBA",
  team: "DET",
  position: "G",
  firstName: "Amen",
  lastName: "Thompson",
  name: "Amen Thompson",
  headshotUrl: null,
  jerseyNumber: null,
  metadata: null,
  lastTradePrice: "12.50",
  injuryStatus: null,
  status: "active",
} as const;

describe("portfolio stacking helpers", () => {
  it("builds stack-ready candidates from unlocked raw shares and stacked inventory", () => {
    const holdings: PortfolioStackingHolding[] = [
      {
        id: "raw_1",
        assetType: "player",
        quantity: "10",
        availableQuantity: 8,
        effectiveShares: "10",
        multiplier: "1",
        isStackedShare: false,
        player: { ...basePlayer, id: "amen" } as any,
      } as any,
      {
        id: "stacked_1",
        assetType: "player",
        quantity: "1",
        availableQuantity: 1,
        effectiveShares: "4",
        multiplier: "4",
        isStackedShare: true,
        player: { ...basePlayer, id: "amen" } as any,
      } as any,
    ];

    const eligibility: PortfolioStackingEligibility[] = [
      {
        playerId: "amen",
        gameStatus: "upcoming",
        gameStartTime: "2026-03-08T23:00:00.000Z",
        hasGameToday: true,
        communityBoostCount: 1,
        hasCommunityBoost: true,
      },
    ];

    const [candidate] = buildStackingCandidates(holdings, eligibility, "NBA");

    expect(candidate).toMatchObject({
      playerId: "amen",
      regularShares: 10,
      availableToStack: 8,
      maxStackable: 8,
      projectedMultiplier: 4,
      stackedShareCount: 1,
      bestStackedMultiplier: 4,
      effectiveShares: 14,
      status: "stack-ready",
      gameStatus: "upcoming",
      hasCommunityBoost: true,
    });
  });

  it("distinguishes almost-ready raw positions from already-stacked positions", () => {
    const holdings: PortfolioStackingHolding[] = [
      {
        assetType: "player",
        quantity: "3",
        availableQuantity: 3,
        effectiveShares: "3",
        multiplier: "1",
        isStackedShare: false,
        player: { ...basePlayer, id: "raw-only", lastName: "Raw" } as any,
      } as any,
      {
        assetType: "player",
        quantity: "1",
        availableQuantity: 1,
        effectiveShares: "5",
        multiplier: "5",
        isStackedShare: true,
        player: { ...basePlayer, id: "stacked-only", lastName: "Stacked" } as any,
      } as any,
    ];

    const candidates = buildStackingCandidates(holdings);

    expect(candidates.find((candidate) => candidate.playerId === "raw-only")?.status).toBe(
      "almost-ready",
    );
    expect(candidates.find((candidate) => candidate.playerId === "stacked-only")?.status).toBe(
      "already-stacked",
    );
  });

  it("keeps default sorting focused on actionability, then raw availability", () => {
    const holdings: PortfolioStackingHolding[] = [
      {
        assetType: "player",
        quantity: "6",
        availableQuantity: 6,
        effectiveShares: "6",
        multiplier: "1",
        isStackedShare: false,
        player: { ...basePlayer, id: "ready-low", lastName: "Alpha" } as any,
      } as any,
      {
        assetType: "player",
        quantity: "10",
        availableQuantity: 10,
        effectiveShares: "10",
        multiplier: "1",
        isStackedShare: false,
        player: { ...basePlayer, id: "ready-high", lastName: "Beta" } as any,
      } as any,
      {
        assetType: "player",
        quantity: "2",
        availableQuantity: 2,
        effectiveShares: "2",
        multiplier: "1",
        isStackedShare: false,
        player: { ...basePlayer, id: "almost", lastName: "Gamma" } as any,
      } as any,
    ];

    const candidates = buildStackingCandidates(holdings);
    const sorted = sortStackingCandidates(candidates, "ready");

    expect(sorted.map((candidate) => candidate.playerId)).toEqual([
      "ready-high",
      "ready-low",
      "almost",
    ]);
  });

  it("returns Ready when no stack exists and singles are stackable", () => {
    expect(
      getCompactStackStatus({
        availableSingles: 6,
        stackPower: 0,
      }),
    ).toMatchObject({
      kind: "ready",
      label: "Ready",
      neededSingles: 0,
    });
  });

  it("returns Need X when below the minimum and no stack exists", () => {
    expect(
      getCompactStackStatus({
        availableSingles: 3,
        stackPower: 0,
      }),
    ).toMatchObject({
      kind: "need",
      label: "Need 1",
      neededSingles: 1,
    });
  });

  it("returns Add ready when stack exists and more singles are stackable", () => {
    expect(
      getCompactStackStatus({
        availableSingles: 12,
        stackPower: 18,
      }),
    ).toMatchObject({
      kind: "add-ready",
      label: "Add ready",
      neededSingles: 0,
    });
  });
});
