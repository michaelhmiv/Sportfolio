const HOLDING_LOCK_QUANTITY_SCALE = 4;
const HOLDING_LOCK_MAX_EXCLUSIVE = 10 ** 16;
const HOLDING_LOCK_PRECISION_EPSILON = 1e-9;

/**
 * Converts a positive share quantity to the exact string shape used by
 * holdings_locks.numeric(20,4), rejecting values that PostgreSQL would round.
 */
export function normalizeHoldingLockQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Lock quantity must be a positive finite number");
  }

  if (quantity >= HOLDING_LOCK_MAX_EXCLUSIVE) {
    throw new Error("Lock quantity exceeds numeric(20,4)");
  }

  const normalized = quantity.toFixed(HOLDING_LOCK_QUANTITY_SCALE);
  const normalizedNumber = Number(normalized);
  if (
    normalizedNumber <= 0 ||
    Math.abs(normalizedNumber - quantity) > HOLDING_LOCK_PRECISION_EPSILON
  ) {
    throw new Error("Lock quantity supports at most four decimal places");
  }

  return normalized;
}
