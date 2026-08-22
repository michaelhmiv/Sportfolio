export const DISCORD_SUPPORTED_SPORTS = ["ALL", "NBA", "NFL", "MLB", "NASCAR"] as const;
export type DiscordSupportedSport = (typeof DISCORD_SUPPORTED_SPORTS)[number];

export type ParsedAmountKind = "absolute" | "percent" | "max";
export type ResolvedAmountKind = "currency" | "whole" | "shares";

const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)%$/;

export interface ParsedAmountInput {
  kind: ParsedAmountKind;
  input: string;
  value: number;
}

export interface ResolvedAmountInput {
  kind: ParsedAmountKind;
  input: string;
  value: number;
  baseAmount: number;
  derivedFromBase: boolean;
}

export function normalizeDiscordSport(
  sportInput: string | null | undefined,
  defaultValue: DiscordSupportedSport = "ALL",
): DiscordSupportedSport | null {
  const normalized = (sportInput || defaultValue).trim().toUpperCase();
  return DISCORD_SUPPORTED_SPORTS.includes(normalized as DiscordSupportedSport)
    ? (normalized as DiscordSupportedSport)
    : null;
}

export function parseAmountInput(rawInput: string): ParsedAmountInput | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === "max") {
    return {
      kind: "max",
      input: trimmed,
      value: 1,
    };
  }

  const percentMatch = lower.match(PERCENT_PATTERN);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;

    return {
      kind: "percent",
      input: trimmed,
      value: percent / 100,
    };
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  return {
    kind: "absolute",
    input: trimmed,
    value: numeric,
  };
}

function floorToCents(value: number): number {
  return Math.floor(value * 100) / 100;
}

function floorToShares(value: number): number {
  return Math.floor((value + 1e-9) * 10_000) / 10_000;
}

export function resolveAmountInput(config: {
  rawInput: string;
  baseAmount: number;
  kind: ResolvedAmountKind;
  minimum: number;
}): ResolvedAmountInput | null {
  const parsed = parseAmountInput(config.rawInput);
  if (!parsed) return null;

  let resolvedRaw = parsed.value;
  if (parsed.kind === "max") {
    resolvedRaw = config.baseAmount;
  } else if (parsed.kind === "percent") {
    resolvedRaw = config.baseAmount * parsed.value;
  }

  let resolvedValue = resolvedRaw;
  if (config.kind === "currency") {
    resolvedValue = floorToCents(resolvedRaw);
  } else if (config.kind === "whole") {
    resolvedValue = Math.floor(resolvedRaw);
  } else if (config.kind === "shares") {
    resolvedValue = floorToShares(resolvedRaw);
  } else {
    resolvedValue = Math.floor(resolvedRaw);
  }

  if (!Number.isFinite(resolvedValue) || resolvedValue < config.minimum) {
    return null;
  }

  return {
    kind: parsed.kind,
    input: parsed.input,
    value: resolvedValue,
    baseAmount: config.baseAmount,
    derivedFromBase: parsed.kind !== "absolute",
  };
}
