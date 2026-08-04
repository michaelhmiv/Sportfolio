from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

semantics = r'''import type { Game, GameStatus, ProviderMetadata } from "./contracts";

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
  for (const name of Object.keys(semanticMetrics) as SemanticMetricName[]) semanticMetrics[name] = 0;
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
  const source = String(input.detailedState || input.abstractGameState || input.codedGameState || "").trim();
  const value = source.toLowerCase();
  const abstract = String(input.abstractGameState || "").toLowerCase();
  if (value.includes("cancel")) return resolution("cancelled", source);
  if (value.includes("suspend")) return resolution("suspended", source);
  if (value.includes("postpon")) return resolution("postponed", source);
  if (abstract === "final" || value.includes("final") || value.includes("completed")) {
    return resolution("final", source);
  }
  if (abstract === "live" || value.includes("in progress") || value === "live") {
    return resolution("in_progress", source);
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
    return resolution("scheduled", Number.isFinite(flag) ? `flag:${flag}` : null, "inferred", "inferred");
  }
  return resolution("unknown", `flag:${flag}`, "fallback", "unknown", "Unrecognized NASCAR live state.");
}

export type NascarParticipantResultStatus =
  | "running"
  | "finished"
  | "dnf"
  | "dns"
  | "dnq"
  | "disqualified"
  | "unknown";

export function normalizeNascarParticipantResultStatus(value: unknown): NascarParticipantResultStatus {
  const source = String(value || "").trim().toLowerCase();
  if (["running", "on track"].includes(source)) return "running";
  if (["finished", "finish"].includes(source)) return "finished";
  if (source.includes("did not qualify") || source === "dnq") return "dnq";
  if (source.includes("did not start") || source === "dns") return "dns";
  if (source.includes("disqual") || source === "dq") return "disqualified";
  if (source === "dnf" || source.includes("accident") || source.includes("engine") || source.includes("crash")) return "dnf";
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
    const preferred = candidateNewer || (!candidateNewer && statusRank(candidate.status) > statusRank(current.status))
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
'''
(ROOT / "server/sports/semantics.ts").write_text(semantics)

contracts_path = ROOT / "server/sports/contracts.ts"
contracts = contracts_path.read_text()
contracts = replace_once(
    contracts,
    '''  staleAfterSeconds: z.number().int().nonnegative(),
  isStale: z.boolean(),''',
    '''  staleAfterSeconds: z.number().int().nonnegative(),
  isStale: z.boolean(),
  fallbackUsed: z.boolean().optional(),
  fallbackReason: z.string().nullable().optional(),
  conflictCount: z.number().int().nonnegative().optional(),''',
    "provider semantic metadata",
)
contracts = replace_once(
    contracts,
    '''  "postponed",
  "cancelled",
  "unknown",''',
    '''  "postponed",
  "suspended",
  "cancelled",
  "unknown",''',
    "suspended status",
)
contracts = replace_once(
    contracts,
    '''  seriesId: z.string().nullable().optional(),
  provider: providerMetadataSchema,''',
    '''  seriesId: z.string().nullable().optional(),
  seasonId: z.string().nullable().optional(),
  sourceStatus: z.string().nullable().optional(),
  statusSource: z.enum(["provider", "inferred", "fallback"]).optional(),
  statusConfidence: z.enum(["authoritative", "inferred", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
  eventOrderKey: z.string().optional(),
  provider: providerMetadataSchema,''',
    "game semantic fields",
)
contracts = replace_once(
    contracts,
    '''  summary: z.string().nullable(),
  provider: providerMetadataSchema,''',
    '''  summary: z.string().nullable(),
  sourceStatus: z.string().nullable().optional(),
  statusSource: z.enum(["provider", "inferred", "fallback"]).optional(),
  statusConfidence: z.enum(["authoritative", "inferred", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
  phase: z
    .object({
      kind: z.enum(["inning", "period", "stage", "lap", "session"]),
      number: z.number().nullable(),
      label: z.string().nullable(),
    })
    .nullable()
    .optional(),
  progress: z
    .object({
      current: z.number().nullable(),
      total: z.number().nullable(),
      remaining: z.number().nullable(),
      unit: z.enum(["inning", "period", "lap", "stage", "second"]),
    })
    .nullable()
    .optional(),
  provider: providerMetadataSchema,''',
    "live semantic fields",
)
contracts += '''\nexport const nascarParticipantResultStatusSchema = z.enum([\n  "running",\n  "finished",\n  "dnf",\n  "dns",\n  "dnq",\n  "disqualified",\n  "unknown",\n]);\nexport type NascarParticipantResultStatus = z.infer<typeof nascarParticipantResultStatusSchema>;\n'''
contracts_path.write_text(contracts)

mlb_path = ROOT / "server/sports/mlb-adapter.ts"
mlb = mlb_path.read_text()
mlb = replace_once(
    mlb,
    'import type { Athlete, Game, GameStatus, LiveState, ProviderMetadata, Team } from "./contracts";\n',
    'import type { Athlete, Game, LiveState, ProviderMetadata, Team } from "./contracts";\n'
    'import { createProviderMetadata, reconcileAndSortGames, resolveMlbGameStatus } from "./semantics";\n',
    "MLB semantic imports",
)
mlb = mlb.replace('  normalizeGameStatus,\n', '')
old_mlb_meta = '''function metadata(now: Date): ProviderMetadata {
  return {
    provider: "mlb-statsapi",
    fetchedAt: now.toISOString(),
    staleAfterSeconds: 300,
    isStale: false,
  };
}
function status(game: MlbGame): GameStatus {
  const value = normalizeGameStatus(game);
  if (value === "completed") return "final";
  if (value === "inprogress") return "in_progress";
  if (value === "postponed") return "postponed";
  return "scheduled";
}'''
new_mlb_meta = '''function metadata(now: Date, ttl = 300): ProviderMetadata {
  return createProviderMetadata({
    provider: "mlb-statsapi",
    fetchedAt: now,
    staleAfterSeconds: ttl,
  });
}'''
mlb = replace_once(mlb, old_mlb_meta, new_mlb_meta, "MLB metadata/status")
old_mlb_game = '''function game(value: MlbGame, now: Date): Game {
  return {
    id: `mlb_game_${value.gamePk}`,
    sport: "mlb",
    startsAt: new Date(value.gameDate).toISOString(),
    status: status(value),
    homeTeamId: `mlb_team_${value.teams.home.team.id}`,
    awayTeamId: `mlb_team_${value.teams.away.team.id}`,
    provider: metadata(now),
  };
}'''
new_mlb_game = '''function game(value: MlbGame, now: Date): Game {
  const status = resolveMlbGameStatus(value.status);
  const startsAt = new Date(value.gameDate).toISOString();
  return {
    id: `mlb_game_${value.gamePk}`,
    sport: "mlb",
    startsAt,
    status: status.status,
    homeTeamId: `mlb_team_${value.teams.home.team.id}`,
    awayTeamId: `mlb_team_${value.teams.away.team.id}`,
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${value.gamePk}`,
    provider: metadata(now),
  };
}'''
mlb = replace_once(mlb, old_mlb_game, new_mlb_game, "MLB game semantics")
old_mlb_live = '''function live(gameId: string, value: MlbLinescore, now: Date): LiveState {
  return {
    gameId,
    status: value.currentInning ? "in_progress" : "scheduled",
    clock: null,
    period: value.currentInningOrdinal ?? null,
    summary:
      value.currentInningOrdinal && value.inningHalf
        ? `${value.inningHalf} ${value.currentInningOrdinal}`
        : null,
    provider: { ...metadata(now), staleAfterSeconds: 15 },
  };
}'''
new_mlb_live = '''function live(gameId: string, value: MlbLinescore, now: Date): LiveState {
  const hasInning = Number.isFinite(value.currentInning) && Number(value.currentInning) > 0;
  return {
    gameId,
    status: hasInning ? "in_progress" : "unknown",
    clock: null,
    period: value.currentInningOrdinal ?? null,
    summary:
      value.currentInningOrdinal && value.inningHalf
        ? `${value.inningHalf} ${value.currentInningOrdinal}`
        : null,
    sourceStatus: hasInning ? "linescore_inning_present" : "linescore_phase_missing",
    statusSource: hasInning ? "provider" : "fallback",
    statusConfidence: hasInning ? "authoritative" : "unknown",
    statusReason: hasInning ? null : "MLB linescore did not expose a game phase; scheduled was not inferred.",
    phase: {
      kind: "inning",
      number: hasInning ? Number(value.currentInning) : null,
      label: value.currentInningOrdinal ?? null,
    },
    progress: {
      current: hasInning ? Number(value.currentInning) : null,
      total: Number.isFinite(value.scheduledInnings) ? Number(value.scheduledInnings) : null,
      remaining: null,
      unit: "inning",
    },
    provider: metadata(now, 15),
  };
}'''
mlb = replace_once(mlb, old_mlb_live, new_mlb_live, "MLB live semantics")
mlb = replace_once(
    mlb,
    '      return values.map((value) => game(value, now));',
    '      return reconcileAndSortGames(values.map((value) => game(value, now)));',
    "MLB reconciliation",
)
mlb_path.write_text(mlb)

nhl_path = ROOT / "server/sports/nhl-adapter.ts"
nhl = nhl_path.read_text()
nhl = replace_once(
    nhl,
    'import type { Game, GameStatus, LiveState, ProviderMetadata, Team } from "./contracts";\n',
    'import type { Game, LiveState, ProviderMetadata, Team } from "./contracts";\n'
    'import { createProviderMetadata, reconcileAndSortGames, resolveNhlGameStatus } from "./semantics";\n',
    "NHL semantic imports",
)
nhl = nhl.replace('  normalizeNhlGameState,\n', '')
old_nhl_meta = '''function metadata(now: Date, ttl = 300): ProviderMetadata {
  return {
    provider: "nhl-web",
    fetchedAt: now.toISOString(),
    staleAfterSeconds: ttl,
    isStale: false,
  };
}
function gameStatus(value: NhlGame): GameStatus {
  const state = normalizeNhlGameState(value.gameState || value.gameScheduleState);
  if (state === "completed") return "final";
  if (state === "inprogress") return "in_progress";
  if (state === "postponed") return "postponed";
  return "scheduled";
}'''
new_nhl_meta = '''function metadata(now: Date, ttl = 300): ProviderMetadata {
  return createProviderMetadata({ provider: "nhl-web", fetchedAt: now, staleAfterSeconds: ttl });
}'''
nhl = replace_once(nhl, old_nhl_meta, new_nhl_meta, "NHL metadata/status")
old_nhl_game = '''  return {
    id: `nhl_game_${value.id}`,
    sport: "nhl",
    startsAt: new Date(value.startTimeUTC).toISOString(),
    status: gameStatus(value),
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    provider: metadata(now),
  } as const;'''
if old_nhl_game not in nhl:
    old_nhl_game = '''  return {
    id: `nhl_game_${value.id}`,
    sport: "nhl",
    startsAt: new Date(value.startTimeUTC).toISOString(),
    status: gameStatus(value),
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    provider: metadata(now),
  };'''
new_nhl_game = '''  const status = resolveNhlGameStatus(value.gameState || value.gameScheduleState);
  const startsAt = new Date(value.startTimeUTC).toISOString();
  return {
    id: `nhl_game_${value.id}`,
    sport: "nhl",
    startsAt,
    status: status.status,
    homeTeamId: value.homeTeam?.abbrev ? `nhl_team_${value.homeTeam.abbrev.toUpperCase()}` : null,
    awayTeamId: value.awayTeam?.abbrev ? `nhl_team_${value.awayTeam.abbrev.toUpperCase()}` : null,
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${value.id}`,
    provider: metadata(now),
  };'''
nhl = replace_once(nhl, old_nhl_game, new_nhl_game, "NHL game semantics")
nhl = replace_once(
    nhl,
    '        .map((value) => game(value, now));',
    '        .map((value) => game(value, now));\n      return reconcileAndSortGames(normalized);',
    "NHL reconciliation placeholder",
)
# The previous replacement must convert the return chain into an assigned variable.
nhl = nhl.replace('      return [...games.values()]\n        .filter(', '      const normalized = [...games.values()]\n        .filter(', 1)
old_nhl_live = '''      return {
        gameId: id,
        status: gameStatus(value),
        clock: value.clock?.timeRemaining ?? null,
        period: value.periodDescriptor?.number ? String(value.periodDescriptor.number) : null,
        summary: value.periodDescriptor?.periodType ?? null,
        provider: metadata(api.now(), 15),
      } satisfies LiveState;'''
new_nhl_live = '''      const status = resolveNhlGameStatus(value.gameState || value.gameScheduleState);
      const periodNumber = value.periodDescriptor?.number ?? null;
      return {
        gameId: id,
        status: status.status,
        clock: value.clock?.timeRemaining ?? null,
        period: periodNumber ? String(periodNumber) : null,
        summary: value.periodDescriptor?.periodType ?? null,
        sourceStatus: status.sourceStatus,
        statusSource: status.statusSource,
        statusConfidence: status.statusConfidence,
        statusReason: status.statusReason,
        phase: {
          kind: "period",
          number: periodNumber,
          label: value.periodDescriptor?.periodType ?? null,
        },
        progress: null,
        provider: metadata(api.now(), 15),
      } satisfies LiveState;'''
nhl = replace_once(nhl, old_nhl_live, new_nhl_live, "NHL live semantics")
nhl_path.write_text(nhl)

nascar_path = ROOT / "server/sports/nascar-adapter.ts"
nascar = nascar_path.read_text()
nascar = replace_once(
    nascar,
    'import type { Game, GameStatus, LiveState, ProviderMetadata } from "./contracts";\n',
    'import type { Game, LiveState, ProviderMetadata } from "./contracts";\n'
    'import {\n'
    '  createProviderMetadata,\n'
    '  reconcileAndSortGames,\n'
    '  resolveNascarLiveStatus,\n'
    '  resolveNascarScheduleStatus,\n'
    '} from "./semantics";\n',
    "NASCAR semantic imports",
)
old_nascar_meta = '''function metadata(now: Date, ttl = 900): ProviderMetadata {
  return {
    provider: "nascar-feed",
    fetchedAt: now.toISOString(),
    staleAfterSeconds: ttl,
    isStale: false,
  };
}'''
new_nascar_meta = '''function metadata(now: Date, ttl = 900): ProviderMetadata {
  return createProviderMetadata({ provider: "nascar-feed", fetchedAt: now, staleAfterSeconds: ttl });
}'''
nascar = replace_once(nascar, old_nascar_meta, new_nascar_meta, "NASCAR metadata")
old_schedule = '''  const startsAt = parseNascarEtDateTime(value.race_date || value.date_scheduled).toISOString();
  const complete = Number(value.actual_laps) > 0 && Number(value.actual_distance) > 0;
  return {
    id: `nascar_race_${value.race_id}`,
    sport: "nascar",
    startsAt,
    status: complete ? "final" : "scheduled",
    homeTeamId: null,
    awayTeamId: null,
    seriesId: series.id,
    provider: metadata(now),
  };
}
function liveStatus(feed: NascarLiveFeed): GameStatus {
  if (feed.laps_to_go <= 0 || [8, 9].includes(feed.flag_state)) return "final";
  return feed.lap_number > 0 ? "in_progress" : "scheduled";
}'''
new_schedule = '''  const startsAt = parseNascarEtDateTime(value.race_date || value.date_scheduled).toISOString();
  const status = resolveNascarScheduleStatus({
    actualLaps: value.actual_laps,
    actualDistance: value.actual_distance,
  });
  return {
    id: `nascar_race_${value.race_id}`,
    sport: "nascar",
    startsAt,
    status: status.status,
    homeTeamId: null,
    awayTeamId: null,
    seriesId: series.id,
    seasonId: String(value.race_season),
    sourceStatus: status.sourceStatus,
    statusSource: status.statusSource,
    statusConfidence: status.statusConfidence,
    statusReason: status.statusReason,
    eventOrderKey: `${startsAt}|${series.id}|${value.race_id}`,
    provider: metadata(now),
  };
}'''
nascar = replace_once(nascar, old_schedule, new_schedule, "NASCAR schedule/live status")
nascar = replace_once(
    nascar,
    '''      return values
        .map((value) => scheduleGame(value, now))
        .filter((value) => new Date(value.startsAt) >= from && new Date(value.startsAt) <= to);''',
    '''      return reconcileAndSortGames(
        values
          .map((value) => scheduleGame(value, now))
          .filter((value) => new Date(value.startsAt) >= from && new Date(value.startsAt) <= to),
      );''',
    "NASCAR reconciliation",
)
old_nascar_live = '''      return {
        gameId: id,
        status: liveStatus(feed),
        clock: feed.laps_to_go >= 0 ? `${feed.laps_to_go} laps to go` : null,
        period: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : null,
        summary: feed.run_name || null,
        provider: metadata(api.now(), 10),
      } satisfies LiveState;'''
new_nascar_live = '''      const status = resolveNascarLiveStatus({
        lapNumber: feed.lap_number,
        lapsToGo: feed.laps_to_go,
        flagState: feed.flag_state,
      });
      return {
        gameId: id,
        status: status.status,
        clock: feed.laps_to_go >= 0 ? `${feed.laps_to_go} laps to go` : null,
        period: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : null,
        summary: feed.run_name || null,
        sourceStatus: status.sourceStatus,
        statusSource: status.statusSource,
        statusConfidence: status.statusConfidence,
        statusReason: status.statusReason,
        phase: {
          kind: "stage",
          number: feed.stage?.stage_num ?? null,
          label: feed.stage?.stage_num ? `Stage ${feed.stage.stage_num}` : feed.run_name || null,
        },
        progress: {
          current: Number.isFinite(feed.lap_number) ? feed.lap_number : null,
          total: Number.isFinite(feed.laps_in_race) ? feed.laps_in_race : null,
          remaining: Number.isFinite(feed.laps_to_go) ? feed.laps_to_go : null,
          unit: "lap",
        },
        provider: metadata(api.now(), 10),
      } satisfies LiveState;'''
nascar = replace_once(nascar, old_nascar_live, new_nascar_live, "NASCAR live semantics")
nascar_path.write_text(nascar)

fixture_tests = r'''import { beforeEach, describe, expect, it } from "vitest";
import type { Game } from "./contracts";
import {
  createProviderMetadata,
  normalizeNascarParticipantResultStatus,
  readSportsSemanticMetrics,
  reconcileAndSortGames,
  resetSportsSemanticMetrics,
  resolveMlbGameStatus,
  resolveNascarLiveStatus,
  resolveNhlGameStatus,
} from "./semantics";

const BEFORE = {
  mlbSuspended: "postponed",
  nhlSuspended: "postponed",
  unknownNhl: "scheduled",
  missingMlbLinescorePhase: "scheduled",
} as const;

const provider = createProviderMetadata({
  provider: "fixture",
  fetchedAt: new Date("2026-08-04T12:00:00.000Z"),
  staleAfterSeconds: 60,
});

function game(id: string, startsAt: string, status: Game["status"], fetchedAt = provider.fetchedAt): Game {
  return {
    id,
    sport: "mlb",
    startsAt,
    status,
    homeTeamId: "h",
    awayTeamId: "a",
    provider: { ...provider, fetchedAt },
  };
}

describe("unified sports semantic correction fixtures", () => {
  beforeEach(() => resetSportsSemanticMetrics());

  it("documents and corrects suspended and unknown status drift", () => {
    expect(BEFORE).toEqual({
      mlbSuspended: "postponed",
      nhlSuspended: "postponed",
      unknownNhl: "scheduled",
      missingMlbLinescorePhase: "scheduled",
    });
    expect(resolveMlbGameStatus({ detailedState: "Suspended", abstractGameState: "Live" })).toMatchObject({
      status: "suspended",
      sourceStatus: "Suspended",
      statusSource: "provider",
    });
    expect(resolveNhlGameStatus("SUSP")).toMatchObject({ status: "suspended" });
    expect(resolveNhlGameStatus("ALIEN_STATE")).toMatchObject({
      status: "unknown",
      statusSource: "fallback",
      statusConfidence: "unknown",
    });
  });

  it("does not collapse delayed games into postponed", () => {
    expect(resolveMlbGameStatus({ detailedState: "Delayed", abstractGameState: "Live" })).toMatchObject({
      status: "in_progress",
      statusConfidence: "inferred",
    });
    expect(resolveMlbGameStatus({ detailedState: "Delayed", abstractGameState: "Preview" })).toMatchObject({
      status: "scheduled",
      statusConfidence: "inferred",
    });
  });

  it("preserves NASCAR lap semantics and unknown result states", () => {
    expect(resolveNascarLiveStatus({ lapNumber: 0, lapsToGo: 200, flagState: 77 })).toMatchObject({
      status: "unknown",
    });
    expect(normalizeNascarParticipantResultStatus("Did Not Qualify")).toBe("dnq");
    expect(normalizeNascarParticipantResultStatus("Did Not Start")).toBe("dns");
    expect(normalizeNascarParticipantResultStatus("engine")).toBe("dnf");
    expect(normalizeNascarParticipantResultStatus("mystery")).toBe("unknown");
  });

  it("computes freshness from source watermarks without coercion", () => {
    const metadata = createProviderMetadata({
      provider: "fixture",
      fetchedAt: new Date("2026-08-04T12:10:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-04T12:00:00.000Z"),
      now: new Date("2026-08-04T12:10:00.000Z"),
      staleAfterSeconds: 300,
    });
    expect(metadata).toMatchObject({ isStale: true, staleAfterSeconds: 300 });
  });

  it("deduplicates and orders events while exposing conflict counts", () => {
    const values = reconcileAndSortGames([
      game("g2", "2026-08-04T20:00:00.000Z", "scheduled"),
      game("g1", "2026-08-04T19:00:00.000Z", "scheduled", "2026-08-04T12:00:00.000Z"),
      game("g1", "2026-08-04T19:00:00.000Z", "final", "2026-08-04T12:05:00.000Z"),
    ]);
    expect(values.map((value) => value.id)).toEqual(["g1", "g2"]);
    expect(values[0]).toMatchObject({ status: "final", provider: { conflictCount: 1 } });
    expect(readSportsSemanticMetrics()).toMatchObject({ duplicate_event: 1, event_conflict: 1 });
  });
});
'''
(ROOT / "server/sports/semantic-fixtures.test.ts").write_text(fixture_tests)

# Extend adapter fixtures with compatibility assertions.
adapter_test_path = ROOT / "server/sports/adapters.test.ts"
adapter_tests = adapter_test_path.read_text()
adapter_tests = replace_once(
    adapter_tests,
    '''    expect(await adapter.getLiveState!("mlb_game_99")).toMatchObject({
      status: "in_progress",
      period: "3rd",
    });''',
    '''    expect(await adapter.getLiveState!("mlb_game_99")).toMatchObject({
      status: "in_progress",
      period: "3rd",
      phase: { kind: "inning", number: 3, label: "3rd" },
      statusSource: "provider",
    });''',
    "MLB adapter fixture",
)
adapter_tests = replace_once(
    adapter_tests,
    '''    expect(await adapter.getLiveState!("nhl_game_7")).toMatchObject({
      clock: "10:00",
      period: "2",
    });''',
    '''    expect(await adapter.getLiveState!("nhl_game_7")).toMatchObject({
      clock: "10:00",
      period: "2",
      phase: { kind: "period", number: 2, label: "REG" },
      statusSource: "provider",
    });''',
    "NHL adapter fixture",
)
adapter_tests = replace_once(
    adapter_tests,
    '''    expect(await adapter.getLiveState!("nascar_race_5")).toMatchObject({
      status: "in_progress",
      period: "Stage 2",
    });''',
    '''    expect(await adapter.getLiveState!("nascar_race_5")).toMatchObject({
      status: "in_progress",
      period: "Stage 2",
      phase: { kind: "stage", number: 2, label: "Stage 2" },
      progress: { current: 100, total: 200, remaining: 100, unit: "lap" },
    });''',
    "NASCAR adapter fixture",
)
adapter_test_path.write_text(adapter_tests)

audit_script = r'''import { Pool } from "pg";

const SPORTS = ["MLB", "NHL", "NASCAR"];
const VALID_STATUSES = new Set([
  "scheduled",
  "inprogress",
  "in_progress",
  "completed",
  "final",
  "postponed",
  "suspended",
  "cancelled",
  "unknown",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "sportfolio-readonly-sports-semantics-audit",
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      `SELECT sport, game_id, status, start_time, home_team, away_team
       FROM daily_games
       WHERE upper(sport) = ANY($1::text[])
         AND start_time >= now() - interval '45 days'
         AND start_time < now() + interval '400 days'
       ORDER BY start_time, game_id`,
      [SPORTS],
    );
    const duplicateKeys = new Map<string, number>();
    const invalidStatuses: Array<Record<string, unknown>> = [];
    const invalidDates: Array<Record<string, unknown>> = [];
    for (const row of result.rows) {
      const key = `${String(row.sport).toUpperCase()}:${row.game_id}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
      if (!VALID_STATUSES.has(String(row.status || "").toLowerCase())) invalidStatuses.push(row);
      if (!Number.isFinite(new Date(row.start_time).getTime())) invalidDates.push(row);
    }
    const duplicates = [...duplicateKeys.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));
    console.log(JSON.stringify({
      mode: "read_only",
      rowCount: result.rowCount,
      duplicates,
      invalidStatuses,
      invalidDates,
      ok: duplicates.length === 0 && invalidStatuses.length === 0 && invalidDates.length === 0,
    }, null, 2));
    await client.query("ROLLBACK");
    if (duplicates.length || invalidStatuses.length || invalidDates.length) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ mode: "read_only", ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
'''
(ROOT / "scripts/audit-unified-sports-semantics.ts").write_text(audit_script)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text())
package["scripts"]["audit:sports-semantics"] = "tsx scripts/audit-unified-sports-semantics.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n")

ledger = '''# Unified sports semantic correction ledger\n\nIssue #346 corrects semantic drift without changing market prices, payouts, scouting, boosts, liquidity, or trade behavior.\n\n| Path | Before | After | Compatibility |\n| --- | --- | --- | --- |\n| MLB suspended | `postponed` | `suspended` | Existing status remains a string; new enum value is additive. |\n| MLB delayed | Always `postponed` | `scheduled` or `in_progress` when provider phase supports it; otherwise `unknown` | Source status, confidence, and reason are included. |\n| MLB linescore without inning | `scheduled` | `unknown` | Prevents false scheduling claims; phase is nullable. |\n| NHL suspended | `postponed` | `suspended` | Additive status value. |\n| NHL unknown provider state | `scheduled` | `unknown` | No silent coercion. |\n| NASCAR schedule completion | Silent inference | Same compatible status plus `statusSource=inferred`, confidence, and reason | Existing status preserved. |\n| NASCAR live phase | String-only period | Adds structured stage and lap progress | Existing `period`, `clock`, and `summary` remain. |\n| Duplicate events | Provider order/duplicates | Deterministic reconciliation by canonical ID, freshness, status rank, then time | Existing event shape preserved; conflict count is additive metadata. |\n| Freshness | Hard-coded `isStale=false` | Computed from source watermark/fetch time and TTL | Existing provider fields preserved. |\n\nMetrics are process-local counters for unknown status, fallback, duplicate event, event conflict, and identity conflict paths. The production audit command is read-only and checks `daily_games` for duplicate IDs, invalid statuses, and invalid timestamps.\n\nAffected consumers are unified public sports tools and `get_sports_context`. Existing app/gameplay storage contracts are unchanged. Rollback is a single PR revert; additive fields can be ignored by older clients.\n'''
(ROOT / "docs/implementation/unified-sports-semantic-corrections.md").write_text(ledger)
