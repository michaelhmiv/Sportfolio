/**
 * Exact decimal-string helpers for collection quantity display.
 *
 * Never uses parseFloat/Number — quantities are arbitrary-precision
 * decimal strings (up to 4 fractional digits) and display must be exact.
 */

/** Matches trailing zeros at end of string, capturing the dot and any non-zero digits. */
const TRAILING_FRACTIONAL_ZEROS_RE = /(\.\d*?)0+$/;
const TRAILING_DOT_RE = /\.$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,4}))?$/;

/** Trim trailing fractional zeros from a canonical decimal string. */
export function formatCanonicalQuantity(value: string): string {
  const clean = value.replace(TRAILING_FRACTIONAL_ZEROS_RE, "$1").replace(TRAILING_DOT_RE, "");
  return clean || "0";
}

/**
 * Convert basis points to an exact percentage string (2 decimal places).
 *
 * 0     → "0.00"
 * 9999  → "99.99"
 * 10000 → "100.00"
 * 1     → "0.01"
 *
 * Never rounds at boundary — 9999 is 99.99, not 100.
 */
export function basisPointsToPercentString(bps: number): string {
  if (!Number.isFinite(bps)) return "0.00";
  const integer = Math.max(0, Math.min(1_000_000, Math.trunc(bps)));
  const integerPart = Math.floor(integer / 100);
  const fractionalPart = integer % 100;
  const fracStr = fractionalPart.toString().padStart(2, "0");
  return `${integerPart}.${fracStr}`;
}

/**
 * Convert basis points to a value 0–100 suitable for Progress components.
 *
 * Returns the exact integer percentage floor (0 for 0 bps, 99 for 9999 bps,
 * 100 for 10000 bps and above). Never rounds up prematurely.
 */
export function basisPointsToProgressValue(bps: number): number {
  if (!Number.isFinite(bps) || bps < 0) return 0;
  if (bps >= 10_000) return 100;
  return Math.trunc(bps) / 100;
}

/**
 * Compute allocation progress percentage as a human-readable string
 * e.g. "99.99%" or "100.00%". Never rounds to 100 before 10000 bps.
 */
export function allocationProgressDisplay(bps: number): string {
  return `${basisPointsToPercentString(bps)}%`;
}

/** Validate that a string looks like a valid canonical decimal quantity. */
export function looksLikeCanonicalQuantity(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

function canonicalQuantityUnits(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid canonical quantity: ${value}`);
  return BigInt(match[1]) * BigInt(10_000) + BigInt((match[2] ?? "").padEnd(4, "0"));
}

export function compareCanonicalQuantities(left: string, right: string): -1 | 0 | 1 {
  const leftUnits = canonicalQuantityUnits(left);
  const rightUnits = canonicalQuantityUnits(right);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

/**
 * Parse a user-facing input string into a canonical quantity string.
 * Strips leading/trailing whitespace, handles "." prefix, allows whole numbers.
 * Returns null for unparseable input (caller should validate/disallow).
 */
export function parseUserQuantityInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow ".5" → "0.5"
  let normalized = trimmed;
  if (normalized.startsWith(".")) {
    normalized = "0" + normalized;
  }
  // Remove trailing decimal point: "5." → "5"
  if (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }

  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;

  const integerPart = match[1];
  const fractionalPart = (match[2] ?? "").padEnd(4, "0").slice(0, 4);
  if (integerPart === "0" && fractionalPart === "0000") return "0.0000";
  return `${integerPart}.${fractionalPart}`;
}
