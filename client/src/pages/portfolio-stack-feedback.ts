export interface StackSharesResponse {
  success?: boolean;
  message?: string | null;
  sharesStacked?: number | string | null;
  singlesStacked?: number | string | null;
  multiplierGained?: string | number | null;
  powerAdded?: number | string | null;
  newMultiplier?: string | number | null;
  newStackPower?: number | string | null;
  stackPower?: number | string | null;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatPortfolioUnits(value: number): string {
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

export function formatStackToastMessage(payload: StackSharesResponse): string {
  const singlesStacked = Math.max(
    0,
    toFiniteNumber(payload.singlesStacked ?? payload.sharesStacked),
  );
  const powerAdded = Math.max(0, toFiniteNumber(payload.powerAdded ?? payload.multiplierGained));
  const stackPower = Math.max(
    0,
    toFiniteNumber(payload.newStackPower ?? payload.stackPower ?? payload.newMultiplier),
  );

  if (singlesStacked > 0 && stackPower > 0) {
    return `Stacked ${formatPortfolioUnits(singlesStacked)} shares. Stack is now ${formatPortfolioUnits(stackPower)}p.`;
  }

  if (powerAdded > 0 && stackPower > 0) {
    return `Added ${formatPortfolioUnits(powerAdded)}p. Stack is now ${formatPortfolioUnits(stackPower)}p.`;
  }

  const fallbackMessage = payload.message?.trim();
  if (fallbackMessage) {
    return fallbackMessage;
  }

  if (singlesStacked > 0) {
    return `Stacked ${formatPortfolioUnits(singlesStacked)} shares.`;
  }

  return "Stack updated successfully.";
}
