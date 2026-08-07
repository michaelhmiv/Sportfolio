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
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, repl: str) -> None:
    text = read(path)
    new, count = re.subn(pattern, repl, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex occurrence, found {count}: {pattern[:80]!r}")
    write(path, new)


# Shared schema: persist NFL season + season type explicitly.
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

# Enable NFL in shared config and correct the old August-season bug.
replace_once(
    "shared/sport-config.ts",
    'export const ENABLED_SPORTS = ["MLB", "NASCAR", "NHL"] as const;',
    'export const ENABLED_SPORTS = ["MLB", "NASCAR", "NHL", "NFL"] as const;',
)
regex_once(
    "shared/sport-config.ts",
    r'function getNFLSeason\(\): string \{.*?\n\}\n\nfunction getNFLSeasonYear\(\): number \{.*?\n\}',
    '''function getNFLSeason(): string {
  return String(getNFLSeasonYear());
}

function getNFLSeasonYear(): number {
  const now = new Date();
  // Fallback only: the server prefers provider season metadata.
  // NFL preseason begins before September, so July-December belongs to the current season.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}''',
)
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

# Unified contracts + default registry.
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

# Sport config tests + adapter registry tests.
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

# Package/operator migration command.
replace_once(
    "package.json",
    '    "db:migration:verify": "node scripts/postgres-migration.mjs verify",\n',
    '    "db:migration:verify": "node scripts/postgres-migration.mjs verify",\n'
    '    "nfl:migrate-data": "tsx scripts/nfl-data-migration.ts",\n',
)

# Dedicated NFL jobs in the existing registry.
replace_once(
    "server/jobs/job-registry.ts",
    'import { syncMLBStats } from "./sync-mlb-stats";\n',
    'import { syncMLBStats } from "./sync-mlb-stats";\n'
    'import { syncNFLRoster } from "./sync-nfl-roster";\n'
    'import { syncNFLSchedule } from "./sync-nfl-schedule";\n'
    'import { syncNFLStats } from "./sync-nfl-stats";\n'
    'import { syncNflverseStats } from "./sync-nflverse-stats";\n',
)
replace_once(
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

async function runNhlRoster(): Promise<JobResult> {
''',
)
replace_once(
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
  {
    name: "mlb_stats_sync",
    advertiseManual: true,
    manualOrder: 21,
    manualHandler: () => runMlbStats(),
  },''',
)

# Scheduler registration expectations/mocks.
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
    '  "nascar_live_sync",\n'
    '  "nfl_live_stats_sync",\n'
    '  "nfl_schedule_sync",\n'
    '  "nfl_roster_sync",\n'
    '  "nflverse_stats_sync",\n'
    '] as const;',
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

# Explicitly keep the old combined live job MLB-only; NFL has its own bounded 5-minute job.
replace_once(
    "server/jobs/sync-all-live-stats.ts",
    ' * NBA and NFL are disabled during the MLB/NASCAR-only migration.\n',
    ' * NFL live ingestion runs in the dedicated nfl_live_stats_sync job; NBA remains disabled.\n',
)
replace_once(
    "server/jobs/sync-all-live-stats.ts",
    ' * NBA and NFL are excluded during the MLB/NASCAR-only migration.\n',
    ' * NFL is intentionally excluded here to prevent duplicate polling; its dedicated job handles it.\n',
)
replace_once(
    "server/jobs/sync-all-live-stats.ts",
    '    // NBA and NFL are disabled during MLB/NASCAR-only migration.\n',
    '    // NFL has a dedicated 5-minute sync; NBA remains disabled.\n',
)

# Preseason is display-only: block share snapshots, share settlement, boost lock and boost settlement.
replace_once(
    "server/jobs/snapshot-share-payouts.ts",
    'import type { ProgressCallback } from "../lib/admin-stream";\n',
    'import type { ProgressCallback } from "../lib/admin-stream";\nimport { isNflPreseasonGame } from "../nfl/season";\n',
)
replace_once(
    "server/jobs/snapshot-share-payouts.ts",
    '      const status = (game.status || "").toLowerCase();\n',
    '      if (isNflPreseasonGame(game)) continue;\n      const status = (game.status || "").toLowerCase();\n',
)
replace_once(
    "server/jobs/settle-share-payouts.ts",
    'import type { ProgressCallback } from "../lib/admin-stream";\n',
    'import type { ProgressCallback } from "../lib/admin-stream";\nimport { isNflPreseasonGame } from "../nfl/season";\n',
)
replace_once(
    "server/jobs/settle-share-payouts.ts",
    '        if (!game) continue;\n\n        const gameStatus',
    '        if (!game) continue;\n        if (isNflPreseasonGame(game)) continue;\n\n        const gameStatus',
)
replace_once(
    "server/jobs/lock-boost-shares.ts",
    'import { sendUserNotification } from "../services/notification-dispatcher";\n',
    'import { sendUserNotification } from "../services/notification-dispatcher";\nimport { isNflPreseasonGame } from "../nfl/season";\n',
)
replace_once(
    "server/jobs/lock-boost-shares.ts",
    '        const gameStart = new Date(game.startTime);\n',
    '        if (isNflPreseasonGame(game)) continue;\n\n        const gameStart = new Date(game.startTime);\n',
)
replace_once(
    "server/jobs/settle-boosts.ts",
    'import type { ProgressCallback } from "../lib/admin-stream";\n',
    'import type { ProgressCallback } from "../lib/admin-stream";\nimport { isNflPreseasonGame } from "../nfl/season";\n',
)
replace_once(
    "server/jobs/settle-boosts.ts",
    '        // Only settle if game is completed (or very likely completed based on elapsed time)\n',
    '        if (isNflPreseasonGame(game)) continue;\n\n        // Only settle if game is completed (or very likely completed based on elapsed time)\n',
)

# Bots must never bootstrap an NFL pool. A user-created pool remains tradable by normal paths.
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

# Normalize cross-provider team abbreviations in new NFL ingestion files.
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

# Final reconciliation must be based on resolved identities, not raw lines that may be skipped.
path = "server/jobs/sync-nfl-stats.ts"
text = read(path)
text = text.replace(
    '        const lines = extractEspnPlayerStats(summary);\n        if (lines.length === 0) {\n          throw new Error("ESPN summary returned no eligible NFL player statistics");\n        }\n        let written = 0;\n        for (const line of lines) {\n          const identity = identities.byEspnId.get(line.espnId);\n          if (!identity?.gsisId) continue;',
    '        const lines = extractEspnPlayerStats(summary);\n        const resolvedLines = lines\n          .map((line) => ({ line, identity: identities.byEspnId.get(line.espnId) }))\n          .filter((value) => Boolean(value.identity?.gsisId));\n        if (resolvedLines.length === 0) {\n          throw new Error("ESPN summary returned no resolvable eligible NFL player statistics");\n        }\n        let written = 0;\n        for (const { line, identity } of resolvedLines) {',
    1,
)
text = text.replace(
    '          const isLastWrittenCandidate = written === lines.length - 1;',
    '          const isLastWrittenCandidate = written === resolvedLines.length - 1;',
    1,
)
write(path, text)

# Make new/created NFL files visible to changed-file lint/style checks in this deterministic run.
for path in [
    "server/nfl/scoring.ts",
    "server/nfl/season.ts",
    "server/nfl/nflverse.ts",
    "server/nfl/espn-client.ts",
    "server/nfl/identity.ts",
    "server/sports/nfl-adapter.ts",
    "server/jobs/sync-nfl-roster.ts",
    "server/jobs/sync-nfl-schedule.ts",
    "server/jobs/sync-nfl-stats.ts",
    "server/jobs/sync-nflverse-stats.ts",
    "scripts/nfl-data-migration.ts",
    "server/nfl/scoring.test.ts",
    "server/nfl/season.test.ts",
    "server/nfl/nflverse.test.ts",
    "server/nfl/espn-client.test.ts",
]:
    text = read(path)
    marker = "// NFL restoration: ESPN current/live + nflverse identity/history.\n"
    if not text.startswith(marker):
        write(path, marker + text)

print("Applied deterministic NFL restoration integration patch")
