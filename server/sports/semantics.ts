import type { Game, GameStatus, ProviderMetadata } from "./contracts";

export type StatusResolution = {
  status: GameStatus;
  sourceStatus: string | null;
  statusSource: "provider" | "inferred" | "fallback";
  statusConfidence: "authoritative" | "inferred" | "unknown";
  statusReason: string | null;
};

type SemanticMetricName =
  | "unknown_status"
  | "status_fallback"
  | "duplicate_event"
  | "event_conflict"
  | "identity_conflict";

const semanticMetrics: Record<SemanticMetricName, number> = {
  unknown_status: 0,
  status_fallback: 0,
  duplicate_event: 0,
  event_conflict: 0,
  identity_conflict: 0,
};

export function recordSportsSemanticMetric(name: SemanticMetricName, count = 1) {
  semanticMetrics[name] += Math.max(0, Math.trunc(count));
}

export function readSportsSemanticMetrics() {
  return { ...semanticMetrics };
}

export function resetSportsSemanticMetrics() {
  for (const name of Object.keys(semanticMetrics) as SemanticMetricName[])
    semanticMetrics[name] = 0;
}

export function createProviderMetadata(input: {
  provider: string;
  fetchedAt: Date;
  sourceUpdatedAt?: Date | null;
  staleAfterSeconds: number;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  conflictCount?: number;
  now?: Date;
}): ProviderMetadata {
  const now = input.now || input.fetchedAt;
  const watermark = input.sourceUpdatedAt || input.fetchedAt;
  const ageSeconds = Math.max(0, (now.getTime() - watermark.getTime()) / 1000);
  return {
    provider: input.provider,
    fetchedAt: input.fetchedAt.toISOString(),
    sourceUpdatedAt: input.sourceUpdatedAt?.toISOString() || undefined,
    staleAfterSeconds: input.staleAfterSeconds,
    isStale: ageSeconds > input.staleAfterSeconds,
    fallbackUsed: input.fallbackUsed || undefined,
    fallbackReason: input.fallbackReason || undefined,
    conflictCount: input.conflictCount || undefined,
  };
}

function resolution(
  status: GameStatus,
  sourceStatus: string | null,
  statusSource: StatusResolution["statusSource"] = "provider",
  statusConfidence: StatusResolution["statusConfidence"] = "authoritative",
  statusReason: string | null = null,
): StatusResolution {
  if (status === "unknown") recordSportsSemanticMetric("unknown_status");
  if (statusSource === "fallback") recordSportsSemanticMetric("status_fallback");
  return { status, sourceStatus, statusSource, statusConfidence, statusReason };
}

export function resolveMlbGameStatus(input: {
  abstractGameState?: string | null;
  detailedState?: string | null;
  codedGameState?: string | null;
}): StatusResolution {
  const source = String(
    input.detailedState || input.abstractGameState || input.codedGameState || "",
  ).trim();
  const value = source.toLowerCase();
  const abstract = String(input.abstractGameState || "").toLowerCase();
  if (value.includes("cancel")) return resolution("cancelled", source);
  if (value.includes("suspend")) return resolution("suspended", source);
  if (value.includes("postpon")) return resolution("postponed", source);
  if (abstract === "final" || value.includes("final") || value.includes("completed")) {
    return resolution("final", source);
  }
  if (value.includes("delay")) {
    if (abstract === "live") {
      return resolution(
        "in_progress",
        source,
        "inferred",
        "inferred",
        "Provider reports a delay while the abstract game state remains live.",
      );
    }
    if (abstract === "preview") {
      return resolution(
        "scheduled",
        source,
        "inferred",
        "inferred",
        "Provider reports a pregame delay.",
      );
    }
    return resolution(
      "unknown",
      source,
      "fallback",
      "unknown",
      "Delayed state lacked an authoritative live or preview phase.",
    );
  }
  if (abstract === "live" || value.includes("in progress") || value === "live") {
    return resolution("in_progress", source);
  }
  if (["preview", "scheduled", "pre-game", "pregame"].some((token) => value.includes(token))) {
    return resolution("scheduled", source);
  }
  return resolution("unknown", source || null, "fallback", "unknown", "Unrecognized MLB status.");
}

export function resolveNhlGameStatus(sourceValue: string | null | undefined): StatusResolution {
  const source = String(sourceValue || "").trim();
  const value = source.toUpperCase();
  if (["OFF", "FINAL", "OVER"].includes(value)) return resolution("final", source);
  if (["LIVE", "CRIT", "IN_PROGRESS", "INPROGRESS"].includes(value)) {
    return resolution("in_progress", source);
  }
  if (["PPD", "POSTPONED"].includes(value)) return resolution("postponed", source);
  if (["SUSP", "SUSPENDED"].includes(value)) return resolution("suspended", source);
  if (["CANC", "CANCELLED", "CANCELED"].includes(value)) return resolution("cancelled", source);
  if (["FUT", "PRE", "SCHEDULED"].includes(value)) return resolution("scheduled", source);
  return resolution("unknown", source || null, "fallback", "unknown", "Unrecognized NHL status.");
}

export function resolveNascarScheduleStatus(input: {
  actualLaps?: number | null;
  actualDistance?: number | null;
}): StatusResolution {
  const actualLaps = Number(input.actualLaps || 0);
  const actualDistance = Number(input.actualDistance || 0);
  if (actualLaps > 0 && actualDistance > 0) {
    return resolution(
      "final",
      "actual_results_present",
      "inferred",
      "inferred",
      "NASCAR schedule feed exposes completed distance and lap totals but no canonical status field.",
    );
  }
  return resolution(
    "scheduled",
    "no_actual_results",
    "inferred",
    "inferred",
    "NASCAR schedule feed has no completed result totals.",
  );
}

export function resolveNascarLiveStatus(input: {
  lapNumber?: number | null;
  lapsToGo?: number | null;
  flagState?: number | null;
}): StatusResolution {
  const lap = Number(input.lapNumber || 0);
  const remaining = Number(input.lapsToGo);
  const flag = Number(input.flagState);
  if ((Number.isFinite(remaining) && remaining <= 0) || [8, 9].includes(flag)) {
    return resolution("final", `flag:${flag}`, "provider", "authoritative");
  }
  if (lap > 0) return resolution("in_progress", `flag:${flag}`, "provider", "authoritative");
  if (lap == 0 && (!Number.isFinite(flag) || flag == 0)) {
    return resolution(
      "scheduled",
      Number.isFinite(flag) ? `flag:${flag}` : null,
      "inferred",
      "inferred",
    );
  }
  return resolution(
    "unknown",
    `flag:${flag}`,
    "fallback",
    "unknown",
    "Unrecognized NASCAR live state.",
  );
}

export type NascarParticipantResultStatus =
  | "running"
  | "finished"
  | "dnf"
  | "dns"
  | "dnq"
  | "disqualified"
  | "unknown";

export function normalizeNascarParticipantResultStatus(
  value: unknown,
): NascarParticipantResultStatus {
  const source = String(value || "")
    .trim()
    .toLowerCase();
  if (["running", "on track"].includes(source)) return "running";
  if (["finished", "finish"].includes(source)) return "finished";
  if (source.includes("did not qualify") || source === "dnq") return "dnq";
  if (source.includes("did not start") || source === "dns") return "dns";
  if (source.includes("disqual") || source === "dq") return "disqualified";
  if (
    source === "dnf" ||
    source.includes("accident") ||
    source.includes("engine") ||
    source.includes("crash")
  )
    return "dnf";
  return "unknown";
}

function statusRank(status: GameStatus): number {
  return {
    unknown: 0,
    scheduled: 1,
    postponed: 2,
    suspended: 3,
    cancelled: 4,
    in_progress: 5,
    final: 6,
  }[status];
}

function metadataTime(game: Game): number {
  const value = game.provider.sourceUpdatedAt || game.provider.fetchedAt;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function reconcileAndSortGames(games: Game[]): Game[] {
  const byId = new Map<string, Game>();
  for (const candidate of games) {
    const current = byId.get(candidate.id);
    if (!current) {
      byId.set(candidate.id, candidate);
      continue;
    }
    recordSportsSemanticMetric("duplicate_event");
    const conflict =
      current.status !== candidate.status ||
      current.startsAt !== candidate.startsAt ||
      current.homeTeamId !== candidate.homeTeamId ||
      current.awayTeamId !== candidate.awayTeamId;
    if (conflict) recordSportsSemanticMetric("event_conflict");
    const candidateNewer = metadataTime(candidate) > metadataTime(current);
    const preferred =
      candidateNewer ||
      (!candidateNewer && statusRank(candidate.status) > statusRank(current.status))
        ? candidate
        : current;
    byId.set(preferred.id, {
      ...preferred,
      provider: {
        ...preferred.provider,
        conflictCount: (preferred.provider.conflictCount || 0) + (conflict ? 1 : 0),
      },
    });
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      (left.seriesId || "").localeCompare(right.seriesId || "") ||
      left.id.localeCompare(right.id),
  );
}
