const standardCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const DEFAULT_COMPACT_CURRENCY_THRESHOLD = 1_000;

const ZERO_CURRENCY = standardCurrencyFormatter.format(0);
const TRAILING_COMPACT_DECIMAL_PATTERN = /\.0(?=[A-Z])/;

function normalizeCurrencyInput(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function formatStandardCurrency(value: number) {
  return standardCurrencyFormatter.format(normalizeCurrencyInput(value));
}

export function formatCompactCurrency(value: number) {
  return compactCurrencyFormatter
    .format(normalizeCurrencyInput(value))
    .replace(TRAILING_COMPACT_DECIMAL_PATTERN, "");
}

export function formatAdaptiveCurrency(
  value: number,
  threshold = DEFAULT_COMPACT_CURRENCY_THRESHOLD,
) {
  const amount = normalizeCurrencyInput(value);
  return Math.abs(amount) >= threshold
    ? compactCurrencyFormatter.format(amount).replace(TRAILING_COMPACT_DECIMAL_PATTERN, "")
    : standardCurrencyFormatter.format(amount);
}

export function formatSignedAdaptiveCurrency(
  value: number | null | undefined,
  {
    nullDisplay = "--",
    threshold = DEFAULT_COMPACT_CURRENCY_THRESHOLD,
    zeroDisplay = ZERO_CURRENCY,
  }: {
    nullDisplay?: string;
    threshold?: number;
    zeroDisplay?: string;
  } = {},
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return nullDisplay;
  }

  if (value === 0) {
    return zeroDisplay;
  }

  const absolute = formatAdaptiveCurrency(Math.abs(value), threshold);
  return value > 0 ? `+${absolute}` : `-${absolute}`;
}
