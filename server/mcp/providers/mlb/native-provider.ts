import {
  fetchAllPlayers,
  fetchSeasonStatSplits,
  fetchTeamRoster,
  isApiReachable,
} from "../../../mlb-statsapi";
import type { CuratedMlbToolName } from "./provider";

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";
const MLB_LIVE_BASE = "https://statsapi.mlb.com/api/v1.1";
const SAVANT_BASE = "https://baseballsavant.mlb.com";

const BATTING_METRICS: Record<string, string> = {
  avg: "battingAverage",
  obp: "onBasePercentage",
  slg: "sluggingPercentage",
  ops: "onBasePlusSlugging",
  home_runs: "homeRuns",
  rbi: "runsBattedIn",
  runs: "runs",
  hits: "hits",
  stolen_bases: "stolenBases",
  war: "winsAboveReplacement",
};

const PITCHING_METRICS: Record<string, string> = {
  era: "earnedRunAverage",
  wins: "wins",
  strikeouts: "strikeouts",
  whip: "walksAndHitsPerInningPitched",
  saves: "saves",
  innings: "inningsPitched",
  war: "winsAboveReplacement",
};

const LEAGUE_IDS: Record<string, number | undefined> = {
  mlb: undefined,
  al: 103,
  nl: 104,
};

type NativeOptions = {
  timeoutMs: number;
};

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown, name: string, fallback?: string): string {
  const resolved = typeof value === "string" ? value.trim() : "";
  if (resolved) return resolved;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required.`);
}

function intValue(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if ((value === undefined || value === null || value === "") && fallback !== undefined)
    return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function currentSeason() {
  return new Date().getUTCFullYear();
}

async function fetchWithTimeout(url: URL | string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/csv;q=0.9, */*;q=0.1",
        "User-Agent": "Sportfolio/1.0 (+https://www.sportfolio.market)",
      },
    });
    if (!response.ok) {
      throw new Error(`MLB upstream returned HTTP ${response.status}.`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(
  base: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs: number,
): Promise<T> {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return (await (await fetchWithTimeout(url, timeoutMs)).json()) as T;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function parseCsv(text: string): { data: UnknownRecord[]; columns: string[] } {
  const rows = csvRows(text);
  if (rows.length === 0) return { data: [], columns: [] };
  const columns = rows[0].map((column) => column.trim());
  const data = rows.slice(1).map((values) => {
    const item: UnknownRecord = {};
    columns.forEach((column, index) => {
      const raw = (values[index] ?? "").trim();
      if (!raw) {
        item[column] = null;
        return;
      }
      const numeric = Number(raw);
      item[column] =
        Number.isFinite(numeric) && /^-?(?:\d+\.?\d*|\.\d+)$/.test(raw) ? numeric : raw;
    });
    return item;
  });
  return { data, columns };
}

function scheduleGame(game: any, date: string) {
  const away = game?.teams?.away ?? {};
  const home = game?.teams?.home ?? {};
  const awayProbable = away.probablePitcher ?? null;
  const homeProbable = home.probablePitcher ?? null;
  const awayName = away.team?.name ?? null;
  const homeName = home.team?.name ?? null;
  const awayScore = away.score ?? null;
  const homeScore = home.score ?? null;
  return {
    game_id: game?.gamePk ?? null,
    game_date: date,
    game_datetime: game?.gameDate ?? null,
    status: game?.status?.detailedState ?? game?.status?.abstractGameState ?? null,
    away_name: awayName,
    home_name: homeName,
    away_id: away.team?.id ?? null,
    home_id: home.team?.id ?? null,
    away_score: awayScore,
    home_score: homeScore,
    away_probable_pitcher: awayProbable?.fullName ?? null,
    home_probable_pitcher: homeProbable?.fullName ?? null,
    away_pitcher_note: awayProbable?.note ?? null,
    home_pitcher_note: homeProbable?.note ?? null,
    venue_id: game?.venue?.id ?? null,
    venue_name: game?.venue?.name ?? null,
    doubleheader: game?.doubleHeader && game.doubleHeader !== "N",
    game_num: game?.gameNumber ?? null,
    series_status: game?.seriesStatus ?? null,
    current_inning: game?.linescore?.currentInning ?? null,
    inning_state: game?.linescore?.inningState ?? null,
    national_broadcasts: [],
    broadcasts: [],
    summary:
      awayName && homeName
        ? `${awayName} at ${homeName}${awayScore != null && homeScore != null ? ` (${awayScore}-${homeScore})` : ""}`
        : null,
  };
}

async function getSchedule(date: string, timeoutMs: number) {
  const result = await fetchJson<any>(
    MLB_API_BASE,
    "/schedule",
    {
      sportId: 1,
      startDate: date,
      endDate: date,
      hydrate: "probablePitcher(note),team,venue,linescore",
    },
    timeoutMs,
  );
  const games = (result?.dates ?? []).flatMap((entry: any) =>
    (entry?.games ?? []).map((game: any) => scheduleGame(game, entry?.date ?? date)),
  );
  return { games };
}

async function getLeaderSplits(
  group: "hitting" | "pitching",
  metric: string,
  args: Record<string, unknown>,
) {
  const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
  const limit = intValue(args.limit, "limit", 1, 100, 10);
  const qualification = stringValue(args.qualification, "qualification", "qualified");
  const sortStat = (group === "hitting" ? BATTING_METRICS : PITCHING_METRICS)[metric];
  if (!sortStat) throw new Error(`Unsupported ${group} metric: ${metric}.`);
  const splits = await fetchSeasonStatSplits({
    season,
    group,
    sortStat,
    qualified: qualification !== "all",
    limit: Math.max(limit * 4, limit),
  });
  const league = stringValue(args.league, "league", "mlb").toLowerCase();
  const leagueId = LEAGUE_IDS[league];
  let filtered = splits;
  if (leagueId) {
    const teamResponse = await fetchJson<any>(
      MLB_API_BASE,
      "/teams",
      { sportIds: 1, season },
      12_000,
    );
    const allowed = new Set<number>(
      (teamResponse?.teams ?? [])
        .filter((team: any) => team?.league?.id === leagueId)
        .map((team: any) => Number(team.id)),
    );
    filtered = splits.filter((split) => split.team?.id && allowed.has(Number(split.team.id)));
  }
  return {
    metric,
    stat: sortStat,
    group,
    season,
    league,
    qualification,
    leaders: filtered.slice(0, limit),
  };
}

function parseMlbam(value: unknown): number {
  const raw = typeof value === "string" ? value.replace(/^mlb_/, "").trim() : value;
  return intValue(raw, "playerId", 1, 99_999_999);
}

async function getExpectedStats(
  role: "batter" | "pitcher",
  args: Record<string, unknown>,
  timeoutMs: number,
) {
  const year = intValue(
    args.season ?? args.year,
    "season",
    2008,
    currentSeason() + 1,
    currentSeason(),
  );
  const minimum = intValue(args.minimum ?? args.minPA, "minimum", 0, 1000, 50);
  const url = new URL(`${SAVANT_BASE}/leaderboard/expected_statistics`);
  url.searchParams.set("type", role);
  url.searchParams.set("year", String(year));
  url.searchParams.set("position", "");
  url.searchParams.set("team", "");
  url.searchParams.set("filterType", "pa");
  url.searchParams.set("min", String(minimum));
  url.searchParams.set("csv", "true");
  const text = await (await fetchWithTimeout(url, timeoutMs)).text();
  const parsed = parseCsv(text);
  return {
    data: parsed.data,
    count: parsed.data.length,
    total_rows: parsed.data.length,
    columns: parsed.columns,
    truncated: false,
  };
}

export async function callNativeMlbTool(
  publicTool: CuratedMlbToolName,
  args: Record<string, unknown>,
  options: NativeOptions,
): Promise<unknown> {
  switch (publicTool) {
    case "search_mlb_players": {
      const query = stringValue(args.query ?? args.name, "query").toLowerCase();
      const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
      const players = (await fetchAllPlayers(season))
        .filter((player) => player.fullName.toLowerCase().includes(query))
        .slice(0, 50);
      return { people: players };
    }
    case "get_mlb_batting_leaders":
      return getLeaderSplits("hitting", stringValue(args.metric, "metric", "ops"), args);
    case "get_mlb_pitching_leaders":
      return getLeaderSplits("pitching", stringValue(args.metric, "metric", "era"), args);
    case "get_mlb_player_stats": {
      const playerId = parseMlbam(args.playerId ?? args.player_id);
      const group = stringValue(args.group, "group", "hitting");
      const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
      const stats = stringValue(args.stats, "stats", "season");
      return fetchJson<any>(
        MLB_API_BASE,
        `/people/${playerId}/stats`,
        { stats, group, season, hydrate: "person" },
        options.timeoutMs,
      );
    }
    case "get_mlb_player_splits": {
      const playerId = parseMlbam(args.playerId ?? args.playerid);
      const season = intValue(
        args.season ?? args.year,
        "season",
        1876,
        currentSeason() + 1,
        currentSeason(),
      );
      return fetchJson<any>(
        MLB_API_BASE,
        `/people/${playerId}/stats`,
        { stats: "statSplits", group: "hitting", season },
        options.timeoutMs,
      );
    }
    case "get_mlb_team_leaders": {
      const teamId = intValue(args.teamId ?? args.team_id, "teamId", 1, 9999);
      const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
      const metric = stringValue(args.metric ?? args.leaderCategory, "metric");
      const limit = intValue(args.limit, "limit", 1, 100, 10);
      return fetchJson<any>(
        MLB_API_BASE,
        "/stats/leaders",
        {
          leaderCategories: metric,
          teamId,
          season,
          limit,
          sportId: 1,
          hydrate: "person,team",
        },
        options.timeoutMs,
      );
    }
    case "get_mlb_games":
      return getSchedule(stringValue(args.date, "date"), options.timeoutMs);
    case "get_mlb_game_details": {
      const gameId = intValue(args.gameId ?? args.game_id, "gameId", 1, 99_999_999);
      return fetchJson<any>(MLB_LIVE_BASE, `/game/${gameId}/feed/live`, {}, options.timeoutMs);
    }
    case "get_mlb_probable_pitchers":
      return getSchedule(stringValue(args.date, "date"), options.timeoutMs);
    case "get_mlb_standings": {
      const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
      const standingsTypes = stringValue(
        args.type ?? args.standings_types,
        "type",
        "regularSeason",
      );
      return fetchJson<any>(
        MLB_API_BASE,
        "/standings",
        { leagueId: "103,104", season, standingsTypes, hydrate: "team" },
        options.timeoutMs,
      );
    }
    case "get_mlb_roster": {
      const teamId = intValue(args.teamId ?? args.team_id, "teamId", 1, 9999);
      const season = intValue(args.season, "season", 1876, currentSeason() + 1, currentSeason());
      const rosterType = stringValue(args.rosterType ?? args.roster_type, "rosterType", "active");
      const roster = await fetchTeamRoster(teamId, season);
      return { roster, team_id: teamId, roster_type: rosterType, season };
    }
    case "get_mlb_statcast_profile": {
      const role = stringValue(args.role, "role", "batter") as "batter" | "pitcher";
      if (role !== "batter" && role !== "pitcher")
        throw new Error("role must be batter or pitcher.");
      return getExpectedStats(role, args, options.timeoutMs);
    }
  }
}

export async function nativeMlbHealth() {
  const reachable = await isApiReachable();
  return {
    reachable,
    checkedAt: new Date().toISOString(),
  };
}
