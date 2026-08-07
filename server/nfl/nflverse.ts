import { normalizeNflSeasonType, type NflSeasonType } from "./season";

export const NFLVERSE_PLAYERS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
export const nflverseWeeklyStatsUrl = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

const DEFAULT_TIMEOUT_MS = 15_000;
const PLAYER_CACHE_MS = 6 * 60 * 60 * 1000;

export type CsvRow = Record<string, string>;

/** RFC4180-compatible parser including quoted commas, escaped quotes and quoted newlines. */
export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  if (rows.length < 2) return [];

  const headers = rows[0].map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, "") : value,
  );
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/csv,*/*;q=0.8", "User-Agent": "Sportfolio/1.0" },
    });
    if (!response.ok) throw new Error(`nflverse request failed (${response.status})`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

const nullableInt = (value: string | undefined): number | null => {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export interface NflversePlayerIdentity {
  gsisId: string;
  espnId: string | null;
  displayName: string;
  position: string | null;
  team: string | null;
  active: boolean;
}

export interface NflverseWeeklyStat extends CsvRow {
  player_id: string;
  season: string;
  week: string;
  season_type: string;
  recent_team: string;
  opponent_team: string;
}

export class NflverseClient {
  private playerCache: { expiresAt: number; value: NflversePlayerIdentity[] } | null = null;

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async getPlayers(options: { force?: boolean } = {}): Promise<NflversePlayerIdentity[]> {
    if (!options.force && this.playerCache && this.playerCache.expiresAt > Date.now()) {
      return this.playerCache.value;
    }
    const rows = parseCsv(await fetchText(NFLVERSE_PLAYERS_URL, this.timeoutMs));
    const players = rows
      .map((row) => {
        const gsisId = String(row.gsis_id || "").trim();
        const displayName = String(
          row.display_name || row.full_name || row.common_first_name || row.short_name || "",
        ).trim();
        if (!gsisId || !displayName) return null;
        const position = String(row.position || row.position_group || "").trim().toUpperCase() || null;
        const team =
          String(row.latest_team || row.team_abbr || row.team || "").trim().toUpperCase() || null;
        const status = String(row.status || "").trim().toUpperCase();
        const active = status ? !["RET", "RETIRED", "INA", "INACTIVE"].includes(status) : true;
        return {
          gsisId,
          espnId: String(row.espn_id || "").trim() || null,
          displayName,
          position,
          team,
          active,
        } satisfies NflversePlayerIdentity;
      })
      .filter((value): value is NflversePlayerIdentity => Boolean(value));
    this.playerCache = { expiresAt: Date.now() + PLAYER_CACHE_MS, value: players };
    return players;
  }

  async getWeeklyStats(season: number): Promise<NflverseWeeklyStat[]> {
    if (!Number.isInteger(season) || season < 1999 || season > 2100) {
      throw new Error(`Invalid NFL season ${season}`);
    }
    const rows = parseCsv(await fetchText(nflverseWeeklyStatsUrl(season), this.timeoutMs));
    return rows.filter((row): row is NflverseWeeklyStat =>
      Boolean(row.player_id && row.season && row.week && row.season_type),
    );
  }
}

export const nflverse = new NflverseClient();

export function nflverseSeasonType(row: CsvRow): NflSeasonType {
  const value = String(row.season_type || "").trim().toUpperCase();
  if (value === "PRE") return "preseason";
  if (value === "POST") return "postseason";
  return normalizeNflSeasonType(value);
}

export function nflverseWeek(row: CsvRow): number | null {
  return nullableInt(row.week);
}

export function nflverseNumber(row: CsvRow, ...keys: string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw == null || raw === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
