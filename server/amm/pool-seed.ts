export const INITIAL_POOL_SHARES = 50000;
export const INITIAL_POOL_PLAY_MONEY = 500000;
export const INITIAL_POOL_K = INITIAL_POOL_SHARES * INITIAL_POOL_PLAY_MONEY;
export const LEGACY_POOL_SHARES = 1000;
export const LEGACY_POOL_PLAY_MONEY = 10000;
export const LEGACY_POOL_K = LEGACY_POOL_SHARES * LEGACY_POOL_PLAY_MONEY;
export const LEGACY_POOL_LP_SHARES = 1000;

const POOL_VALUE_EPSILON = 0.0001;
const POOL_INVARIANT_EPSILON = 0.01;

type NumericLike = number | string | null | undefined;

export interface SeedPoolLike {
  shares: NumericLike;
  playMoney: NumericLike;
  k: NumericLike;
  lpSharesTotal: NumericLike;
  totalTrades: number;
}

function toFiniteNumber(value: NumericLike): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return parseFloat(value);
  }
  return Number.NaN;
}

function approximatelyEqual(value: number, target: number, epsilon = POOL_VALUE_EPSILON): boolean {
  return Math.abs(value - target) < epsilon;
}

export function hasPoolInvariantMismatch(pool: SeedPoolLike): boolean {
  const shares = toFiniteNumber(pool.shares);
  const playMoney = toFiniteNumber(pool.playMoney);
  const k = toFiniteNumber(pool.k);

  if (!isFinite(shares) || shares <= 0 || !isFinite(playMoney) || playMoney <= 0) {
    return true;
  }

  if (!isFinite(k) || k <= 0) {
    return true;
  }

  const expectedK = shares * playMoney;
  return Math.abs(expectedK - k) > POOL_INVARIANT_EPSILON;
}

export function shouldRepairSeedLiquidity(pool: SeedPoolLike): boolean {
  const shares = toFiniteNumber(pool.shares);
  const playMoney = toFiniteNumber(pool.playMoney);
  const lpSharesTotal = toFiniteNumber(pool.lpSharesTotal);

  const hasInvalidLiquidity =
    !isFinite(shares) ||
    shares <= 0 ||
    !isFinite(playMoney) ||
    playMoney <= 0 ||
    !isFinite(lpSharesTotal) ||
    lpSharesTotal <= 0;

  const hasLegacyDefaults =
    approximatelyEqual(shares, LEGACY_POOL_SHARES) &&
    approximatelyEqual(playMoney, LEGACY_POOL_PLAY_MONEY) &&
    approximatelyEqual(lpSharesTotal, LEGACY_POOL_LP_SHARES);

  return (
    pool.totalTrades === 0 &&
    (hasInvalidLiquidity || hasLegacyDefaults || hasPoolInvariantMismatch(pool))
  );
}
