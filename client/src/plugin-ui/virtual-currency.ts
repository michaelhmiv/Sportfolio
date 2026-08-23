export const SPORTFOLIO_CURRENCY_UNIT = "SB";
export const SPORTFOLIO_CURRENCY_NAME = "Sportfolio Bucks";

export function formatSportfolioBucks(
  value: number,
  locale?: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(amount);
  return formatted + " " + SPORTFOLIO_CURRENCY_UNIT;
}
