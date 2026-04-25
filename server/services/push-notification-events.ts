import { sendPushNotificationBestEffort } from "./push-notifications";

export async function notifyBoostSettledPush(input: {
  userId: string;
  boostId: string;
  playerName: string;
  payout: string;
  fantasyPoints: number;
  slotTier: number;
}) {
  const payoutValue = Number.parseFloat(input.payout || "0");
  const payoutLabel = Number.isFinite(payoutValue) ? `$${payoutValue.toFixed(2)}` : "$0.00";
  const fpLabel = Number.isFinite(input.fantasyPoints) ? input.fantasyPoints.toFixed(1) : "0.0";

  return sendPushNotificationBestEffort({
    userId: input.userId,
    type: "boost_settled",
    title: `Boost settled: ${input.playerName}`,
    body: `${payoutLabel} payout at ${input.slotTier}x slot (${fpLabel} FP).`,
    route: "/boosts",
    entityType: "daily_boost",
    entityId: input.boostId,
    dedupeKey: `boost_settled:${input.userId}:${input.boostId}`,
    metadata: {
      payout: payoutLabel,
      fantasyPoints: fpLabel,
      slotTier: input.slotTier,
    },
  });
}

export async function notifyScoutCompletePush(input: {
  userId: string;
  hourTimestampIso: string;
  totalShares: number;
  playerCount: number;
  highlightPlayerName?: string | null;
}) {
  const sharesLabel = Number.isFinite(input.totalShares) ? input.totalShares.toFixed(2) : "0.00";
  const playerCountLabel = Math.max(0, Math.trunc(input.playerCount));
  const highlight =
    input.highlightPlayerName && input.highlightPlayerName.trim().length > 0
      ? ` Top scout: ${input.highlightPlayerName}.`
      : "";

  return sendPushNotificationBestEffort({
    userId: input.userId,
    type: "scout_complete",
    title: "Scouting complete",
    body: `${sharesLabel} shares generated across ${playerCountLabel} player${playerCountLabel === 1 ? "" : "s"}.${highlight}`,
    route: "/portfolio",
    entityType: "scout_distribution",
    entityId: input.hourTimestampIso,
    dedupeKey: `scout_complete:${input.userId}:${input.hourTimestampIso}`,
    metadata: {
      totalShares: sharesLabel,
      playerCount: playerCountLabel,
      highlightPlayerName: input.highlightPlayerName ?? null,
    },
  });
}

export async function notifyScoutCapacityAvailablePush(input: {
  userId: string;
  dateKey: string;
  remainingScouts: number;
  maxScouts: number;
}) {
  const remaining = Math.max(0, Math.trunc(input.remainingScouts));
  const maxScouts = Math.max(0, Math.trunc(input.maxScouts));
  if (remaining <= 0) {
    return {
      delivered: false,
      status: "skipped_no_tokens" as const,
      successCount: 0,
      failureCount: 0,
    };
  }

  return sendPushNotificationBestEffort({
    userId: input.userId,
    type: "scout_capacity_available",
    title: "Scouts ready to assign",
    body: `${remaining}/${maxScouts} scout slot${remaining === 1 ? "" : "s"} are open.`,
    route: "/portfolio",
    entityType: "scout_capacity",
    entityId: input.dateKey,
    dedupeKey: `scout_capacity_available:${input.userId}:${input.dateKey}`,
    metadata: {
      remainingScouts: remaining,
      maxScouts,
    },
  });
}

export async function notifyBoostLockingSoonPush(input: {
  userId: string;
  boostId: string;
  playerName: string;
  minutesUntilLock: number;
}) {
  const minutes = Math.max(1, Math.round(input.minutesUntilLock));
  return sendPushNotificationBestEffort({
    userId: input.userId,
    type: "boost_locking_soon",
    title: `Boost locking soon: ${input.playerName}`,
    body: `Your boost locks in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    route: "/boosts",
    entityType: "daily_boost",
    entityId: input.boostId,
    dedupeKey: `boost_locking_soon:${input.userId}:${input.boostId}`,
    metadata: {
      minutesUntilLock: minutes,
    },
  });
}
