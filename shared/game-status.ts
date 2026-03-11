export type EffectiveGameStatus = "scheduled" | "inprogress" | "completed" | "postponed";
export type MarketplaceGameStatus = "none" | "upcoming" | "live" | "ended";

export interface GameStatusInput {
  status?: string | null;
  startTime?: Date | string | null;
  liveMarketStatus?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

const SCHEDULED_STALE_WINDOW_MS = 3 * 60 * 60 * 1000;

function normalizeStatus(status: string | null | undefined): string {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function parseStartTime(startTime: Date | string | null | undefined): Date | null {
  if (!startTime) {
    return null;
  }

  const parsed =
    startTime instanceof Date ? new Date(startTime.getTime()) : new Date(String(startTime));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasLiveSignal(game: GameStatusInput): boolean {
  return (
    String(game.liveMarketStatus || "").trim().length > 0 ||
    game.homeScore !== null ||
    game.awayScore !== null
  );
}

export function getEffectiveGameStatus(
  game: GameStatusInput,
  now: Date = new Date(),
): EffectiveGameStatus {
  const normalizedStatus = normalizeStatus(game.status);
  const startTime = parseStartTime(game.startTime);
  const timeSinceStart = startTime ? now.getTime() - startTime.getTime() : null;

  if (
    normalizedStatus === "postponed" ||
    normalizedStatus === "cancelled" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "delayed" ||
    normalizedStatus === "suspended"
  ) {
    return "postponed";
  }

  if (
    normalizedStatus === "completed" ||
    normalizedStatus === "ended" ||
    normalizedStatus === "final"
  ) {
    return "completed";
  }

  if (normalizedStatus === "inprogress" || normalizedStatus === "live") {
    return "inprogress";
  }

  if (
    normalizedStatus === "scheduled" &&
    hasLiveSignal(game) &&
    timeSinceStart !== null &&
    timeSinceStart > 0 &&
    timeSinceStart < SCHEDULED_STALE_WINDOW_MS
  ) {
    return "inprogress";
  }

  if (
    normalizedStatus === "scheduled" &&
    timeSinceStart !== null &&
    timeSinceStart >= SCHEDULED_STALE_WINDOW_MS
  ) {
    return "completed";
  }

  return "scheduled";
}

export function getMarketplaceGameStatus(
  game: GameStatusInput | null | undefined,
  now: Date = new Date(),
): MarketplaceGameStatus {
  if (!game) {
    return "none";
  }

  const effectiveStatus = getEffectiveGameStatus(game, now);

  if (effectiveStatus === "postponed") {
    return "none";
  }

  if (effectiveStatus === "completed") {
    return "ended";
  }

  if (effectiveStatus === "inprogress") {
    return "live";
  }

  return "upcoming";
}

export function hasGameStartedForBoost(
  game: GameStatusInput | null | undefined,
  now: Date = new Date(),
): boolean {
  const status = getMarketplaceGameStatus(game, now);
  return status === "live" || status === "ended";
}
