import { hasGameStartedForBoost } from "@shared/game-status";
import { BOOST_SLOT_MULTIPLIERS, isBoostSlotMultiplier } from "../economy/config";
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
  shares: number;
  etDate?: string | Date;
}

export interface AssignDailyBoostResult {
  boost: Awaited<ReturnType<typeof storage.createDailyBoost>>;
  canonicalPlayerId: string;
  sharesCommitted: number;
}

function resolveEtDate(input?: string | Date): string {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (input instanceof Date) return getGameDay(input);
  return getTodayET();
}

function normalizeShares(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DailyBoostValidationError("Boost share quantity must be greater than zero.");
  }
  return Math.round(value * 10_000) / 10_000;
}

export async function assignDailyBoostWithValidation(
  input: AssignDailyBoostInput,
): Promise<AssignDailyBoostResult> {
  const sportUpper = input.sport.toUpperCase();
  const shares = normalizeShares(input.shares);
  if (!isBoostSlotMultiplier(input.slotTier)) {
    throw new DailyBoostValidationError(
      `Invalid boost slot. Choose one of ${BOOST_SLOT_MULTIPLIERS.join("x, ")}x.`,
    );
  }

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
  if (currentBoosts.length >= BOOST_SLOT_MULTIPLIERS.length) {
    throw new DailyBoostValidationError("All 5 boost slots are already filled");
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
  if (availableShares + 1e-9 < shares) {
    throw new DailyBoostValidationError(
      `Not enough available shares. You have ${availableShares.toFixed(4)} available.`,
    );
  }

  const boost = await storage.createDailyBoost({
    userId: input.userId,
    playerId: canonicalPlayerId,
    sport: sportUpper,
    slotTier: input.slotTier,
    boostDate: startOfDay,
    sharesEntered: shares as any,
    gameId: game.gameId,
  } as any);

  try {
    // reserveShares rechecks available quantity transactionally, preventing a simultaneous sell/Boost
    // from spending the same inventory twice.
    await storage.reserveShares(
      input.userId,
      "player",
      canonicalPlayerId,
      "boost",
      boost.id,
      shares,
    );
  } catch (error) {
    await storage.deleteDailyBoost(boost.id).catch(() => undefined);
    throw error;
  }

  return { boost, canonicalPlayerId, sharesCommitted: shares };
}
