function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export interface PerformanceEarningHoldingLike {
  quantity?: number | string | null;
  effectiveShares?: number | string | null;
  multiplier?: number | string | null;
  isStackedShare?: boolean | null;
}

export function getPerformanceEarningUnits(holding: PerformanceEarningHoldingLike): number {
  const quantity = toNumber(holding.quantity);
  const effectiveShares = toNumber(holding.effectiveShares);
  const multiplier = toNumber(holding.multiplier);
  const isStacked =
    Boolean(holding.isStackedShare) ||
    multiplier > 1 ||
    (quantity > 0 && effectiveShares > quantity);

  if (!isStacked) {
    return 0;
  }

  if (effectiveShares > 0) {
    return effectiveShares;
  }

  return multiplier > 0 ? multiplier : 0;
}
