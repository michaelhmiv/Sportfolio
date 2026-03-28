import type { DailyGame } from "@shared/schema";

import { getOrCompute } from "./cache";
import { resolveInternalMlbMcpConfig, runInternalMlbMcpToolRaw } from "./agent/internal-mlb-mcp";

const SCHEDULE_CACHE_TTL_MS = 10 * 60 * 1000;
const PITCHER_STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BATTER_STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GAME_DETAILS_CACHE_TTL_MS = 2 * 60 * 1000;
const TEAM_REFERENCE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TOOL_PREFIX = "mlb_mcp__";
const MLB_TOOL_TIMEOUT_WINDOW = 12 * 60 * 60 * 1000;

const MLB_TEAM_NAME_TO_CODE: Record<string, string> = {
  "arizona diamondbacks": "ARI",
  "atlanta braves": "ATL",
  athletics: "ATH",
  "baltimore orioles": "BAL",
  "boston red sox": "BOS",
  "chicago cubs": "CHC",
  "chicago white sox": "CWS",
  "cincinnati reds": "CIN",
  "cleveland guardians": "CLE",
  "colorado rockies": "COL",
  "detroit tigers": "DET",
  "houston astros": "HOU",
  "kansas city royals": "KC",
  "los angeles angels": "LAA",
  "los angeles dodgers": "LAD",
  "miami marlins": "MIA",
  "milwaukee brewers": "MIL",
  "minnesota twins": "MIN",
  "new york mets": "NYM",
  "new york yankees": "NYY",
  "philadelphia phillies": "PHI",
  "pittsburgh pirates": "PIT",
  "san diego padres": "SD",
  "san francisco giants": "SF",
  "seattle mariners": "SEA",
  "st louis cardinals": "STL",
  "tampa bay rays": "TB",
  "texas rangers": "TEX",
  "toronto blue jays": "TOR",
  "washington nationals": "WSH",
};

const MLB_TEAM_CODE_ALIASES: Record<string, string> = {
  ARI: "ARI",
  AZ: "ARI",
  ATL: "ATL",
  ATH: "ATH",
  OAK: "ATH",
  BAL: "BAL",
  BOS: "BOS",
  CHC: "CHC",
  CHW: "CWS",
  CWS: "CWS",
  CIN: "CIN",
  CLE: "CLE",
  COL: "COL",
  DET: "DET",
  HOU: "HOU",
  KC: "KC",
  KCR: "KC",
  LAA: "LAA",
  LAD: "LAD",
  MIA: "MIA",
  FLA: "MIA",
  MIL: "MIL",
  MIN: "MIN",
  NYM: "NYM",
  NYY: "NYY",
  PHI: "PHI",
  PIT: "PIT",
  SD: "SD",
  SDP: "SD",
  SEA: "SEA",
  SF: "SF",
  SFG: "SF",
  STL: "STL",
  TB: "TB",
  TBR: "TB",
  TEX: "TEX",
  TOR: "TOR",
  WSH: "WSH",
  WSN: "WSH",
};

type UnknownRecord = Record<string, unknown>;

type NormalizedScheduleGame = {
  gameId: number | null;
  gameDate: string;
  startTime: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
  awayTeamName: string | null;
  homeTeamName: string | null;
  awayProbablePitcher: string | null;
  homeProbablePitcher: string | null;
  awayPitcherNote: string | null;
  homePitcherNote: string | null;
  venue: string | null;
  status: string | null;
  doubleheader: boolean;
  gameNumber: number | null;
  broadcasts: string[];
};

type NormalizedPitcherExpectedStats = {
  playerId: number | null;
  fullName: string;
  statYear: number;
  plateAppearances: number | null;
  era: number | null;
  xera: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
};

type NormalizedBatterExpectedStats = {
  playerId: number | null;
  fullName: string;
  statYear: number;
  plateAppearances: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
};

type MatchedMlbScheduleGame = {
  localGame: DailyGame;
  scheduleGame: NormalizedScheduleGame;
};

type NormalizedLineupEntry = {
  slot: number;
  playerId: string | null;
  name: string;
  position: string | null;
  jerseyNumber: string | null;
};

type NormalizedTeamSnapshot = {
  teamId: number | null;
  name: string | null;
  abbreviation: string | null;
  recordLabel: string | null;
};

type NormalizedTeamReferencePointer = {
  gameId: number | null;
  teamId: number | null;
  gameDate: string | null;
  status: string | null;
};

type NormalizedGameDetails = {
  gameId: number | null;
  gameDate: string | null;
  venue: string | null;
  teams: {
    away: NormalizedTeamSnapshot | null;
    home: NormalizedTeamSnapshot | null;
  };
  lineupsPosted: boolean;
  startingLineups: {
    away: NormalizedLineupEntry[];
    home: NormalizedLineupEntry[];
  };
  weatherSummary: string | null;
  attendance: number | null;
  scoringPlays: NormalizedScoringPlay[];
  gameState: NormalizedGameState | null;
};

type NormalizedGameState = {
  detailedStatus: string | null;
  inningState: string | null;
  inningLabel: string | null;
  countSummary: string | null;
  weatherSummary: string | null;
  attendance: number | null;
  decisions: {
    winner: string | null;
    loser: string | null;
    save: string | null;
  } | null;
  linescore: {
    innings: Array<{
      num: number;
      away: number | null;
      home: number | null;
    }>;
    totals: {
      awayRuns: number | null;
      homeRuns: number | null;
      awayHits: number | null;
      homeHits: number | null;
      awayErrors: number | null;
      homeErrors: number | null;
    };
  } | null;
};

type NormalizedScoringPlay = {
  inningLabel: string | null;
  battingTeam: string | null;
  event: string | null;
  description: string;
  scoreLabel: string | null;
};

export type MlbPregameProbablePitcher = {
  name: string;
  note: string | null;
  team: string;
};

export type MlbPregamePitcherStats = {
  name: string;
  statYear: number;
  plateAppearances: number | null;
  era: number | null;
  xera: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
  summary: string;
};

export type MlbPregameHitterSpotlight = {
  slot: number;
  name: string;
  team: string;
  position: string | null;
  statYear: number;
  plateAppearances: number | null;
  woba: number | null;
  expectedWoba: number | null;
  battingAverage: number | null;
  expectedBattingAverage: number | null;
  slugging: number | null;
  expectedSlugging: number | null;
  summary: string;
};

export type MlbGameState = {
  detailedStatus: string | null;
  inningState: string | null;
  inningLabel: string | null;
  countSummary: string | null;
  weatherSummary: string | null;
  attendance: number | null;
  decisions: {
    winner: string | null;
    loser: string | null;
    save: string | null;
  } | null;
  linescore: {
    innings: Array<{
      num: number;
      away: number | null;
      home: number | null;
    }>;
    totals: {
      awayRuns: number | null;
      homeRuns: number | null;
      awayHits: number | null;
      homeHits: number | null;
      awayErrors: number | null;
      homeErrors: number | null;
    };
  } | null;
};

export type MlbScoringPlay = {
  inningLabel: string | null;
  battingTeam: string | null;
  event: string | null;
  description: string;
  scoreLabel: string | null;
};

export type MlbPregameLineupEntry = {
  slot: number;
  playerId: string | null;
  name: string;
  position: string | null;
  jerseyNumber: string | null;
};

export type MlbPregameTeamContext = {
  record: string | null;
  lastGameSummary: string | null;
  nextGameSummary: string | null;
};

export type MlbEnrichmentStatus = {
  state: "available" | "pending" | "unavailable";
  message: string | null;
};

export type MlbPregameInsight = {
  matchupSummary: string | null;
  venue: string | null;
  gameNumber: number | null;
  broadcasts: string[];
  weatherSummary: string | null;
  attendance: number | null;
  probablePitchers: {
    away: MlbPregameProbablePitcher | null;
    home: MlbPregameProbablePitcher | null;
  };
  probablePitcherStats: {
    away: MlbPregamePitcherStats | null;
    home: MlbPregamePitcherStats | null;
  };
  advancedStatsAvailable: boolean;
  statYear: number | null;
  doubleheader: boolean;
  lineupsPosted: boolean;
  startingLineups: {
    away: MlbPregameLineupEntry[];
    home: MlbPregameLineupEntry[];
  };
  hitterSpotlights: {
    away: MlbPregameHitterSpotlight[];
    home: MlbPregameHitterSpotlight[];
  };
  hitterMatchupNotes: {
    away: string | null;
    home: string | null;
  };
  lineupSignals: {
    away: string | null;
    home: string | null;
  };
  teamContexts: {
    away: MlbPregameTeamContext | null;
    home: MlbPregameTeamContext | null;
  };
  scoringPlays: MlbScoringPlay[];
  gameState: MlbGameState | null;
};

export type MlbPregameInsightBundle = {
  insightByGameId: Map<string, MlbPregameInsight>;
  statusByGameId: Map<string, MlbEnrichmentStatus>;
};

export type MlbPlayerPregameLookup = {
  probableStarterKeys: Set<string>;
  matchupByTeam: Map<
    string,
    {
      gameId: string;
      opponentLabel: string;
      opposingProbablePitcher: string | null;
      matchupSummary: string | null;
    }
  >;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toInteger(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  return Math.trunc(numeric);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toTextList(value: unknown): string[] {
  if (typeof value === "string") {
    const item = toText(value);
    return item ? [item] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => toText(item)).filter((item): item is string => Boolean(item));
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMlbTeamCode(value: string | null | undefined): string | null {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) return null;
  return MLB_TEAM_CODE_ALIASES[normalized] || normalized;
}

function getMlbTeamCodeFromName(name: string | null | undefined): string | null {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return null;
  return MLB_TEAM_NAME_TO_CODE[normalizedName] || null;
}

function formatPitcherShortName(name: string | null | undefined): string | null {
  const trimmed = toText(name);
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
}

function formatPitcherLastName(name: string | null | undefined): string | null {
  const trimmed = toText(name);
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function formatPlayerShortName(name: string | null | undefined): string | null {
  const trimmed = toText(name);
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
}

function formatMetric(value: number | null, digits = 3): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return value.toFixed(digits);
}

function formatEra(value: number | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return value.toFixed(2);
}

function formatShortDateLabel(value: string | null | undefined): string | null {
  const raw = toText(value);
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const year = Number.parseInt(dateOnlyMatch[1], 10);
    const month = Number.parseInt(dateOnlyMatch[2], 10) - 1;
    const day = Number.parseInt(dateOnlyMatch[3], 10);
    const utcDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return utcDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function buildPitcherStatsSummary(stats: NormalizedPitcherExpectedStats): string {
  const segments = [
    stats.xera != null ? `${formatEra(stats.xera)} xERA` : null,
    stats.expectedWoba != null ? `${formatMetric(stats.expectedWoba)} xwOBA` : null,
    stats.expectedSlugging != null ? `${formatMetric(stats.expectedSlugging)} xSLG` : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" | ") || "Statcast expected profile unavailable";
}

function buildHitterStatsSummary(stats: NormalizedBatterExpectedStats): string {
  const segments = [
    stats.expectedWoba != null ? `${formatMetric(stats.expectedWoba)} xwOBA` : null,
    stats.expectedSlugging != null ? `${formatMetric(stats.expectedSlugging)} xSLG` : null,
    stats.expectedBattingAverage != null
      ? `${formatMetric(stats.expectedBattingAverage)} xBA`
      : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" | ") || "No Statcast contact profile yet";
}

function buildPitcherStatsCard(
  stats: NormalizedPitcherExpectedStats | null,
): MlbPregamePitcherStats | null {
  if (!stats) return null;

  return {
    name: stats.fullName,
    statYear: stats.statYear,
    plateAppearances: stats.plateAppearances,
    era: stats.era,
    xera: stats.xera,
    woba: stats.woba,
    expectedWoba: stats.expectedWoba,
    battingAverage: stats.battingAverage,
    expectedBattingAverage: stats.expectedBattingAverage,
    slugging: stats.slugging,
    expectedSlugging: stats.expectedSlugging,
    summary: buildPitcherStatsSummary(stats),
  };
}

function buildHitterSpotlightCard(input: {
  lineupEntry: NormalizedLineupEntry;
  team: string;
  stats: NormalizedBatterExpectedStats | null;
}): MlbPregameHitterSpotlight | null {
  if (!input.stats) return null;

  return {
    slot: input.lineupEntry.slot,
    name: input.lineupEntry.name,
    team: input.team,
    position: input.lineupEntry.position,
    statYear: input.stats.statYear,
    plateAppearances: input.stats.plateAppearances,
    woba: input.stats.woba,
    expectedWoba: input.stats.expectedWoba,
    battingAverage: input.stats.battingAverage,
    expectedBattingAverage: input.stats.expectedBattingAverage,
    slugging: input.stats.slugging,
    expectedSlugging: input.stats.expectedSlugging,
    summary: buildHitterStatsSummary(input.stats),
  };
}

function normalizeScheduleGame(entry: unknown): NormalizedScheduleGame | null {
  if (!isRecord(entry)) return null;

  return {
    gameId: toInteger(entry.game_id),
    gameDate: toText(entry.game_date) || "",
    startTime: toText(entry.game_datetime),
    awayTeam: canonicalizeMlbTeamCode(getMlbTeamCodeFromName(toText(entry.away_name))),
    homeTeam: canonicalizeMlbTeamCode(getMlbTeamCodeFromName(toText(entry.home_name))),
    awayTeamName: toText(entry.away_name),
    homeTeamName: toText(entry.home_name),
    awayProbablePitcher: toText(entry.away_probable_pitcher),
    homeProbablePitcher: toText(entry.home_probable_pitcher),
    awayPitcherNote: toText(entry.away_pitcher_note),
    homePitcherNote: toText(entry.home_pitcher_note),
    venue: toText(entry.venue_name),
    status: toText(entry.status),
    doubleheader:
      String(entry.doubleheader || "")
        .trim()
        .toUpperCase() === "Y",
    gameNumber: toInteger(entry.game_num),
    broadcasts: toTextList(entry.national_broadcasts),
  };
}

function normalizeLineupEntry(
  rawPlayerId: unknown,
  index: number,
  players: UnknownRecord,
): NormalizedLineupEntry | null {
  const playerId = toInteger(rawPlayerId);
  const playerRecordValue =
    (playerId != null && isRecord(players[`ID${playerId}`]) ? players[`ID${playerId}`] : null) ||
    (playerId != null && isRecord(players[String(playerId)]) ? players[String(playerId)] : null);
  const playerRecord = isRecord(playerRecordValue) ? playerRecordValue : null;
  const personRecord =
    playerRecord && isRecord(playerRecord["person"]) ? playerRecord["person"] : null;
  const positionRecord =
    playerRecord && isRecord(playerRecord["position"]) ? playerRecord["position"] : null;
  const playerName =
    toText(personRecord?.["fullName"]) || (playerId != null ? `Player ${playerId}` : null);

  if (!playerName) {
    return null;
  }

  return {
    slot: index + 1,
    playerId: playerId != null ? String(playerId) : null,
    name: playerName,
    position: toText(positionRecord?.["abbreviation"]),
    jerseyNumber: toText(playerRecord?.["jerseyNumber"]),
  };
}

function normalizeTeamLineup(entry: unknown): NormalizedLineupEntry[] {
  if (!isRecord(entry)) {
    return [];
  }

  const batters = Array.isArray(entry.batters) ? entry.batters : [];
  const players = isRecord(entry.players) ? entry.players : {};
  const seenPlayerIds = new Set<string>();

  return batters
    .map((rawPlayerId, index) => normalizeLineupEntry(rawPlayerId, index, players))
    .filter((player): player is NormalizedLineupEntry => {
      if (!player) return false;
      if (!player.playerId) return true;
      if (seenPlayerIds.has(player.playerId)) return false;
      seenPlayerIds.add(player.playerId);
      return true;
    });
}

function buildRecordLabel(wins: number | null, losses: number | null): string | null {
  if (wins == null && losses == null) {
    return null;
  }

  if (wins != null && losses != null) {
    return `${wins}-${losses}`;
  }

  return wins != null ? `${wins} wins` : `${losses} losses`;
}

function normalizeTeamSnapshot(entry: unknown): NormalizedTeamSnapshot | null {
  if (!isRecord(entry)) return null;

  const record = isRecord(entry.record) ? entry.record : null;
  return {
    teamId: toInteger(entry.id),
    name: toText(entry.name),
    abbreviation: canonicalizeMlbTeamCode(toText(entry.abbreviation)) || toText(entry.abbreviation),
    recordLabel: buildRecordLabel(toInteger(record?.wins), toInteger(record?.losses)),
  };
}

function extractNamedValue(entry: unknown): { label: string | null; value: string | null } | null {
  if (!isRecord(entry)) return null;

  return {
    label: toText(entry.label) || toText(entry.title),
    value: toText(entry.value) || toText(entry.displayValue),
  };
}

function extractInfoValue(entries: unknown, labels: string[]): string | null {
  if (!Array.isArray(entries)) return null;

  const normalizedLabels = labels.map((label) => normalizeText(label));
  for (const entry of entries) {
    const namedValue = extractNamedValue(entry);
    if (!namedValue?.label || !namedValue.value) continue;

    const normalizedLabel = normalizeText(namedValue.label);
    if (normalizedLabels.some((label) => normalizedLabel.includes(label))) {
      return namedValue.value;
    }
  }

  return null;
}

function parseAttendance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== "string") return null;
  const numeric = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildWeatherSummary(input: {
  weather: UnknownRecord | null;
  boxscoreInfo: unknown;
}): string | null {
  const condition =
    toText(input.weather?.condition) || extractInfoValue(input.boxscoreInfo, ["weather"]);
  const temp = toInteger(input.weather?.temp);
  const wind = toText(input.weather?.wind) || extractInfoValue(input.boxscoreInfo, ["wind"]);

  const segments = [condition, temp != null ? `${temp}F` : null, wind].filter(
    (segment): segment is string => Boolean(segment),
  );

  return segments.join(" | ") || null;
}

function normalizeDecisionName(value: unknown): string | null {
  if (isRecord(value)) {
    return (
      toText(value.fullName) || (isRecord(value.person) ? toText(value.person.fullName) : null)
    );
  }

  return toText(value);
}

function buildInningLabelFromAbout(entry: UnknownRecord | null): string | null {
  if (!entry) return null;

  const halfInning = toText(entry.halfInning) || toText(entry.inningHalf);
  const ordinal = toText(entry.ordinalNum);
  const inningNumber = toInteger(entry.inning);
  const inningValue = ordinal || (inningNumber != null ? `${inningNumber}` : null);

  if (!halfInning && !inningValue) {
    return null;
  }

  return `${halfInning || ""} ${inningValue || ""}`.trim();
}

function normalizeScoringPlayEntry(entry: unknown): NormalizedScoringPlay | null {
  if (!isRecord(entry)) {
    return null;
  }

  const about = isRecord(entry.about) ? entry.about : null;
  const result = isRecord(entry.result) ? entry.result : null;
  const matchup = isRecord(entry.matchup) ? entry.matchup : null;
  const battingTeamRecord =
    (matchup && isRecord(matchup.battingTeam) ? matchup.battingTeam : null) ||
    (isRecord(entry.team) ? entry.team : null);
  const description =
    toText(result?.description) ||
    toText(entry.description) ||
    toText(entry.title) ||
    toText(entry.headline);

  if (!description) {
    return null;
  }

  const awayScore = toInteger(result?.awayScore) ?? toInteger(entry.awayScore);
  const homeScore = toInteger(result?.homeScore) ?? toInteger(entry.homeScore);

  return {
    inningLabel: buildInningLabelFromAbout(about),
    battingTeam:
      canonicalizeMlbTeamCode(toText(battingTeamRecord?.abbreviation)) ||
      toText(battingTeamRecord?.name),
    event: toText(result?.event) || toText(result?.eventType) || toText(entry.type),
    description,
    scoreLabel:
      awayScore != null && homeScore != null ? `${awayScore}-${homeScore}` : toText(entry.score),
  };
}

function normalizeScoringPlays(liveData: UnknownRecord | null): NormalizedScoringPlay[] {
  if (!liveData) {
    return [];
  }

  const playsRecord = isRecord(liveData.plays) ? liveData.plays : null;
  const allPlays = Array.isArray(playsRecord?.allPlays) ? playsRecord.allPlays : [];
  const scoringPlayIndexes = Array.isArray(playsRecord?.scoringPlays)
    ? playsRecord.scoringPlays
    : [];
  let rawScoringPlays: unknown[] = [];

  if (scoringPlayIndexes.length > 0 && allPlays.length > 0) {
    rawScoringPlays = scoringPlayIndexes
      .map((value) => {
        if (typeof value === "number" && value >= 0 && value < allPlays.length) {
          return allPlays[value];
        }
        return isRecord(value) ? value : null;
      })
      .filter((value): value is unknown => Boolean(value));
  } else if (Array.isArray(liveData.scoringPlays)) {
    rawScoringPlays = liveData.scoringPlays;
  } else if (Array.isArray(playsRecord?.scoringPlays)) {
    rawScoringPlays = playsRecord.scoringPlays;
  }

  return rawScoringPlays
    .map((entry) => normalizeScoringPlayEntry(entry))
    .filter((entry): entry is NormalizedScoringPlay => Boolean(entry))
    .slice(-5)
    .reverse();
}

function normalizeGameState(input: {
  linescore: UnknownRecord | null;
  decisions: UnknownRecord | null;
  detailedStatus: string | null;
  weatherSummary: string | null;
  attendance: number | null;
}): NormalizedGameState | null {
  const inningsRaw = Array.isArray(input.linescore?.innings) ? input.linescore.innings : [];
  const innings = inningsRaw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const away = isRecord(entry.away) ? entry.away : null;
      const home = isRecord(entry.home) ? entry.home : null;

      return {
        num: toInteger(entry.num) || 0,
        away: toInteger(away?.runs),
        home: toInteger(home?.runs),
      };
    })
    .filter((entry): entry is { num: number; away: number | null; home: number | null } =>
      Boolean(entry),
    );

  const teams = isRecord(input.linescore?.teams) ? input.linescore.teams : null;
  const awayTotals = teams && isRecord(teams.away) ? teams.away : null;
  const homeTotals = teams && isRecord(teams.home) ? teams.home : null;
  const currentInning = toInteger(input.linescore?.currentInning);
  const inningOrdinal = toText(input.linescore?.currentInningOrdinal);
  const inningState = toText(input.linescore?.inningState) || toText(input.linescore?.inningHalf);
  const balls = toInteger(input.linescore?.balls);
  const strikes = toInteger(input.linescore?.strikes);
  const outs = toInteger(input.linescore?.outs);
  const countSummary =
    balls != null && strikes != null
      ? `${balls}-${strikes}${outs != null ? `, ${outs} out${outs === 1 ? "" : "s"}` : ""}`
      : outs != null
        ? `${outs} out${outs === 1 ? "" : "s"}`
        : null;

  const decisions =
    input.decisions != null
      ? {
          winner: normalizeDecisionName(input.decisions.winner),
          loser: normalizeDecisionName(input.decisions.loser),
          save: normalizeDecisionName(input.decisions.save),
        }
      : null;

  if (
    !input.detailedStatus &&
    !inningState &&
    innings.length === 0 &&
    !input.weatherSummary &&
    input.attendance == null &&
    !decisions
  ) {
    return null;
  }

  return {
    detailedStatus: input.detailedStatus,
    inningState,
    inningLabel:
      inningState || inningOrdinal || currentInning != null
        ? `${inningState || ""} ${inningOrdinal || currentInning || ""}`.trim()
        : null,
    countSummary,
    weatherSummary: input.weatherSummary,
    attendance: input.attendance,
    decisions,
    linescore:
      innings.length > 0 || awayTotals || homeTotals
        ? {
            innings,
            totals: {
              awayRuns: toInteger(awayTotals?.runs),
              homeRuns: toInteger(homeTotals?.runs),
              awayHits: toInteger(awayTotals?.hits),
              homeHits: toInteger(homeTotals?.hits),
              awayErrors: toInteger(awayTotals?.errors),
              homeErrors: toInteger(homeTotals?.errors),
            },
          }
        : null,
  };
}

function normalizeGameDetails(payload: unknown): NormalizedGameDetails {
  const gameData = isRecord(payload) && isRecord(payload.gameData) ? payload.gameData : null;
  const liveData = isRecord(payload) && isRecord(payload.liveData) ? payload.liveData : null;
  const boxscore = liveData && isRecord(liveData.boxscore) ? liveData.boxscore : null;
  const teams = boxscore && isRecord(boxscore.teams) ? boxscore.teams : null;
  const boxscoreInfo = boxscore && Array.isArray(boxscore.info) ? boxscore.info : [];
  const linescore = liveData && isRecord(liveData.linescore) ? liveData.linescore : null;
  const decisions = liveData && isRecord(liveData.decisions) ? liveData.decisions : null;
  const weather = gameData && isRecord(gameData.weather) ? gameData.weather : null;
  const gameInfo = gameData && isRecord(gameData.gameInfo) ? gameData.gameInfo : null;
  const gameTeams = gameData && isRecord(gameData.teams) ? gameData.teams : null;
  const dateTime =
    gameData && isRecord(gameData.datetime) ? toText(gameData.datetime.dateTime) : null;
  const venueRecord = gameData && isRecord(gameData.venue) ? gameData.venue : null;

  const awayLineup = normalizeTeamLineup(teams?.away);
  const homeLineup = normalizeTeamLineup(teams?.home);
  const weatherSummary = buildWeatherSummary({
    weather,
    boxscoreInfo,
  });
  const attendance =
    parseAttendance(gameInfo?.attendance) ||
    parseAttendance(extractInfoValue(boxscoreInfo, ["attendance", "att"]));

  return {
    gameId: gameData ? toInteger(gameData.gamePk) : null,
    gameDate: dateTime,
    venue: toText(venueRecord?.name),
    teams: {
      away: normalizeTeamSnapshot(gameTeams?.away),
      home: normalizeTeamSnapshot(gameTeams?.home),
    },
    lineupsPosted: awayLineup.length > 0 || homeLineup.length > 0,
    startingLineups: {
      away: awayLineup,
      home: homeLineup,
    },
    weatherSummary,
    attendance,
    scoringPlays: normalizeScoringPlays(liveData),
    gameState: normalizeGameState({
      linescore,
      decisions,
      detailedStatus:
        gameData && isRecord(gameData.status) ? toText(gameData.status.detailedState) : null,
      weatherSummary,
      attendance,
    }),
  };
}

function formatExpectedStatsName(row: UnknownRecord): string | null {
  const formatted = toText(row["last_name, first_name"]);
  if (!formatted) return null;

  const [lastName, firstName] = formatted.split(",").map((part) => part.trim());
  if (firstName && lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  return formatted;
}

function normalizePitcherExpectedStatsRow(
  entry: unknown,
  statYear: number,
): NormalizedPitcherExpectedStats | null {
  if (!isRecord(entry)) return null;

  const fullName = formatExpectedStatsName(entry);
  if (!fullName) return null;

  return {
    playerId: toInteger(entry.player_id),
    fullName,
    statYear,
    plateAppearances: toInteger(entry.pa),
    era: toNumber(entry.era),
    xera: toNumber(entry.xera),
    woba: toNumber(entry.woba),
    expectedWoba: toNumber(entry.est_woba),
    battingAverage: toNumber(entry.ba),
    expectedBattingAverage: toNumber(entry.est_ba),
    slugging: toNumber(entry.slg),
    expectedSlugging: toNumber(entry.est_slg),
  };
}

function normalizeBatterExpectedStatsRow(
  entry: unknown,
  statYear: number,
): NormalizedBatterExpectedStats | null {
  if (!isRecord(entry)) return null;

  const fullName = formatExpectedStatsName(entry);
  if (!fullName) return null;

  return {
    playerId: toInteger(entry.player_id),
    fullName,
    statYear,
    plateAppearances: toInteger(entry.pa),
    woba: toNumber(entry.woba),
    expectedWoba: toNumber(entry.est_woba),
    battingAverage: toNumber(entry.ba),
    expectedBattingAverage: toNumber(entry.est_ba),
    slugging: toNumber(entry.slg),
    expectedSlugging: toNumber(entry.est_slg),
  };
}

function normalizeScheduleResponse(payload: unknown): NormalizedScheduleGame[] {
  if (!isRecord(payload) || !Array.isArray(payload.games)) {
    return [];
  }

  return payload.games
    .map((game) => normalizeScheduleGame(game))
    .filter((game): game is NormalizedScheduleGame => Boolean(game));
}

function normalizePitcherStatsResponse(
  payload: unknown,
  statYear: number,
): NormalizedPitcherExpectedStats[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  return payload.data
    .map((row) => normalizePitcherExpectedStatsRow(row, statYear))
    .filter((row): row is NormalizedPitcherExpectedStats => Boolean(row));
}

function normalizeBatterStatsResponse(
  payload: unknown,
  statYear: number,
): NormalizedBatterExpectedStats[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  return payload.data
    .map((row) => normalizeBatterExpectedStatsRow(row, statYear))
    .filter((row): row is NormalizedBatterExpectedStats => Boolean(row));
}

function normalizeTeamReferencePointer(payload: unknown): NormalizedTeamReferencePointer | null {
  if (!isRecord(payload)) {
    return null;
  }

  return {
    gameId: toInteger(payload.game_id),
    teamId: toInteger(payload.team_id),
    gameDate: toText(payload.date),
    status: toText(payload.status),
  };
}

function getToolName(toolSuffix: string): string {
  const configuredPrefix = resolveInternalMlbMcpConfig().toolPrefix || DEFAULT_TOOL_PREFIX;
  return `${configuredPrefix}${toolSuffix}`;
}

async function fetchScheduleGamesForDate(dateStr: string): Promise<NormalizedScheduleGame[]> {
  return getOrCompute(
    `mlb_pregame:schedule:${dateStr}`,
    async () => {
      const response = await runInternalMlbMcpToolRaw({
        toolName: getToolName("get_schedule"),
        args: {
          date: dateStr,
        },
      });

      return normalizeScheduleResponse(response.structuredContent);
    },
    SCHEDULE_CACHE_TTL_MS,
  );
}

async function fetchPitcherExpectedStatsForYear(
  statYear: number,
): Promise<NormalizedPitcherExpectedStats[]> {
  return getOrCompute(
    `mlb_pregame:pitcher_expected_stats:${statYear}`,
    async () => {
      const response = await runInternalMlbMcpToolRaw({
        toolName: getToolName("get_statcast_pitcher_expected_stats"),
        args: {
          year: statYear,
          minPA: 1,
          start_row: 0,
          end_row: 1400,
        },
      });

      return normalizePitcherStatsResponse(response.structuredContent, statYear);
    },
    PITCHER_STATS_CACHE_TTL_MS,
  );
}

async function fetchBatterExpectedStatsForYear(
  statYear: number,
): Promise<NormalizedBatterExpectedStats[]> {
  return getOrCompute(
    `mlb_pregame:batter_expected_stats:${statYear}`,
    async () => {
      const response = await runInternalMlbMcpToolRaw({
        toolName: getToolName("get_statcast_batter_expected_stats"),
        args: {
          year: statYear,
          minPA: 1,
          start_row: 0,
          end_row: 2200,
        },
      });

      return normalizeBatterStatsResponse(response.structuredContent, statYear);
    },
    BATTER_STATS_CACHE_TTL_MS,
  );
}

async function fetchGameDetails(gameId: number): Promise<NormalizedGameDetails> {
  return getOrCompute(
    `mlb_pregame:game_details:${gameId}`,
    async () => {
      const response = await runInternalMlbMcpToolRaw({
        toolName: getToolName("get_stats"),
        args: {
          endpoint: "game",
          params: {
            gamePk: gameId,
          },
        },
      });

      return normalizeGameDetails(response.structuredContent);
    },
    GAME_DETAILS_CACHE_TTL_MS,
  );
}

async function fetchTeamReferencePointer(
  teamId: number,
  direction: "last" | "next",
): Promise<NormalizedTeamReferencePointer | null> {
  return getOrCompute(
    `mlb_pregame:team_reference:${direction}:${teamId}`,
    async () => {
      const response = await runInternalMlbMcpToolRaw({
        toolName: getToolName(direction === "last" ? "get_last_game" : "get_next_game"),
        args: {
          team_id: teamId,
        },
      });

      return normalizeTeamReferencePointer(response.structuredContent);
    },
    TEAM_REFERENCE_CACHE_TTL_MS,
  );
}

function getCandidateStatYears(dateStr: string): number[] {
  const fallbackYear = new Date().getFullYear();
  const rawYear = Number.parseInt(dateStr.slice(0, 4), 10);
  const rawMonth = Number.parseInt(dateStr.slice(5, 7), 10);
  const year = Number.isFinite(rawYear) ? rawYear : fallbackYear;
  const month = Number.isFinite(rawMonth) ? rawMonth : 7;

  const firstYear = month <= 4 ? year - 1 : year;
  const secondYear = firstYear === year ? year - 1 : year;
  return Array.from(new Set([firstYear, secondYear].filter((candidate) => candidate >= 2000)));
}

function buildPlayerNameKey(name: string, team: string): string {
  return `${String(team || "")
    .trim()
    .toUpperCase()}|${normalizeText(name)}`;
}

function matchScheduleGamesToLocalGames(
  games: DailyGame[],
  scheduleGames: NormalizedScheduleGame[],
): MatchedMlbScheduleGame[] {
  const matched: MatchedMlbScheduleGame[] = [];
  const usedIndices = new Set<number>();

  const mlbGames = games.filter((game) => String(game.sport || "").toUpperCase() === "MLB");
  const sortedLocalGames = [...mlbGames].sort(
    (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
  );

  for (const localGame of sortedLocalGames) {
    const localHome = canonicalizeMlbTeamCode(localGame.homeTeam);
    const localAway = canonicalizeMlbTeamCode(localGame.awayTeam);
    if (!localHome || !localAway) continue;

    const localStartMs = new Date(localGame.startTime).getTime();
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    scheduleGames.forEach((scheduleGame, index) => {
      if (usedIndices.has(index)) return;
      if (scheduleGame.homeTeam !== localHome || scheduleGame.awayTeam !== localAway) return;

      const scheduleStartMs = scheduleGame.startTime
        ? new Date(scheduleGame.startTime).getTime()
        : Number.NaN;
      const distance =
        Number.isFinite(localStartMs) && Number.isFinite(scheduleStartMs)
          ? Math.abs(localStartMs - scheduleStartMs)
          : 0;

      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });

    if (bestIndex === -1 || bestDistance > MLB_TOOL_TIMEOUT_WINDOW) {
      continue;
    }

    usedIndices.add(bestIndex);
    matched.push({
      localGame,
      scheduleGame: scheduleGames[bestIndex],
    });
  }

  return matched;
}

async function loadMatchedMlbScheduleGames(
  games: DailyGame[],
  dateStr: string,
): Promise<{
  matchedGames: MatchedMlbScheduleGame[];
  unavailableStatus: MlbEnrichmentStatus | null;
}> {
  const config = resolveInternalMlbMcpConfig();
  const mlbGames = games.filter((game) => String(game.sport || "").toUpperCase() === "MLB");
  if (mlbGames.length === 0) {
    return {
      matchedGames: [],
      unavailableStatus: null,
    };
  }

  if (!config.enabled || !config.endpoint) {
    return {
      matchedGames: [],
      unavailableStatus: {
        state: "unavailable",
        message: "MLB enrichment unavailable in this environment.",
      },
    };
  }

  try {
    const scheduleGames = await fetchScheduleGamesForDate(dateStr);
    return {
      matchedGames: matchScheduleGamesToLocalGames(mlbGames, scheduleGames),
      unavailableStatus: null,
    };
  } catch (error: unknown) {
    console.warn(
      `[mlb-pregame-insights] Unable to load schedule for ${dateStr}: ${
        error instanceof Error ? error.message : String(error || "unknown error")
      }`,
    );
    return {
      matchedGames: [],
      unavailableStatus: {
        state: "unavailable",
        message: "MLB enrichment is temporarily unavailable.",
      },
    };
  }
}

async function loadPitcherStatsLookup(
  probablePitcherNames: string[],
  dateStr: string,
): Promise<Map<string, NormalizedPitcherExpectedStats>> {
  const lookup = new Map<string, NormalizedPitcherExpectedStats>();
  if (probablePitcherNames.length === 0) {
    return lookup;
  }

  const years = getCandidateStatYears(dateStr);
  for (const year of years) {
    try {
      const rows = await fetchPitcherExpectedStatsForYear(year);
      for (const row of rows) {
        const key = normalizeText(row.fullName);
        if (key && !lookup.has(key)) {
          lookup.set(key, row);
        }
      }

      const allPitchersResolved = probablePitcherNames.every((name) =>
        lookup.has(normalizeText(name)),
      );
      if (allPitchersResolved) {
        break;
      }
    } catch (error: unknown) {
      console.warn(
        `[mlb-pregame-insights] Unable to load pitcher expected stats for ${year}: ${
          error instanceof Error ? error.message : String(error || "unknown error")
        }`,
      );
    }
  }

  return lookup;
}

function buildStatsPlayerIdKey(playerId: string | number | null | undefined): string | null {
  const normalized = String(playerId || "").trim();
  return normalized ? `id:${normalized}` : null;
}

function buildStatsPlayerNameKey(name: string | null | undefined): string | null {
  const normalized = normalizeText(name);
  return normalized ? `name:${normalized}` : null;
}

async function loadBatterStatsLookup(
  lineupEntries: NormalizedLineupEntry[],
  dateStr: string,
): Promise<Map<string, NormalizedBatterExpectedStats>> {
  const lookup = new Map<string, NormalizedBatterExpectedStats>();
  const candidateNames = lineupEntries
    .map((entry) => entry.name)
    .filter((name): name is string => Boolean(name));

  if (candidateNames.length === 0) {
    return lookup;
  }

  const years = getCandidateStatYears(dateStr);
  for (const year of years) {
    try {
      const rows = await fetchBatterExpectedStatsForYear(year);
      for (const row of rows) {
        const idKey = buildStatsPlayerIdKey(row.playerId);
        if (idKey && !lookup.has(idKey)) {
          lookup.set(idKey, row);
        }

        const nameKey = buildStatsPlayerNameKey(row.fullName);
        if (nameKey && !lookup.has(nameKey)) {
          lookup.set(nameKey, row);
        }
      }

      const allHittersResolved = lineupEntries.every((entry) => {
        if ((entry.position || "").toUpperCase() === "P") return true;
        const idKey = buildStatsPlayerIdKey(entry.playerId);
        const nameKey = buildStatsPlayerNameKey(entry.name);
        return Boolean((idKey && lookup.has(idKey)) || (nameKey && lookup.has(nameKey)));
      });

      if (allHittersResolved) {
        break;
      }
    } catch (error: unknown) {
      console.warn(
        `[mlb-pregame-insights] Unable to load batter expected stats for ${year}: ${
          error instanceof Error ? error.message : String(error || "unknown error")
        }`,
      );
    }
  }

  return lookup;
}

function getBatterStatsForLineupEntry(
  entry: NormalizedLineupEntry,
  lookup: Map<string, NormalizedBatterExpectedStats>,
): NormalizedBatterExpectedStats | null {
  const idKey = buildStatsPlayerIdKey(entry.playerId);
  if (idKey && lookup.has(idKey)) {
    return lookup.get(idKey) || null;
  }

  const nameKey = buildStatsPlayerNameKey(entry.name);
  if (nameKey && lookup.has(nameKey)) {
    return lookup.get(nameKey) || null;
  }

  return null;
}

function buildTeamHitterSpotlights(input: {
  team: string;
  lineup: NormalizedLineupEntry[];
  batterStatsLookup: Map<string, NormalizedBatterExpectedStats>;
}): MlbPregameHitterSpotlight[] {
  return input.lineup
    .filter((entry) => String(entry.position || "").toUpperCase() !== "P")
    .map((entry) =>
      buildHitterSpotlightCard({
        lineupEntry: entry,
        team: input.team,
        stats: getBatterStatsForLineupEntry(entry, input.batterStatsLookup),
      }),
    )
    .filter((entry): entry is MlbPregameHitterSpotlight => Boolean(entry))
    .sort((left, right) => {
      const leftScore = left.expectedWoba ?? left.woba ?? 0;
      const rightScore = right.expectedWoba ?? right.woba ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.slot - right.slot;
    })
    .slice(0, 3);
}

function buildLineupSignal(input: {
  lineup: NormalizedLineupEntry[];
  hitterSpotlights: MlbPregameHitterSpotlight[];
}): string | null {
  if (input.lineup.length === 0) {
    return null;
  }

  const topHalfThreats = input.hitterSpotlights.filter((player) => player.slot <= 4).length;
  if (topHalfThreats >= 2) {
    return "Pressure is concentrated in the top half of the order.";
  }

  if (input.hitterSpotlights.length >= 2) {
    return "The lineup has multiple Statcast-backed bats in play.";
  }

  return "Lineup is posted, but the advanced hitting profile is light.";
}

function buildHitterMatchupNote(input: {
  team: string;
  hitterSpotlights: MlbPregameHitterSpotlight[];
  opposingPitcher: string | null;
}): string | null {
  if (input.hitterSpotlights.length === 0) {
    return null;
  }

  const highlightedHitters = input.hitterSpotlights
    .slice(0, 2)
    .map((player) => formatPlayerShortName(player.name) || player.name)
    .join(", ");
  const opposingLastName = formatPitcherLastName(input.opposingPitcher);

  if (opposingLastName) {
    return `${input.team} leans on ${highlightedHitters} against ${opposingLastName}.`;
  }

  return `${input.team} leans on ${highlightedHitters} at the plate.`;
}

function findTeamSnapshotByCode(
  gameDetails: NormalizedGameDetails | null | undefined,
  teamCode: string,
): NormalizedTeamSnapshot | null {
  if (!gameDetails) {
    return null;
  }

  const normalizedCode = canonicalizeMlbTeamCode(teamCode);
  if (!normalizedCode) {
    return null;
  }

  const awayCode = canonicalizeMlbTeamCode(gameDetails.teams.away?.abbreviation);
  if (awayCode === normalizedCode) {
    return gameDetails.teams.away;
  }

  const homeCode = canonicalizeMlbTeamCode(gameDetails.teams.home?.abbreviation);
  if (homeCode === normalizedCode) {
    return gameDetails.teams.home;
  }

  return null;
}

function buildTeamReferenceSummary(input: {
  teamId: number;
  referenceGame: NormalizedGameDetails | null;
  referencePointer: NormalizedTeamReferencePointer | null;
  referenceKind: "last" | "next";
  currentGameId: number | null;
}): string | null {
  const referenceGameId = input.referenceGame?.gameId ?? input.referencePointer?.gameId ?? null;
  if (
    input.referenceKind === "next" &&
    referenceGameId != null &&
    referenceGameId === input.currentGameId
  ) {
    return null;
  }

  const awayTeam = input.referenceGame?.teams.away;
  const homeTeam = input.referenceGame?.teams.home;
  const isAwayTeam = awayTeam?.teamId === input.teamId;
  const isHomeTeam = homeTeam?.teamId === input.teamId;
  const teamSide = isAwayTeam ? "away" : isHomeTeam ? "home" : null;
  const opponent = teamSide === "away" ? homeTeam : teamSide === "home" ? awayTeam : null;
  const opponentLabel = opponent?.abbreviation || opponent?.name || "opponent";
  const locationLabel =
    teamSide === "home" ? `vs ${opponentLabel}` : teamSide === "away" ? `@ ${opponentLabel}` : null;
  const dateLabel = formatShortDateLabel(
    input.referenceGame?.gameDate || input.referencePointer?.gameDate,
  );
  const totals = input.referenceGame?.gameState?.linescore?.totals || null;
  const teamRuns =
    teamSide === "away"
      ? (totals?.awayRuns ?? null)
      : teamSide === "home"
        ? (totals?.homeRuns ?? null)
        : null;
  const opponentRuns =
    teamSide === "away"
      ? (totals?.homeRuns ?? null)
      : teamSide === "home"
        ? (totals?.awayRuns ?? null)
        : null;
  const detailedStatus =
    input.referenceGame?.gameState?.detailedStatus || input.referencePointer?.status || null;

  if (input.referenceKind === "last") {
    if (teamRuns != null && opponentRuns != null) {
      const verb = teamRuns > opponentRuns ? "Won" : teamRuns < opponentRuns ? "Lost" : "Finished";
      return `${verb} ${teamRuns}-${opponentRuns}${locationLabel ? ` ${locationLabel}` : ""}${
        dateLabel ? ` on ${dateLabel}` : ""
      }`;
    }

    const statusPrefix = detailedStatus || "Last game";
    return `${statusPrefix}${locationLabel ? ` ${locationLabel}` : ""}${
      dateLabel ? ` on ${dateLabel}` : ""
    }`;
  }

  return `Next${dateLabel ? ` ${dateLabel}` : ""}${locationLabel ? ` ${locationLabel}` : ""}`;
}

async function loadTeamContext(input: {
  teamCode: string;
  gameDetails: NormalizedGameDetails | null;
  currentGameId: number | null;
}): Promise<MlbPregameTeamContext | null> {
  const teamSnapshot = findTeamSnapshotByCode(input.gameDetails, input.teamCode);
  const recordLabel = teamSnapshot?.recordLabel ?? null;
  const teamId = teamSnapshot?.teamId;
  if (teamId == null) {
    return recordLabel
      ? {
          record: recordLabel,
          lastGameSummary: null,
          nextGameSummary: null,
        }
      : null;
  }

  let lastPointer: NormalizedTeamReferencePointer | null = null;
  let nextPointer: NormalizedTeamReferencePointer | null = null;

  try {
    lastPointer = await fetchTeamReferencePointer(teamId, "last");
  } catch (error: unknown) {
    console.warn(
      `[mlb-pregame-insights] Unable to load last game for team ${teamId}: ${
        error instanceof Error ? error.message : String(error || "unknown error")
      }`,
    );
  }

  try {
    nextPointer = await fetchTeamReferencePointer(teamId, "next");
  } catch (error: unknown) {
    console.warn(
      `[mlb-pregame-insights] Unable to load next game for team ${teamId}: ${
        error instanceof Error ? error.message : String(error || "unknown error")
      }`,
    );
  }

  const referenceGameIds = Array.from(
    new Set(
      [lastPointer?.gameId, nextPointer?.gameId].filter(
        (gameId): gameId is number => gameId != null,
      ),
    ),
  );
  const referenceGames = new Map<number, NormalizedGameDetails>();

  await Promise.all(
    referenceGameIds.map(async (gameId) => {
      try {
        referenceGames.set(gameId, await fetchGameDetails(gameId));
      } catch (error: unknown) {
        console.warn(
          `[mlb-pregame-insights] Unable to load referenced game ${gameId}: ${
            error instanceof Error ? error.message : String(error || "unknown error")
          }`,
        );
      }
    }),
  );

  const lastGameSummary = buildTeamReferenceSummary({
    teamId,
    referenceGame:
      lastPointer?.gameId != null ? referenceGames.get(lastPointer.gameId) || null : null,
    referencePointer: lastPointer,
    referenceKind: "last",
    currentGameId: input.currentGameId,
  });
  const nextGameSummary = buildTeamReferenceSummary({
    teamId,
    referenceGame:
      nextPointer?.gameId != null ? referenceGames.get(nextPointer.gameId) || null : null,
    referencePointer: nextPointer,
    referenceKind: "next",
    currentGameId: input.currentGameId,
  });

  if (!recordLabel && !lastGameSummary && !nextGameSummary) {
    return null;
  }

  return {
    record: recordLabel,
    lastGameSummary,
    nextGameSummary,
  };
}

function buildMatchupSummary(input: {
  localGame: DailyGame;
  scheduleGame: NormalizedScheduleGame;
  awayStats: NormalizedPitcherExpectedStats | null;
  homeStats: NormalizedPitcherExpectedStats | null;
}): string | null {
  const awayPitcher = input.scheduleGame.awayProbablePitcher;
  const homePitcher = input.scheduleGame.homeProbablePitcher;
  const awayShort = formatPitcherShortName(awayPitcher);
  const homeShort = formatPitcherShortName(homePitcher);

  if (input.awayStats && input.homeStats) {
    const awayRating = input.awayStats.xera ?? input.awayStats.era;
    const homeRating = input.homeStats.xera ?? input.homeStats.era;

    if (awayRating != null && homeRating != null) {
      const difference = Math.abs(awayRating - homeRating);
      if (difference < 0.25) {
        return `${awayShort || awayPitcher} vs ${homeShort || homePitcher} profiles as a tight starter matchup.`;
      }

      const awayHasEdge = awayRating < homeRating;
      const edgeTeam = awayHasEdge ? input.localGame.awayTeam : input.localGame.homeTeam;
      const edgePitcher = awayHasEdge ? awayShort || awayPitcher : homeShort || homePitcher;
      const edgeValue = awayHasEdge ? awayRating : homeRating;
      return `${edgeTeam} gets the starter edge with ${edgePitcher} (${formatEra(edgeValue)} xERA pace).`;
    }
  }

  if (awayPitcher && homePitcher) {
    return `${awayShort || awayPitcher} vs ${homeShort || homePitcher} is the probable starter pairing.`;
  }

  if (awayPitcher) {
    return `${input.localGame.awayTeam} is lined up to start ${awayShort || awayPitcher}.`;
  }

  if (homePitcher) {
    return `${input.localGame.homeTeam} is lined up to start ${homeShort || homePitcher}.`;
  }

  return null;
}

export async function getMlbPregameInsightBundle(
  games: DailyGame[],
  dateStr: string,
  options?: {
    includeGameDetails?: boolean;
  },
): Promise<MlbPregameInsightBundle> {
  const mlbGames = games.filter((game) => String(game.sport || "").toUpperCase() === "MLB");
  const statusByGameId = new Map<string, MlbEnrichmentStatus>();
  const { matchedGames, unavailableStatus } = await loadMatchedMlbScheduleGames(games, dateStr);
  if (unavailableStatus) {
    mlbGames.forEach((game) => {
      statusByGameId.set(game.gameId, unavailableStatus);
    });
    return {
      insightByGameId: new Map<string, MlbPregameInsight>(),
      statusByGameId,
    };
  }

  const probablePitcherNames = Array.from(
    new Set(
      matchedGames
        .flatMap(({ scheduleGame }) => [
          scheduleGame.awayProbablePitcher,
          scheduleGame.homeProbablePitcher,
        ])
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const pitcherStatsLookup = await loadPitcherStatsLookup(probablePitcherNames, dateStr);
  const gameDetailsByScheduleGameId = new Map<number, NormalizedGameDetails>();
  const batterStatsLookup = new Map<string, NormalizedBatterExpectedStats>();
  const teamContextByTeamKey = new Map<string, MlbPregameTeamContext | null>();
  const includeGameDetails = options?.includeGameDetails ?? false;

  if (includeGameDetails) {
    await Promise.all(
      Array.from(
        new Set(
          matchedGames
            .map(({ scheduleGame }) => scheduleGame.gameId)
            .filter((gameId): gameId is number => gameId != null),
        ),
      ).map(async (gameId) => {
        try {
          gameDetailsByScheduleGameId.set(gameId, await fetchGameDetails(gameId));
        } catch (error: unknown) {
          console.warn(
            `[mlb-pregame-insights] Unable to load game details for ${gameId}: ${
              error instanceof Error ? error.message : String(error || "unknown error")
            }`,
          );
        }
      }),
    );

    const allLineupEntries = Array.from(
      gameDetailsByScheduleGameId
        .values()
        .flatMap((gameDetails) => [
          ...gameDetails.startingLineups.away,
          ...gameDetails.startingLineups.home,
        ]),
    );

    const loadedBatterStats = await loadBatterStatsLookup(allLineupEntries, dateStr);
    loadedBatterStats.forEach((value, key) => {
      batterStatsLookup.set(key, value);
    });

    await Promise.all(
      matchedGames.flatMap(({ localGame, scheduleGame }) => {
        const gameDetails =
          scheduleGame.gameId != null
            ? gameDetailsByScheduleGameId.get(scheduleGame.gameId) || null
            : null;

        return [
          {
            teamKey: localGame.awayTeam,
            teamCode: localGame.awayTeam,
          },
          {
            teamKey: localGame.homeTeam,
            teamCode: localGame.homeTeam,
          },
        ].map(async (entry) => {
          if (teamContextByTeamKey.has(entry.teamKey)) {
            return;
          }

          const context = await loadTeamContext({
            teamCode: entry.teamCode,
            gameDetails,
            currentGameId: scheduleGame.gameId,
          });
          teamContextByTeamKey.set(entry.teamKey, context);
        });
      }),
    );
  }

  const insightByGameId = new Map<string, MlbPregameInsight>();

  matchedGames.forEach(({ localGame, scheduleGame }) => {
    const awayStats =
      scheduleGame.awayProbablePitcher != null
        ? pitcherStatsLookup.get(normalizeText(scheduleGame.awayProbablePitcher)) || null
        : null;
    const homeStats =
      scheduleGame.homeProbablePitcher != null
        ? pitcherStatsLookup.get(normalizeText(scheduleGame.homeProbablePitcher)) || null
        : null;
    const gameDetails =
      scheduleGame.gameId != null ? gameDetailsByScheduleGameId.get(scheduleGame.gameId) : null;
    const awayLineup = gameDetails?.startingLineups.away || [];
    const homeLineup = gameDetails?.startingLineups.home || [];
    const awayHitterSpotlights = buildTeamHitterSpotlights({
      team: localGame.awayTeam,
      lineup: awayLineup,
      batterStatsLookup,
    });
    const homeHitterSpotlights = buildTeamHitterSpotlights({
      team: localGame.homeTeam,
      lineup: homeLineup,
      batterStatsLookup,
    });

    insightByGameId.set(localGame.gameId, {
      matchupSummary: buildMatchupSummary({
        localGame,
        scheduleGame,
        awayStats,
        homeStats,
      }),
      venue: scheduleGame.venue,
      gameNumber: scheduleGame.gameNumber,
      broadcasts: scheduleGame.broadcasts,
      weatherSummary: gameDetails?.weatherSummary || null,
      attendance: gameDetails?.attendance || null,
      probablePitchers: {
        away: scheduleGame.awayProbablePitcher
          ? {
              name: scheduleGame.awayProbablePitcher,
              note: scheduleGame.awayPitcherNote,
              team: localGame.awayTeam,
            }
          : null,
        home: scheduleGame.homeProbablePitcher
          ? {
              name: scheduleGame.homeProbablePitcher,
              note: scheduleGame.homePitcherNote,
              team: localGame.homeTeam,
            }
          : null,
      },
      probablePitcherStats: {
        away: buildPitcherStatsCard(awayStats),
        home: buildPitcherStatsCard(homeStats),
      },
      advancedStatsAvailable: Boolean(awayStats || homeStats),
      statYear: awayStats?.statYear || homeStats?.statYear || null,
      doubleheader: scheduleGame.doubleheader,
      lineupsPosted: gameDetails?.lineupsPosted || false,
      startingLineups: gameDetails?.startingLineups || {
        away: [],
        home: [],
      },
      hitterSpotlights: {
        away: awayHitterSpotlights,
        home: homeHitterSpotlights,
      },
      hitterMatchupNotes: {
        away: buildHitterMatchupNote({
          team: localGame.awayTeam,
          hitterSpotlights: awayHitterSpotlights,
          opposingPitcher: scheduleGame.homeProbablePitcher,
        }),
        home: buildHitterMatchupNote({
          team: localGame.homeTeam,
          hitterSpotlights: homeHitterSpotlights,
          opposingPitcher: scheduleGame.awayProbablePitcher,
        }),
      },
      lineupSignals: {
        away: buildLineupSignal({
          lineup: awayLineup,
          hitterSpotlights: awayHitterSpotlights,
        }),
        home: buildLineupSignal({
          lineup: homeLineup,
          hitterSpotlights: homeHitterSpotlights,
        }),
      },
      teamContexts: {
        away: teamContextByTeamKey.get(localGame.awayTeam) || null,
        home: teamContextByTeamKey.get(localGame.homeTeam) || null,
      },
      scoringPlays: gameDetails?.scoringPlays || [],
      gameState: gameDetails?.gameState || null,
    });

    statusByGameId.set(localGame.gameId, {
      state: "available",
      message: null,
    });
  });

  mlbGames.forEach((game) => {
    if (statusByGameId.has(game.gameId)) {
      return;
    }

    statusByGameId.set(game.gameId, {
      state: "pending",
      message: "MLB game context is pending.",
    });
  });

  return {
    insightByGameId,
    statusByGameId,
  };
}

export async function getMlbPregameInsightMap(
  games: DailyGame[],
  dateStr: string,
  options?: {
    includeGameDetails?: boolean;
  },
): Promise<Map<string, MlbPregameInsight>> {
  const { insightByGameId } = await getMlbPregameInsightBundle(games, dateStr, options);
  return insightByGameId;
}

function buildOpponentLabel(game: DailyGame, team: string): string {
  return team === game.homeTeam ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;
}

export async function getMlbPlayerPregameLookup(
  games: DailyGame[],
  dateStr: string,
): Promise<MlbPlayerPregameLookup> {
  const { matchedGames } = await loadMatchedMlbScheduleGames(games, dateStr);
  const insightByGameId = await getMlbPregameInsightMap(games, dateStr);
  const probableStarterKeys = new Set<string>();
  const matchupByTeam = new Map<
    string,
    {
      gameId: string;
      opponentLabel: string;
      opposingProbablePitcher: string | null;
      matchupSummary: string | null;
    }
  >();

  matchedGames.forEach(({ localGame, scheduleGame }) => {
    if (scheduleGame.awayProbablePitcher) {
      probableStarterKeys.add(
        buildPlayerNameKey(scheduleGame.awayProbablePitcher, localGame.awayTeam),
      );
    }
    if (scheduleGame.homeProbablePitcher) {
      probableStarterKeys.add(
        buildPlayerNameKey(scheduleGame.homeProbablePitcher, localGame.homeTeam),
      );
    }

    const insight = insightByGameId.get(localGame.gameId) || null;

    if (!matchupByTeam.has(localGame.awayTeam)) {
      matchupByTeam.set(localGame.awayTeam, {
        gameId: localGame.gameId,
        opponentLabel: buildOpponentLabel(localGame, localGame.awayTeam),
        opposingProbablePitcher: scheduleGame.homeProbablePitcher,
        matchupSummary: insight?.matchupSummary || null,
      });
    }

    if (!matchupByTeam.has(localGame.homeTeam)) {
      matchupByTeam.set(localGame.homeTeam, {
        gameId: localGame.gameId,
        opponentLabel: buildOpponentLabel(localGame, localGame.homeTeam),
        opposingProbablePitcher: scheduleGame.awayProbablePitcher,
        matchupSummary: insight?.matchupSummary || null,
      });
    }
  });

  return {
    probableStarterKeys,
    matchupByTeam,
  };
}

export function getMlbPlayerNameKey(name: string, team: string): string {
  return buildPlayerNameKey(name, team);
}

export function getMlbPitcherMatchupChip(input: {
  playerName: string;
  playerTeam: string;
  playerPosition?: string | null;
  probableStarterKeys: Set<string>;
  matchupByTeam: Map<
    string,
    {
      gameId: string;
      opponentLabel: string;
      opposingProbablePitcher: string | null;
      matchupSummary: string | null;
    }
  >;
}): {
  isProbableStarter: boolean;
  probablePitcherGameId: string | null;
  mlbMatchupChip: string | null;
  mlbPregameSummary: string | null;
} {
  const probableStarterKey = buildPlayerNameKey(input.playerName, input.playerTeam);
  const teamContext = input.matchupByTeam.get(input.playerTeam) || null;
  const isProbableStarter = input.probableStarterKeys.has(probableStarterKey);
  const normalizedPosition = String(input.playerPosition || "")
    .trim()
    .toUpperCase();

  let mlbMatchupChip: string | null = null;
  if (isProbableStarter && teamContext) {
    mlbMatchupChip = teamContext.opponentLabel;
  } else if (normalizedPosition === "P" && teamContext) {
    mlbMatchupChip = teamContext.opponentLabel;
  } else if (teamContext?.opposingProbablePitcher) {
    const opposingLastName = formatPitcherLastName(teamContext.opposingProbablePitcher);
    mlbMatchupChip = opposingLastName ? `vs ${opposingLastName}` : teamContext.opponentLabel;
  } else if (normalizedPosition && normalizedPosition !== "P" && teamContext) {
    mlbMatchupChip = teamContext.opponentLabel;
  }

  return {
    isProbableStarter,
    probablePitcherGameId: isProbableStarter ? teamContext?.gameId || null : null,
    mlbMatchupChip,
    mlbPregameSummary: teamContext?.matchupSummary || null,
  };
}
