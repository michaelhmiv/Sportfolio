from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def insert_before(path: str, needle: str, addition: str) -> None:
    replace_once(path, needle, addition + needle)


# --- canonical schema/config -------------------------------------------------
replace_once(
    "shared/schema.ts",
    '    week: integer("week"), // NFL week number (1-18 for regular season, null for NBA)\n',
    '    week: integer("week"), // NFL week number (1-18 for regular season, null for NBA)\n'
    '    season: integer("season"), // NFL season start year; null for sports that do not use it here\n'
    '    seasonType: text("season_type"), // NFL: preseason | regular | postseason\n',
)
replace_once(
    "shared/schema.ts",
    '    sportWeekIdx: index("daily_games_sport_week_idx").on(table.sport, table.week),\n',
    '    sportWeekIdx: index("daily_games_sport_week_idx").on(table.sport, table.week),\n'
    '    sportSeasonWeekIdx: index("daily_games_sport_season_week_idx").on(\n'
    '      table.sport,\n'
    '      table.season,\n'
    '      table.week,\n'
    '    ),\n',
)
replace_once(
    "shared/sport-config.ts",
    'export const ENABLED_SPORTS = ["MLB", "NASCAR", "NHL"] as const;',
    'export const ENABLED_SPORTS = ["MLB", "NASCAR", "NHL", "NFL"] as const;',
)
text = read("shared/sport-config.ts")
text, count = re.subn(
    r'function getNFLSeason\(\): string \{.*?\n\}\n\nfunction getNFLSeasonYear\(\): number \{.*?\n\}',
    '''function getNFLSeason(): string {
  return String(getNFLSeasonYear());
}

function getNFLSeasonYear(): number {
  const now = new Date();
  // Fallback only: provider season metadata is authoritative server-side.
  // NFL preseason begins before September, so July-December is the current season.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}''',
    text,
    count=1,
    flags=re.MULTILINE | re.DOTALL,
)
if count != 1:
    raise RuntimeError("shared/sport-config.ts: NFL season helper not found")
write("shared/sport-config.ts", text)
replace_once(
    "shared/sport-config.ts",
    '    positions: ["QB", "RB", "WR", "TE", "K", "DEF"],',
    '    positions: ["QB", "RB", "WR", "TE", "K"],',
)
replace_once(
    "shared/sport-config.ts",
    '    apiProvider: "none",\n    getApiSeason: getNFLSeason,',
    '    apiProvider: "espn+nflverse",\n    getApiSeason: getNFLSeason,',
)
replace_once(
    "server/sports/contracts.ts",
    'export const sportSchema = z.enum(["mlb", "nhl", "nascar"]);',
    'export const sportSchema = z.enum(["mlb", "nhl", "nascar", "nfl"]);',
)
replace_once(
    "server/sports/default-registry.ts",
    'import { createNhlAdapter } from "./nhl-adapter";\n',
    'import { createNhlAdapter } from "./nhl-adapter";\nimport { createNflAdapter } from "./nfl-adapter";\n',
)
replace_once(
    "server/sports/default-registry.ts",
    '  registry.register(createNascarAdapter());\n',
    '  registry.register(createNascarAdapter());\n  registry.register(createNflAdapter());\n',
)
replace_once(
    "shared/sport-config.test.ts",
    'expect(ENABLED_SPORTS).toEqual(["MLB", "NASCAR", "NHL"]);',
    'expect(ENABLED_SPORTS).toEqual(["MLB", "NASCAR", "NHL", "NFL"]);',
)
replace_once(
    "shared/sport-config.test.ts",
    'expect(isEnabledSport("NFL")).toBe(false);',
    'expect(isEnabledSport("NFL")).toBe(true);',
)
replace_once(
    "server/sports/adapters.test.ts",
    'expect(registry.list()).toEqual(["mlb", "nascar", "nhl"]);',
    'expect(registry.list()).toEqual(["mlb", "nascar", "nfl", "nhl"]);',
)
replace_once(
    "package.json",
    '    "db:migration:verify": "node scripts/postgres-migration.mjs verify",\n',
    '    "db:migration:verify": "node scripts/postgres-migration.mjs verify",\n'
    '    "nfl:migrate-data": "tsx scripts/nfl-data-migration.ts",\n',
)

# --- existing scheduler/job registry ----------------------------------------
replace_once(
    "server/jobs/job-registry.ts",
    'import { syncMLBStats } from "./sync-mlb-stats";\n',
    'import { syncMLBStats } from "./sync-mlb-stats";\n'
    'import { syncNFLRoster } from "./sync-nfl-roster";\n'
    'import { syncNFLSchedule } from "./sync-nfl-schedule";\n'
    'import { syncNFLStats } from "./sync-nfl-stats";\n'
    'import { syncNflverseStats } from "./sync-nflverse-stats";\n',
)
insert_before(
    "server/jobs/job-registry.ts",
    'async function runNhlRoster(): Promise<JobResult> {\n',
    '''async function runNflRoster(): Promise<JobResult> {
  const result = await syncNFLRoster();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.playersAdded + result.playersUpdated,
    errorCount: result.errors.length,
  };
}

async function runNflSchedule(): Promise<JobResult> {
  const result = await syncNFLSchedule();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.gamesProcessed,
    errorCount: result.errors.length,
  };
}

async function runNflStats(): Promise<JobResult> {
  const result = await syncNFLStats();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

async function runNflverseStats(): Promise<JobResult> {
  const result = await syncNflverseStats();
  return {
    requestCount: result.requestCount,
    recordsProcessed: result.recordsProcessed,
    errorCount: result.errorCount,
  };
}

''',
)
insert_before(
    "server/jobs/job-registry.ts",
    '''  {
    name: "mlb_stats_sync",
    advertiseManual: true,
    manualOrder: 21,
    manualHandler: () => runMlbStats(),
  },''',
    '''  {
    name: "nfl_live_stats_sync",
    group: "api",
    schedule: "*/5 * * * *",
    scheduleOrder: 11,
    enabled: true,
    advertiseManual: true,
    manualOrder: 30,
    ...runWithoutProgress(runNflStats),
  },
  {
    name: "nfl_schedule_sync",
    group: "api",
    schedule: "40 * * * *",
    scheduleOrder: 12,
    enabled: true,
    advertiseManual: true,
    manualOrder: 31,
    ...runWithoutProgress(runNflSchedule),
  },
  {
    name: "nfl_roster_sync",
    group: "api",
    schedule: "25 4 * * *",
    scheduleOrder: 13,
    enabled: true,
    advertiseManual: true,
    manualOrder: 32,
    ...runWithoutProgress(runNflRoster),
  },
  {
    name: "nflverse_stats_sync",
    group: "api",
    schedule: "40 5 * * *",
    scheduleOrder: 14,
    enabled: true,
    advertiseManual: true,
    manualOrder: 33,
    ...runWithoutProgress(runNflverseStats),
  },
''',
)

# Scheduler fixtures + exact count invariants.
replace_once(
    "server/jobs/scheduler.test.ts",
    '  nascar_live_sync: "*/5 * * * *",\n',
    '  nascar_live_sync: "*/5 * * * *",\n'
    '  nfl_live_stats_sync: "*/5 * * * *",\n'
    '  nfl_schedule_sync: "40 * * * *",\n'
    '  nfl_roster_sync: "25 4 * * *",\n'
    '  nflverse_stats_sync: "40 5 * * *",\n',
)
replace_once(
    "server/jobs/scheduler.test.ts",
    '  "nascar_live_sync",\n] as const;',
    '  "nascar_live_sync",\n  "nfl_live_stats_sync",\n  "nfl_schedule_sync",\n  "nfl_roster_sync",\n  "nflverse_stats_sync",\n] as const;',
)
replace_once(
    "server/jobs/scheduler.test.ts",
    'vi.mock("./sync-nfl-roster", () => ({\n  syncNFLRoster: vi.fn().mockResolvedValue({ playersAdded: 0, playersUpdated: 0, errors: [] }),\n}));\n',
    'vi.mock("./sync-nfl-roster", () => ({\n'
    '  syncNFLRoster: vi.fn().mockResolvedValue({ requestCount: 0, playersAdded: 0, playersUpdated: 0, errors: [] }),\n'
    '}));\n'
    'vi.mock("./sync-nflverse-stats", () => ({\n'
    '  syncNflverseStats: vi.fn().mockResolvedValue(defaultJobResult),\n'
    '}));\n',
)
replace_once(
    "server/jobs/scheduler.test.ts",
    '  syncNFLStats: vi.fn().mockResolvedValue({ statsProcessed: 0, errors: [] }),',
    '  syncNFLStats: vi.fn().mockResolvedValue(defaultJobResult),',
)
for old, new in [
    ('expect(scheduler.getConfiguredJobs()).toHaveLength(29);', 'expect(scheduler.getConfiguredJobs()).toHaveLength(33);'),
    ('expect(schedulerMocks.schedule).toHaveBeenCalledTimes(29);', 'expect(schedulerMocks.schedule).toHaveBeenCalledTimes(33);'),
    ('expect(executableJobNames).toHaveLength(30);', 'expect(executableJobNames).toHaveLength(34);'),
    ('expect(names).toHaveLength(31);', 'expect(names).toHaveLength(35);'),
    ('expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(29);', 'expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(33);'),
    ('expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(30);', 'expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(34);'),
    ('expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(30);', 'expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(34);'),
]:
    replace_once("server/jobs/scheduler.test.ts", old, new)

# NFL has its own bounded live job; the old combined sync remains MLB-only.
for old, new in [
    (' * NBA and NFL are disabled during the MLB/NASCAR-only migration.\n', ' * NFL live ingestion runs in the dedicated nfl_live_stats_sync job; NBA remains disabled.\n'),
    (' * NBA and NFL are excluded during the MLB/NASCAR-only migration.\n', ' * NFL is intentionally excluded here to prevent duplicate polling; its dedicated job handles it.\n'),
    ('    // NBA and NFL are disabled during MLB/NASCAR-only migration.\n', '    // NFL has a dedicated 5-minute sync; NBA remains disabled.\n'),
]:
    replace_once("server/jobs/sync-all-live-stats.ts", old, new)

# --- preseason display-only gates -------------------------------------------
for path, import_anchor in [
    ("server/jobs/snapshot-share-payouts.ts", 'import type { ProgressCallback } from "../lib/admin-stream";\n'),
    ("server/jobs/settle-share-payouts.ts", 'import type { ProgressCallback } from "../lib/admin-stream";\n'),
    ("server/jobs/settle-boosts.ts", 'import type { ProgressCallback } from "../lib/admin-stream";\n'),
]:
    replace_once(path, import_anchor, import_anchor + 'import { isNflPreseasonGame } from "../nfl/season";\n')
replace_once(
    "server/jobs/lock-boost-shares.ts",
    'import { sendUserNotification } from "../services/notification-dispatcher";\n',
    'import { sendUserNotification } from "../services/notification-dispatcher";\nimport { isNflPreseasonGame } from "../nfl/season";\n',
)
replace_once(
    "server/jobs/snapshot-share-payouts.ts",
    '      const status = (game.status || "").toLowerCase();\n',
    '      if (isNflPreseasonGame(game)) continue;\n      const status = (game.status || "").toLowerCase();\n',
)
replace_once(
    "server/jobs/settle-share-payouts.ts",
    '        if (!game) continue;\n\n        const gameStatus',
    '        if (!game) continue;\n        if (isNflPreseasonGame(game)) continue;\n\n        const gameStatus',
)
replace_once(
    "server/jobs/lock-boost-shares.ts",
    '        const gameStart = new Date(game.startTime);\n',
    '        if (isNflPreseasonGame(game)) continue;\n\n        const gameStart = new Date(game.startTime);\n',
)
replace_once(
    "server/jobs/settle-boosts.ts",
    '        // Only settle if game is completed (or very likely completed based on elapsed time)\n',
    '        if (isNflPreseasonGame(game)) continue;\n\n        // Only settle if game is completed (or very likely completed based on elapsed time)\n',
)

# --- user-created NFL markets only ------------------------------------------
replace_once(
    "server/bot/deterministic-engine.ts",
    '    case "pool_create": {\n      if (availableShares < 1) {',
    '    case "pool_create": {\n      if (String(target.sport || "").toUpperCase() === "NFL") return null;\n      if (availableShares < 1) {',
)
replace_once(
    "server/bot/player-valuation.ts",
    '  const sports = ["NBA", "NFL"];',
    '  // NFL markets are user-created and must never be bootstrapped from stat-derived fair value.\n  const sports = ["NBA"];',
)

# Mobile market: do not present an uninitialized player as a $0.00 market quote.
replace_once(
    "client/src/components/market-mobile-home.tsx",
    '    case "price":\n      return `$${toNumber(player.currentPrice).toFixed(2)}`;',
    '    case "price":\n      return player.poolInitialized === false\n        ? "No market yet"\n        : `$${toNumber(player.currentPrice).toFixed(2)}`;',
)
replace_once(
    "client/src/components/market-mobile-home.tsx",
    '''                        <div className="font-mono text-sm font-semibold">
                          ${currentPrice.toFixed(2)}
                        </div>''',
    '''                        <div className="font-mono text-sm font-semibold">
                          {poolInitialized ? `$${currentPrice.toFixed(2)}` : "No market yet"}
                        </div>''',
)

# --- cross-provider normalization -------------------------------------------
replace_once(
    "server/jobs/sync-nfl-roster.ts",
    '  splitNflDisplayName,\n} from "../nfl/identity";',
    '  splitNflDisplayName,\n  normalizeNflTeamAbbreviation,\n} from "../nfl/identity";',
)
replace_once(
    "server/jobs/sync-nfl-roster.ts",
    '            team: team.abbreviation,',
    '            team: normalizeNflTeamAbbreviation(team.abbreviation),',
)
replace_once(
    "server/jobs/sync-nfl-schedule.ts",
    'import { getNflSeasonYear, type NflSeasonType } from "../nfl/season";\n',
    'import { getNflSeasonYear, type NflSeasonType } from "../nfl/season";\nimport { normalizeNflTeamAbbreviation } from "../nfl/identity";\n',
)
replace_once(
    "server/jobs/sync-nfl-schedule.ts",
    '    homeTeam: game.homeTeam,\n    awayTeam: game.awayTeam,',
    '    homeTeam: normalizeNflTeamAbbreviation(game.homeTeam),\n    awayTeam: normalizeNflTeamAbbreviation(game.awayTeam),',
)
replace_once(
    "server/jobs/sync-nflverse-stats.ts",
    '  splitNflDisplayName,\n} from "../nfl/identity";',
    '  splitNflDisplayName,\n  normalizeNflTeamAbbreviation,\n} from "../nfl/identity";',
)
replace_once(
    "server/jobs/sync-nflverse-stats.ts",
    '            const team = String(row.recent_team || "").trim().toUpperCase();\n            const opponent = String(row.opponent_team || "").trim().toUpperCase();',
    '            const team = normalizeNflTeamAbbreviation(row.recent_team);\n            const opponent = normalizeNflTeamAbbreviation(row.opponent_team);',
)

# ESPN box-score names are category-local (YDS/TD/INT/etc). Namespace/canonicalize them.
insert_before(
    "server/nfl/espn-client.ts",
    'export function extractEspnPlayerStats(payload: unknown): EspnNflPlayerStatLine[] {\n',
    '''function madeFromAttempts(value: unknown): number | string | null {
  const raw = text(value);
  const match = raw.match(/^(\\d+)\\s*\\//);
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
    if (stat === "yds" || stat === "yards") return "passingYards";
    if (stat === "td" || stat === "tds") return "passingTouchdowns";
    if (stat === "int") return "interceptions";
  }
  if (category.includes("rushing")) {
    if (stat === "yds" || stat === "yards") return "rushingYards";
    if (stat === "td" || stat === "tds") return "rushingTouchdowns";
  }
  if (category.includes("receiving")) {
    if (stat === "rec") return "receptions";
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

''',
)
replace_once(
    "server/nfl/espn-client.ts",
    '''    for (const category of array(teamBlock?.statistics)) {
      const names = array(category?.names).map((name) => text(name));
      for (const entry of array(category?.athletes)) {''',
    '''    for (const category of array(teamBlock?.statistics)) {
      const categoryName = text(category?.name || category?.displayName || category?.label);
      const names = array(category?.names).map((name) => text(name));
      for (const entry of array(category?.athletes)) {''',
)
replace_once(
    "server/nfl/espn-client.ts",
    '''        names.forEach((name, index) => {
          if (!name) return;
          existing.stats[normalizeKey(name)] = statValue(values[index]);
        });''',
    '''        names.forEach((name, index) => {
          if (!name) return;
          const canonicalName = canonicalEspnStat(categoryName, name);
          existing.stats[normalizeKey(canonicalName)] = canonicalEspnStatValue(
            categoryName,
            name,
            values[index],
          );
        });''',
)
replace_once(
    "server/nfl/espn-client.test.ts",
    '                names: ["fieldGoalsMade", "extraPointsMade"],',
    '                name: "kicking",\n                names: ["FG", "XP"],',
)
insert_before(
    "server/nfl/espn-client.test.ts",
    '  it("retries one 429 response and succeeds", async () => {\n',
    '''  it("namespaces ESPN shorthand stats by category", () => {
    const [row] = extractEspnPlayerStats({
      boxscore: {
        players: [
          {
            team: { abbreviation: "BUF" },
            statistics: [
              {
                name: "passing",
                names: ["YDS", "TD", "INT"],
                athletes: [
                  {
                    athlete: { id: "17", displayName: "QB Test", position: { abbreviation: "QB" } },
                    stats: ["280", "2", "1"],
                  },
                ],
              },
              {
                name: "rushing",
                names: ["YDS", "TD"],
                athletes: [
                  {
                    athlete: { id: "17", displayName: "QB Test", position: { abbreviation: "QB" } },
                    stats: ["42", "1"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(row.stats).toMatchObject({
      passingyards: 280,
      passingtouchdowns: 2,
      interceptions: 1,
      rushingyards: 42,
      rushingtouchdowns: 1,
    });
  });

''',
)

# Production cleanup discovery must target deletable base tables, never views.
replace_once(
    "scripts/nfl-data-migration.ts",
    '''          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema='public'
            AND column_name IN ('player_id','asset_id','canonical_player_id','alias_player_id')
          ORDER BY table_name, column_name''',
    '''          SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema='public'
            AND t.table_type='BASE TABLE'
            AND c.column_name IN ('player_id','asset_id','canonical_player_id','alias_player_id')
          ORDER BY c.table_name, c.column_name''',
)

# Existing integration guide must no longer claim NFL ingestion is disabled.
replace_once(
    "docs/API_INTEGRATION.md",
    '| NASCAR API   | NASCAR | Roster, Schedule, Stats | Internal      |\n',
    '| NASCAR API   | NASCAR | Roster, Schedule, Stats | Internal      |\n'
    '| ESPN + nflverse | NFL | Live/current + identity/history | No |\n',
)
text = read("docs/API_INTEGRATION.md")
legacy_note = '''> **Migration Note (July 2026):** NBA and NFL data ingestion is disabled during the
> MLB/NASCAR-only migration. The Ball Don't Lie API (previously used for MLB, NBA, and NFL)
> is no longer consumed for MLB data. NBA and NFL integrations remain in the codebase
> but are disabled at the scheduler level (`enabled: false` in `scheduler.ts`).'''
if legacy_note not in text:
    raise RuntimeError("docs/API_INTEGRATION.md: legacy NFL migration note not found")
text = text.replace(
    legacy_note,
    '> **Migration Note (August 2026):** NBA ingestion remains disabled. NFL has been restored on the unified sports foundation using ESPN for current/live data and nflverse for GSIS identity and 2024+ historical statistics. The legacy Ball Don\'t Lie NFL path is retired.',
    1,
)
write("docs/API_INTEGRATION.md", text)

print("Applied deterministic NFL restoration integration patch")
