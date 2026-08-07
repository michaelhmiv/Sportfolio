import { NFL_SEASON_TYPE_CODE, normalizeNflSeasonType, type NflSeasonType } from "./season";

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 1;
export const NFL_ELIGIBLE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);

export interface EspnNflTeam {
  id: string;
  abbreviation: string;
  name: string;
}

export interface EspnNflAthlete {
  espnId: string;
  displayName: string;
  position: string;
  team: string | null;
  jersey: string | null;
  active: boolean;
}

export interface EspnNflGame {
  espnId: string;
  season: number;
  seasonType: NflSeasonType;
  week: number | null;
  startsAt: Date;
  status: "scheduled" | "inprogress" | "completed" | "postponed" | "cancelled";
  sourceStatus: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  period: number | null;
  clock: string | null;
}

export interface EspnNflPlayerStatLine {
  espnId: string;
  displayName: string;
  position: string;
  team: string | null;
  stats: Record<string, number | string | null>;
  fieldGoalDistances: number[];
}

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function statusFromCompetition(event: Record<string, any>, competition: Record<string, any>) {
  const status = record(competition.status) || record(event.status) || {};
  const type = record(status.type) || {};
  const source = text(type.name || type.description || type.detail || status.type);
  const state = text(type.state).toLowerCase();
  const completed = Boolean(type.completed);
  const lower = source.toLowerCase();
  if (completed || state === "post" || lower.includes("final")) return "completed" as const;
  if (lower.includes("postpon")) return "postponed" as const;
  if (lower.includes("cancel")) return "cancelled" as const;
  if (state === "in" || lower.includes("progress") || lower.includes("halftime")) {
    return "inprogress" as const;
  }
  return "scheduled" as const;
}

function competitorTeam(competition: Record<string, any>, homeAway: "home" | "away") {
  return array(competition.competitors).find((candidate) => text(candidate?.homeAway) === homeAway);
}

export function normalizeEspnGame(value: unknown): EspnNflGame | null {
  const event = record(value);
  if (!event) return null;
  const competition = record(array(event.competitions)[0]);
  if (!competition) return null;
  const id = text(event.id || competition.id);
  const start = new Date(text(event.date || competition.date));
  if (!id || Number.isNaN(start.getTime())) return null;
  const home = competitorTeam(competition, "home");
  const away = competitorTeam(competition, "away");
  const homeTeam = text(home?.team?.abbreviation || home?.team?.shortDisplayName);
  const awayTeam = text(away?.team?.abbreviation || away?.team?.shortDisplayName);
  if (!homeTeam || !awayTeam) return null;
  const seasonInfo = record(event.season) || {};
  const season = Math.trunc(Number(seasonInfo.year || event.season?.year || start.getFullYear()));
  const seasonType = normalizeNflSeasonType(seasonInfo.type || event.seasonType?.type || 2);
  const statusObject = record(competition.status) || record(event.status) || {};
  const sourceType = record(statusObject.type) || {};
  return {
    espnId: id,
    season: Number.isFinite(season) ? season : start.getFullYear(),
    seasonType,
    week: numberOrNull(event.week?.number ?? competition.week?.number),
    startsAt: start,
    status: statusFromCompetition(event, competition),
    sourceStatus: text(sourceType.name || sourceType.description || sourceType.detail) || null,
    homeTeam: homeTeam.toUpperCase(),
    awayTeam: awayTeam.toUpperCase(),
    homeScore: numberOrNull(home?.score),
    awayScore: numberOrNull(away?.score),
    venue: text(competition.venue?.fullName || competition.venue?.name) || null,
    period: numberOrNull(statusObject.period),
    clock: text(statusObject.displayClock) || null,
  };
}

function recursiveAthletes(
  value: unknown,
  team: string | null,
  out: EspnNflAthlete[],
  seen: Set<string>,
) {
  if (Array.isArray(value)) {
    for (const item of value) recursiveAthletes(item, team, out, seen);
    return;
  }
  const node = record(value);
  if (!node) return;
  const athlete = record(node.athlete) || node;
  const id = text(athlete.id);
  const name = text(athlete.fullName || athlete.displayName || athlete.shortName);
  const position = text(
    athlete.position?.abbreviation || node.position?.abbreviation,
  ).toUpperCase();
  if (id && name && NFL_ELIGIBLE_POSITIONS.has(position) && !seen.has(id)) {
    seen.add(id);
    out.push({
      espnId: id,
      displayName: name,
      position,
      team,
      jersey: text(athlete.jersey || node.jersey) || null,
      active: athlete.active !== false && node.active !== false,
    });
  }
  for (const [key, child] of Object.entries(node)) {
    if (["athlete", "position", "team"].includes(key)) continue;
    if (child && typeof child === "object") recursiveAthletes(child, team, out, seen);
  }
}

export function extractEspnRoster(payload: unknown, team: string | null): EspnNflAthlete[] {
  const out: EspnNflAthlete[] = [];
  recursiveAthletes(payload, team, out, new Set());
  return out;
}

export function extractEspnTeams(payload: unknown): EspnNflTeam[] {
  const root = record(payload);
  const teams: EspnNflTeam[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const node = record(value);
    if (!node) return;
    const candidate = record(node.team);
    if (candidate) {
      const id = text(candidate.id);
      const abbreviation = text(candidate.abbreviation).toUpperCase();
      const name = text(candidate.displayName || candidate.name || candidate.shortDisplayName);
      if (id && abbreviation && name && !seen.has(id)) {
        seen.add(id);
        teams.push({ id, abbreviation, name });
      }
    }
    for (const child of Object.values(node)) if (child && typeof child === "object") walk(child);
  };
  walk(root);
  return teams;
}

function scoringFieldGoalDistances(summary: Record<string, any>): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const plays = [...array(summary.scoringPlays), ...array(summary.plays)];
  for (const play of plays) {
    const typeText = text(play?.type?.text || play?.type?.abbreviation).toLowerCase();
    const playText = text(play?.text || play?.shortText);
    if (!typeText.includes("field goal") && !/field goal/i.test(playText)) continue;
    if (/no good|missed|blocked/i.test(playText)) continue;
    const distanceMatch = playText.match(/(\d{1,2})\s*(?:yd|yard)/i);
    const distance = distanceMatch ? Number(distanceMatch[1]) : null;
    if (!distance || !Number.isFinite(distance)) continue;
    const participants = [...array(play?.participants), ...array(play?.athletes)];
    for (const participant of participants) {
      const id = text(participant?.athlete?.id || participant?.id);
      if (!id) continue;
      const current = result.get(id) || [];
      current.push(distance);
      result.set(id, current);
    }
  }
  return result;
}

function statValue(value: unknown): number | string | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : text(value) || null;
}

function madeFromAttempts(value: unknown): number | string | null {
  const raw = text(value);
  const match = raw.match(/^(\d+)\s*\//);
  return match ? Number(match[1]) : statValue(value);
}

function canonicalEspnStat(categoryName: string, statName: string): string {
  const category = normalizeKey(categoryName);
  const stat = normalizeKey(statName);
  const alreadyCanonical: Record<string, string> = {
    passingyards: "passingYards",
    passingtouchdowns: "passingTouchdowns",
    passingtds: "passingTouchdowns",
    interceptions: "interceptions",
    rushingyards: "rushingYards",
    rushingtouchdowns: "rushingTouchdowns",
    rushingtds: "rushingTouchdowns",
    receptions: "receptions",
    receivingyards: "receivingYards",
    receivingtouchdowns: "receivingTouchdowns",
    receivingtds: "receivingTouchdowns",
    fumbleslost: "fumblesLost",
    lostfumbles: "fumblesLost",
    fieldgoalsmade: "fieldGoalsMade",
    extrapointsmade: "extraPointsMade",
  };
  if (alreadyCanonical[stat]) return alreadyCanonical[stat];
  if (category.includes("passing")) {
    if (stat === "catt" || stat === "cmpatt") return "passingCompletionsAttempts";
    if (stat === "yds" || stat === "yards") return "passingYards";
    if (stat === "td" || stat === "tds") return "passingTouchdowns";
    if (stat === "int") return "interceptions";
  }
  if (category.includes("rushing")) {
    if (stat === "car" || stat === "att" || stat === "attempts") return "rushingAttempts";
    if (stat === "yds" || stat === "yards") return "rushingYards";
    if (stat === "td" || stat === "tds") return "rushingTouchdowns";
  }
  if (category.includes("receiving")) {
    if (stat === "rec") return "receptions";
    if (stat === "tgts" || stat === "tgt" || stat === "targets") return "receivingTargets";
    if (stat === "yds" || stat === "yards") return "receivingYards";
    if (stat === "td" || stat === "tds") return "receivingTouchdowns";
  }
  if (category.includes("fumble") && stat === "lost") return "fumblesLost";
  if (category.includes("kicking")) {
    if (stat === "fg") return "fieldGoalsMade";
    if (stat === "xp") return "extraPointsMade";
  }
  return `${category || "stat"}_${stat}`;
}

function canonicalEspnStatValue(categoryName: string, statName: string, value: unknown) {
  const category = normalizeKey(categoryName);
  const stat = normalizeKey(statName);
  if (category.includes("kicking") && (stat === "fg" || stat === "xp")) {
    return madeFromAttempts(value);
  }
  return statValue(value);
}

function relevantEspnBoxscoreCategory(categoryName: string): boolean {
  const category = normalizeKey(categoryName);
  return ["passing", "rushing", "receiving", "fumble", "kicking"].some((token) =>
    category.includes(token),
  );
}

function inferPositionFromCategory(categoryName: string): string {
  const category = normalizeKey(categoryName);
  if (category.includes("passing")) return "QB";
  if (category.includes("kicking")) return "K";
  return "";
}

function splitAttempts(value: unknown): [number, number] | null {
  const match = text(value).match(/^(\d+)\s*\/\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function extractEspnPlayerStats(payload: unknown): EspnNflPlayerStatLine[] {
  const summary = record(payload);
  if (!summary) return [];
  const distances = scoringFieldGoalDistances(summary);
  const merged = new Map<string, EspnNflPlayerStatLine>();

  for (const teamBlock of array(summary.boxscore?.players)) {
    const team = text(teamBlock?.team?.abbreviation).toUpperCase() || null;
    for (const category of array(teamBlock?.statistics)) {
      const categoryName = text(category?.name || category?.displayName || category?.label);
      if (!relevantEspnBoxscoreCategory(categoryName)) continue;
      const names = array(category?.names).map((name) => text(name));
      for (const entry of array(category?.athletes)) {
        const athlete = record(entry?.athlete);
        if (!athlete) continue;
        const espnId = text(athlete.id);
        const displayName = text(athlete.displayName || athlete.fullName);
        const explicitPosition = text(athlete.position?.abbreviation).toUpperCase();
        if (explicitPosition && !NFL_ELIGIBLE_POSITIONS.has(explicitPosition)) continue;
        const position = explicitPosition || inferPositionFromCategory(categoryName);
        if (!espnId || !displayName) continue;
        const existing = merged.get(espnId) || {
          espnId,
          displayName,
          position,
          team,
          stats: {},
          fieldGoalDistances: distances.get(espnId) || [],
        };
        if (!existing.position && position) existing.position = position;
        if (!existing.team && team) existing.team = team;
        const values = array(entry?.stats);
        names.forEach((name, index) => {
          if (!name) return;
          const rawValue = values[index];
          const canonicalName = canonicalEspnStat(categoryName, name);
          existing.stats[normalizeKey(canonicalName)] = canonicalEspnStatValue(
            categoryName,
            name,
            rawValue,
          );
          const categoryKey = normalizeKey(categoryName);
          const statKey = normalizeKey(name);
          const attempts = splitAttempts(rawValue);
          if (
            categoryKey.includes("passing") &&
            (statKey === "catt" || statKey === "cmpatt") &&
            attempts
          ) {
            existing.stats.passingcompletions = attempts[0];
            existing.stats.passingattempts = attempts[1];
          }
          if (categoryKey.includes("kicking") && statKey === "fg" && attempts) {
            existing.stats.fieldgoalsmade = attempts[0];
            existing.stats.fieldgoalsattempted = attempts[1];
          }
          if (categoryKey.includes("kicking") && statKey === "xp" && attempts) {
            existing.stats.extrapointsmade = attempts[0];
            existing.stats.extrapointsattempted = attempts[1];
          }
        });
        merged.set(espnId, existing);
      }
    }
  }
  return [...merged.values()];
}

export function espnStatNumber(
  stats: Record<string, number | string | null>,
  ...aliases: string[]
): number {
  for (const alias of aliases) {
    const raw = stats[normalizeKey(alias)];
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export class EspnNflClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly retries = DEFAULT_RETRIES,
  ) {}

  private async json(path: string, params: Record<string, string | number | undefined> = {}) {
    const url = new URL(`${BASE_URL}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": "Sportfolio/1.0" },
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const error = new Error(`ESPN NFL request failed (${response.status})`);
          if (!retryable || attempt >= this.retries) throw error;
          lastError = error;
          continue;
        }
        const payload = await response.json();
        if (!payload || typeof payload !== "object")
          throw new Error("ESPN NFL returned invalid JSON");
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt >= this.retries || (error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ESPN NFL request failed");
  }

  async getScoreboard(
    options: {
      dates?: string;
      seasonType?: NflSeasonType;
      week?: number;
      limit?: number;
    } = {},
  ) {
    return this.json("scoreboard", {
      dates: options.dates,
      seasontype: options.seasonType ? NFL_SEASON_TYPE_CODE[options.seasonType] : undefined,
      week: options.week,
      limit: options.limit ?? 200,
    });
  }

  async getGames(
    options: Parameters<EspnNflClient["getScoreboard"]>[0] = {},
  ): Promise<EspnNflGame[]> {
    const payload = await this.getScoreboard(options);
    return array((payload as any).events)
      .map(normalizeEspnGame)
      .filter((game): game is EspnNflGame => Boolean(game));
  }

  async getTeams(): Promise<EspnNflTeam[]> {
    return extractEspnTeams(await this.json("teams", { limit: 40 }));
  }

  async getTeamRoster(teamId: string): Promise<EspnNflAthlete[]> {
    const payload = await this.json(`teams/${encodeURIComponent(teamId)}/roster`);
    const team = text((payload as any)?.team?.abbreviation).toUpperCase() || null;
    return extractEspnRoster(payload, team);
  }

  async getSummary(eventId: string) {
    return this.json("summary", { event: eventId });
  }
}

export const espnNfl = new EspnNflClient();
