interface StackSharesMessageInput {
  singlesStacked: number;
  newStackPower: number;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCompactUnits(value: number): string {
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

export function buildStackSharesSuccessMessage(input: StackSharesMessageInput): string {
  const singles = Math.max(0, toFiniteNumber(input.singlesStacked));
  const stackPower = Math.max(0, toFiniteNumber(input.newStackPower));

  if (singles > 0 && stackPower > 0) {
    return `Stacked ${formatCompactUnits(singles)} shares. Stack is now ${formatCompactUnits(stackPower)}p.`;
  }

  if (singles > 0) {
    return `Stacked ${formatCompactUnits(singles)} shares.`;
  }

  if (stackPower > 0) {
    return `Stack updated. Stack is now ${formatCompactUnits(stackPower)}p.`;
  }

  return "Stack updated successfully.";
}

export interface StackSharesResponsePayload {
  success: true;
  multiplier: string;
  newMultiplier: string;
  sharesStacked: number;
  multiplierGained: string;
  effectiveSharesBurned: number;
  singlesStacked: number;
  powerAdded: number;
  newStackPower: number;
  stackPower: number;
  holding: unknown;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    team: string;
  } | null;
  message: string;
}

interface BuildStackSharesResponseInput {
  sharesStacked: number;
  multiplier: string;
  newMultiplier: string;
  effectiveSharesBurned: number;
  holding: unknown;
  player: {
    id: string;
    firstName: string;
    lastName: string;
    team: string;
  } | null;
}

export function buildStackSharesResponsePayload(
  input: BuildStackSharesResponseInput,
): StackSharesResponsePayload {
  const singlesStacked = Math.max(0, toFiniteNumber(input.sharesStacked));
  const powerAdded = singlesStacked / 2;
  const newStackPower = Math.max(
    0,
    toFiniteNumber(input.newMultiplier || input.multiplier || powerAdded),
  );

  return {
    success: true,
    multiplier: input.multiplier,
    newMultiplier: input.newMultiplier,
    sharesStacked: singlesStacked,
    multiplierGained: powerAdded.toFixed(2),
    effectiveSharesBurned: input.effectiveSharesBurned,
    singlesStacked,
    powerAdded,
    newStackPower,
    stackPower: newStackPower,
    holding: input.holding,
    player: input.player,
    message: buildStackSharesSuccessMessage({
      singlesStacked,
      newStackPower,
    }),
  };
}
