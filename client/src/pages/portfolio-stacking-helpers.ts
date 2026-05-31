import type { Player } from "@shared/schema";

export type StackingGameStatus = "none" | "upcoming" | "live" | "ended";
export type StackingCandidateStatus = "stack-ready" | "almost-ready" | "already-stacked";
export type StackingSortField = "ready" | "available" | "best-stacked" | "effective" | "game";
export type CompactStackStatusKind = "ready" | "need" | "add-ready" | "none";

export interface PortfolioStackingHolding {
  assetType: string;
  quantity: string | number;
  effectiveShares?: string | number | null;
  multiplier?: string | number | null;
  isStackedShare?: boolean | null;
  availableQuantity?: string | number | null;
  player?: Player | null;
}

export interface PortfolioStackingEligibility {
  playerId: string;
  gameStatus?: StackingGameStatus;
  gameStartTime?: string | null;
  hasGameToday?: boolean;
  communityBoostCount?: number;
  hasCommunityBoost?: boolean;
  isAlreadyBoosted?: boolean;
}

export interface StackingCandidate {
  playerId: string;
  player: Player;
  regularShares: number;
  availableToStack: number;
  maxStackable: number;
  projectedMultiplier: number;
  stackedShareCount: number;
  bestStackedMultiplier: number;
  effectiveShares: number;
  status: StackingCandidateStatus;
  gameStatus: StackingGameStatus;
  gameStartTime: string | null;
  hasGameToday: boolean;
  communityBoostCount: number;
  hasCommunityBoost: boolean;
  isAlreadyBoosted: boolean;
}

export interface CompactStackStatus {
  kind: CompactStackStatusKind;
  label: string | null;
  neededSingles: number;
}

interface AggregatedCandidate {
  player: Player;
  regularShares: number;
  availableToStack: number;
  stackedShareCount: number;
  bestStackedMultiplier: number;
  effectiveShares: number;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function formatStackNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function getCompactStackStatus(input: {
  availableSingles: number;
  stackPower: number;
  minSingles?: number;
}): CompactStackStatus {
  const minSingles = input.minSingles ?? 4;
  const availableSingles = Math.max(0, input.availableSingles);
  const stackPower = Math.max(0, input.stackPower);

  if (stackPower > 0) {
    if (availableSingles >= minSingles) {
      return { kind: "add-ready", label: "Add ready", neededSingles: 0 };
    }

    return { kind: "none", label: null, neededSingles: 0 };
  }

  if (availableSingles >= minSingles) {
    return { kind: "ready", label: "Ready", neededSingles: 0 };
  }

  const neededSingles = Math.max(0, minSingles - availableSingles);
  return {
    kind: "need",
    label: `Need ${formatStackNumber(neededSingles)}`,
    neededSingles,
  };
}

function getCandidateStatus(candidate: {
  maxStackable: number;
  stackedShareCount: number;
}): StackingCandidateStatus {
  if (candidate.maxStackable >= 4) {
    return "stack-ready";
  }

  if (candidate.stackedShareCount > 0) {
    return "already-stacked";
  }

  return "almost-ready";
}

function getStatusRank(status: StackingCandidateStatus): number {
  switch (status) {
    case "stack-ready":
      return 0;
    case "almost-ready":
      return 1;
    case "already-stacked":
      return 2;
    default:
      return 3;
  }
}

function getGameRank(status: StackingGameStatus): number {
  switch (status) {
    case "upcoming":
      return 0;
    case "live":
      return 1;
    case "none":
      return 2;
    case "ended":
      return 3;
    default:
      return 4;
  }
}

function compareNames(a: StackingCandidate, b: StackingCandidate): number {
  const aName = `${a.player.lastName} ${a.player.firstName}`.toLowerCase();
  const bName = `${b.player.lastName} ${b.player.firstName}`.toLowerCase();
  return aName.localeCompare(bName);
}

export function sortStackingCandidates(
  candidates: StackingCandidate[],
  sortField: StackingSortField,
): StackingCandidate[] {
  return [...candidates].sort((a, b) => {
    if (sortField === "available") {
      if (b.availableToStack !== a.availableToStack) {
        return b.availableToStack - a.availableToStack;
      }
      if (b.projectedMultiplier !== a.projectedMultiplier) {
        return b.projectedMultiplier - a.projectedMultiplier;
      }
      return compareNames(a, b);
    }

    if (sortField === "best-stacked") {
      if (b.bestStackedMultiplier !== a.bestStackedMultiplier) {
        return b.bestStackedMultiplier - a.bestStackedMultiplier;
      }
      if (b.availableToStack !== a.availableToStack) {
        return b.availableToStack - a.availableToStack;
      }
      return compareNames(a, b);
    }

    if (sortField === "effective") {
      if (b.effectiveShares !== a.effectiveShares) {
        return b.effectiveShares - a.effectiveShares;
      }
      if (b.availableToStack !== a.availableToStack) {
        return b.availableToStack - a.availableToStack;
      }
      return compareNames(a, b);
    }

    if (sortField === "game") {
      const gameRankDiff = getGameRank(a.gameStatus) - getGameRank(b.gameStatus);
      if (gameRankDiff !== 0) {
        return gameRankDiff;
      }
      if (a.gameStartTime && b.gameStartTime) {
        const timeDiff = new Date(a.gameStartTime).getTime() - new Date(b.gameStartTime).getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
      }
      return compareNames(a, b);
    }

    const statusDiff = getStatusRank(a.status) - getStatusRank(b.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    if (b.availableToStack !== a.availableToStack) {
      return b.availableToStack - a.availableToStack;
    }
    if (b.bestStackedMultiplier !== a.bestStackedMultiplier) {
      return b.bestStackedMultiplier - a.bestStackedMultiplier;
    }
    const gameRankDiff = getGameRank(a.gameStatus) - getGameRank(b.gameStatus);
    if (gameRankDiff !== 0) {
      return gameRankDiff;
    }
    return compareNames(a, b);
  });
}

export function buildStackingCandidates(
  holdings: PortfolioStackingHolding[],
  eligibility: PortfolioStackingEligibility[] = [],
  sport: string | null | undefined = null,
): StackingCandidate[] {
  const eligibilityByPlayerId = new Map(eligibility.map((entry) => [entry.playerId, entry]));
  const aggregatedByPlayer = new Map<string, AggregatedCandidate>();

  for (const holding of holdings) {
    if (holding.assetType !== "player" || !holding.player) {
      continue;
    }

    if (sport && sport !== "ALL" && holding.player.sport !== sport) {
      continue;
    }

    const playerId = holding.player.id;
    const current =
      aggregatedByPlayer.get(playerId) ??
      ({
        player: holding.player,
        regularShares: 0,
        availableToStack: 0,
        stackedShareCount: 0,
        bestStackedMultiplier: 0,
        effectiveShares: 0,
      } satisfies AggregatedCandidate);

    const quantity = toNumber(holding.quantity);
    const effectiveShares = toNumber(holding.effectiveShares ?? holding.quantity);
    const multiplier = Math.max(1, toNumber(holding.multiplier ?? "1"));

    current.effectiveShares += effectiveShares;

    if (holding.isStackedShare) {
      current.stackedShareCount += quantity;
      current.bestStackedMultiplier = Math.max(current.bestStackedMultiplier, multiplier);
    } else {
      current.regularShares += quantity;
      current.availableToStack += toNumber(holding.availableQuantity ?? holding.quantity);
    }

    aggregatedByPlayer.set(playerId, current);
  }

  const candidates = Array.from(aggregatedByPlayer.values()).map((entry) => {
    const maxStackable = Math.floor(entry.availableToStack / 2) * 2;
    const projectedMultiplier = maxStackable >= 4 ? maxStackable / 2 : 0;
    const eligibilityEntry = eligibilityByPlayerId.get(entry.player.id);

    const candidate: StackingCandidate = {
      playerId: entry.player.id,
      player: entry.player,
      regularShares: entry.regularShares,
      availableToStack: entry.availableToStack,
      maxStackable,
      projectedMultiplier,
      stackedShareCount: entry.stackedShareCount,
      bestStackedMultiplier: entry.bestStackedMultiplier,
      effectiveShares: entry.effectiveShares,
      status: "almost-ready",
      gameStatus: eligibilityEntry?.gameStatus ?? "none",
      gameStartTime: eligibilityEntry?.gameStartTime ?? null,
      hasGameToday: Boolean(eligibilityEntry?.hasGameToday),
      communityBoostCount: eligibilityEntry?.communityBoostCount ?? 0,
      hasCommunityBoost: Boolean(eligibilityEntry?.hasCommunityBoost),
      isAlreadyBoosted: Boolean(eligibilityEntry?.isAlreadyBoosted),
    };

    candidate.status = getCandidateStatus(candidate);
    return candidate;
  });

  return sortStackingCandidates(candidates, "ready");
}
