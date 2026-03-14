import type { Holding } from "@shared/schema";

type RegularBoostHoldingRow = Pick<
  Holding,
  "id" | "assetId" | "quantity" | "avgCostBasis" | "lastUpdated"
>;

export interface RegularBoostHoldingSelection {
  holding: RegularBoostHoldingRow;
  availableQuantity: number;
  lockedQuantity: number;
}

interface PickRegularBoostHoldingArgs {
  holdingsRows: RegularBoostHoldingRow[];
  canonicalPlayerId: string;
  lockedByAssetId: ReadonlyMap<string, number>;
  sharesToBurn: number;
}

function parseQuantity(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function pickRegularBoostHolding({
  holdingsRows,
  canonicalPlayerId,
  lockedByAssetId,
  sharesToBurn,
}: PickRegularBoostHoldingArgs): RegularBoostHoldingSelection | undefined {
  return holdingsRows
    .map((holding) => {
      const lockedQuantity = lockedByAssetId.get(holding.assetId) ?? 0;
      const availableQuantity = Math.max(0, parseQuantity(holding.quantity) - lockedQuantity);

      return {
        holding,
        availableQuantity,
        lockedQuantity,
      };
    })
    .filter((candidate) => candidate.availableQuantity >= sharesToBurn)
    .sort((left, right) => {
      if (right.availableQuantity !== left.availableQuantity) {
        return right.availableQuantity - left.availableQuantity;
      }

      const rightCanonical = right.holding.assetId === canonicalPlayerId ? 1 : 0;
      const leftCanonical = left.holding.assetId === canonicalPlayerId ? 1 : 0;
      if (rightCanonical !== leftCanonical) {
        return rightCanonical - leftCanonical;
      }

      const quantityDiff =
        parseQuantity(right.holding.quantity) - parseQuantity(left.holding.quantity);
      if (quantityDiff !== 0) {
        return quantityDiff;
      }

      return getTime(right.holding.lastUpdated) - getTime(left.holding.lastUpdated);
    })[0];
}
