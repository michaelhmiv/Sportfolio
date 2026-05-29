import { hasGameStartedForBoost } from "@shared/game-status";
import { getETDayBoundaries, getGameDay, getTodayET } from "../lib/time";
import { storage } from "../storage";

export class DailyBoostValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "DailyBoostValidationError";
    this.statusCode = statusCode;
  }
}

export interface AssignDailyBoostInput {
  userId: string;
  playerId: string;
  sport: string;
  slotTier: number;
  etDate?: string | Date;
}

export interface AssignDailyBoostResult {
  boost: Awaited<ReturnType<typeof storage.createDailyBoost>>;
  canonicalPlayerId: string;
  shareMultiplier: string;
  shareSourceType: "stacked" | "regular";
}

function resolveEtDate(input?: string | Date): string {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }
  if (input instanceof Date) {
    return getGameDay(input);
  }
  return getTodayET();
}

export async function assignDailyBoostWithValidation(
  input: AssignDailyBoostInput,
): Promise<AssignDailyBoostResult> {
  const sportUpper = input.sport.toUpperCase();
  const canonicalPlayerId =
    typeof (storage as any).getCanonicalPlayerId === "function"
      ? await (storage as any).getCanonicalPlayerId(input.playerId)
      : input.playerId;

  const dateStr = resolveEtDate(input.etDate);
  const { startOfDay } = getETDayBoundaries(dateStr);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  const currentBoosts = await storage.getDailyBoosts(input.userId, sportUpper, targetDate);
  if (currentBoosts.some((boost) => boost.slotTier === input.slotTier)) {
    throw new DailyBoostValidationError(`Slot ${input.slotTier}x is already occupied`);
  }
  if (currentBoosts.some((boost) => boost.playerId === canonicalPlayerId)) {
    throw new DailyBoostValidationError("This player is already in a boost slot");
  }
  if (currentBoosts.length >= 4) {
    throw new DailyBoostValidationError("All 4 boost slots are already filled");
  }

  const game = await storage.getPlayerGameForDate(canonicalPlayerId, sportUpper, targetDate);
  if (!game) {
    throw new DailyBoostValidationError("This player doesn't have a game today");
  }
  if (hasGameStartedForBoost(game)) {
    throw new DailyBoostValidationError("Cannot add boost - player's game has already started");
  }

  const availableShares = await storage.getAvailableShares(
    input.userId,
    "player",
    canonicalPlayerId,
  );
  if (availableShares < 1) {
    throw new DailyBoostValidationError(
      `Not enough available shares. You have ${availableShares} available.`,
    );
  }

  const breakdown = await storage.getPlayerShareBreakdown(input.userId, canonicalPlayerId);
  const candidates = [
    ...(breakdown.stacked || [])
      .filter((holding) => Number.parseFloat(holding.quantity) >= 1)
      .map((holding) => ({
        multiplier: Number.parseFloat(holding.multiplier || "1"),
        isStackedShare: true,
      })),
    ...(breakdown.regular && Number.parseFloat(breakdown.regular.quantity) >= 1
      ? [
          {
            multiplier: 1,
            isStackedShare: false,
          },
        ]
      : []),
  ].sort((left, right) => right.multiplier - left.multiplier);

  const selectedHolding = candidates[0];
  if (!selectedHolding) {
    throw new DailyBoostValidationError("No shares available for this player");
  }

  const shareMultiplier = selectedHolding.multiplier.toFixed(2);
  const shareSourceType: "stacked" | "regular" = selectedHolding.isStackedShare
    ? "stacked"
    : "regular";

  const boost = await storage.createDailyBoost({
    userId: input.userId,
    playerId: canonicalPlayerId,
    sport: sportUpper,
    slotTier: input.slotTier,
    boostDate: startOfDay,
    sharesEntered: 1,
    shareMultiplier,
    shareSourceType,
    gameId: game.gameId,
  });

  return {
    boost,
    canonicalPlayerId,
    shareMultiplier,
    shareSourceType,
  };
}
