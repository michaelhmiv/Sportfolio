from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

# Generic persisted box-score storage. This table is deliberately game-level so
# unresolved provider athletes can remain displayable without becoming assets.
write("server/game-boxscores.ts", r'''import { pool } from "./db";

export type GameBoxscoreRecord<T = Record<string, unknown>> = {
  gameId: string;
  sport: string;
  provider: string;
  payload: T;
  reconciliationStatus: "live" | "final_provisional" | "complete";
  isFinal: boolean;
  sourceFetchedAt: Date;
};

let schemaPromise: Promise<void> | null = null;

export function ensureGameBoxscoresSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS game_boxscores (
          game_id text PRIMARY KEY,
          sport text NOT NULL,
          provider text NOT NULL,
          boxscore_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          reconciliation_status text NOT NULL DEFAULT 'live',
          is_final boolean NOT NULL DEFAULT false,
          source_fetched_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS game_boxscores_sport_idx ON game_boxscores(sport);
        CREATE INDEX IF NOT EXISTS game_boxscores_final_idx ON game_boxscores(sport, is_final);
      `)
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

export async function upsertGameBoxscore<T extends Record<string, unknown>>(input: {
  gameId: string;
  sport: string;
  provider: string;
  payload: T;
  reconciliationStatus: "live" | "final_provisional" | "complete";
  isFinal: boolean;
  sourceFetchedAt?: Date;
}): Promise<void> {
  await ensureGameBoxscoresSchema();
  await pool.query(
    `INSERT INTO game_boxscores (
       game_id, sport, provider, boxscore_json, reconciliation_status, is_final, source_fetched_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (game_id) DO UPDATE SET
       sport = EXCLUDED.sport,
       provider = EXCLUDED.provider,
       boxscore_json = EXCLUDED.boxscore_json,
       reconciliation_status = EXCLUDED.reconciliation_status,
       is_final = EXCLUDED.is_final,
       source_fetched_at = EXCLUDED.source_fetched_at,
       updated_at = now()`,
    [
      input.gameId,
      input.sport,
      input.provider,
      JSON.stringify(input.payload),
      input.reconciliationStatus,
      input.isFinal,
      input.sourceFetchedAt || new Date(),
    ],
  );
}

export async function getGameBoxscore<T = Record<string, unknown>>(
  gameId: string,
): Promise<GameBoxscoreRecord<T> | null> {
  await ensureGameBoxscoresSchema();
  const result = await pool.query(
    `SELECT game_id, sport, provider, boxscore_json, reconciliation_status, is_final, source_fetched_at
       FROM game_boxscores WHERE game_id = $1 LIMIT 1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    gameId: row.game_id,
    sport: row.sport,
    provider: row.provider,
    payload: row.boxscore_json as T,
    reconciliationStatus: row.reconciliation_status,
    isFinal: Boolean(row.is_final),
    sourceFetchedAt: new Date(row.source_fetched_at),
  };
}
''')

# Make the ESPN parser position-tolerant and preserve common box-score attempts.
espn_path = "server/nfl/espn-client.ts"
espn = read(espn_path)
espn = replace_once(
    espn,
    '  if (category.includes("passing")) {\n    if (stat === "yds" || stat === "yards") return "passingYards";',
    '  if (category.includes("passing")) {\n    if (stat === "catt" || stat === "cmpatt") return "passingCompletionsAttempts";\n    if (stat === "yds" || stat === "yards") return "passingYards";',
    "passing stat mapping",
)
espn = replace_once(
    espn,
    '  if (category.includes("rushing")) {\n    if (stat === "yds" || stat === "yards") return "rushingYards";',
    '  if (category.includes("rushing")) {\n    if (stat === "car" || stat === "att" || stat === "attempts") return "rushingAttempts";\n    if (stat === "yds" || stat === "yards") return "rushingYards";',
    "rushing stat mapping",
)
espn = replace_once(
    espn,
    '  if (category.includes("receiving")) {\n    if (stat === "rec") return "receptions";',
    '  if (category.includes("receiving")) {\n    if (stat === "rec") return "receptions";\n    if (stat === "tgts" || stat === "tgt" || stat === "targets") return "receivingTargets";',
    "receiving stat mapping",
)
start = espn.index("export function extractEspnPlayerStats")
end = espn.index("export function espnStatNumber", start)
new_extract = r'''function relevantEspnBoxscoreCategory(categoryName: string): boolean {
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
          if (categoryKey.includes("passing") && (statKey === "catt" || statKey === "cmpatt") && attempts) {
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

'''
espn = espn[:start] + new_extract + espn[end:]
write(espn_path, espn)

# Replace the NFL live sync with game-level persistence + roster-admitted projection only.
write("server/jobs/sync-nfl-stats.ts", r'''import { storage } from "../storage";
import { getGameBoxscore, upsertGameBoxscore } from "../game-boxscores";
import { espnNfl, espnStatNumber, extractEspnPlayerStats, type EspnNflPlayerStatLine } from "../nfl/espn-client";
import { buildNflIdentityMaps, createNflEspnAlias, createNflPlayerId } from "../nfl/identity";
import { nflverse } from "../nfl/nflverse";
import { calculateNflFantasyPoints } from "../nfl/scoring";
import { isNflGameplayEligibleSeasonType } from "../nfl/season";

export interface NflStatsSyncResult {
  requestCount: number;
  recordsProcessed: number;
  gamesProcessed: number;
  playersRecovered: number;
  finalReconciliations: number;
  boxscoreLinesParsed: number;
  identityResolved: number;
  identityUnresolved: number;
  boxscoresWritten: number;
  errorCount: number;
  errors: string[];
}

export interface NflStatsSyncOptions {
  dates?: string;
  forceFinal?: boolean;
}

const formatDate = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

const statNumber = (line: EspnNflPlayerStatLine, ...aliases: string[]) =>
  espnStatNumber(line.stats, ...aliases);

async function resolveExistingPlayer(line: EspnNflPlayerStatLine, identities: ReturnType<typeof buildNflIdentityMaps>) {
  const identity = identities.byEspnId.get(line.espnId);
  if (identity?.gsisId) {
    const canonicalId = createNflPlayerId(identity.gsisId);
    const player = await storage.getPlayer(canonicalId);
    if (player) return { player, identity };
  }
  const aliasId = createNflEspnAlias(line.espnId);
  const canonicalId = await storage.getCanonicalPlayerId(aliasId);
  if (canonicalId !== aliasId) {
    const player = await storage.getPlayer(canonicalId);
    if (player?.sport === "NFL") return { player, identity };
  }
  return { player: undefined, identity };
}

function toDisplayPlayer(line: EspnNflPlayerStatLine, player: any, identity: any) {
  const position = line.position || player?.position || identity?.position || "";
  return {
    id: line.espnId,
    espnId: line.espnId,
    playerId: player?.id || null,
    name: line.displayName,
    position,
    team: String(line.team || player?.team || identity?.team || "").toUpperCase(),
    passingCompletions: statNumber(line, "passingCompletions"),
    passingAttempts: statNumber(line, "passingAttempts"),
    passingYards: statNumber(line, "passingYards"),
    passingTDs: statNumber(line, "passingTouchdowns", "passingTDs"),
    interceptions: statNumber(line, "interceptions"),
    rushingAttempts: statNumber(line, "rushingAttempts"),
    rushingYards: statNumber(line, "rushingYards"),
    rushingTDs: statNumber(line, "rushingTouchdowns", "rushingTDs"),
    receptions: statNumber(line, "receptions"),
    receivingTargets: statNumber(line, "receivingTargets"),
    receivingYards: statNumber(line, "receivingYards"),
    receivingTDs: statNumber(line, "receivingTouchdowns", "receivingTDs"),
    fumblesLost: statNumber(line, "fumblesLost", "lostFumbles"),
    fieldGoalsMade: statNumber(line, "fieldGoalsMade"),
    fieldGoalsAttempted: statNumber(line, "fieldGoalsAttempted"),
    extraPointsMade: statNumber(line, "extraPointsMade"),
    extraPointsAttempted: statNumber(line, "extraPointsAttempted"),
    fieldGoalDistances: line.fieldGoalDistances,
  };
}

export async function syncNFLStats(
  now = new Date(),
  options: NflStatsSyncOptions = {},
): Promise<NflStatsSyncResult> {
  const result: NflStatsSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    gamesProcessed: 0,
    playersRecovered: 0,
    finalReconciliations: 0,
    boxscoreLinesParsed: 0,
    identityResolved: 0,
    identityUnresolved: 0,
    boxscoresWritten: 0,
    errorCount: 0,
    errors: [],
  };

  try {
    const identities = buildNflIdentityMaps(await nflverse.getPlayers());
    const yesterday = new Date(now.getTime() - 86_400_000);
    const games = await espnNfl.getGames({
      dates: options.dates || `${formatDate(yesterday)}-${formatDate(now)}`,
      limit: 200,
    });
    result.requestCount++;

    for (const game of games) {
      const gameId = `nfl_${game.espnId}`;
      try {
        const existingGame = await storage.getDailyGameByGameId(gameId);
        const gameData = {
          gameId,
          sport: "NFL",
          date: game.startsAt,
          week: game.week,
          season: game.season,
          seasonType: game.seasonType,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          venue: game.venue,
          status:
            existingGame?.status === "completed" && game.status !== "completed"
              ? existingGame.status
              : game.status,
          startTime: game.startsAt,
          homeScore: game.homeScore == null ? null : Math.trunc(game.homeScore),
          awayScore: game.awayScore == null ? null : Math.trunc(game.awayScore),
        };
        if (existingGame) await storage.updateDailyGame(existingGame.id, gameData);
        else await storage.createDailyGame(gameData);

        if (game.status !== "inprogress" && game.status !== "completed") continue;
        if (game.status === "completed" && !options.forceFinal) {
          const existingBoxscore = await getGameBoxscore(gameId);
          if (existingBoxscore?.reconciliationStatus === "complete") continue;
        }

        const summary = await espnNfl.getSummary(game.espnId);
        result.requestCount++;
        const lines = extractEspnPlayerStats(summary);
        result.boxscoreLinesParsed += lines.length;
        if (lines.length === 0) {
          throw new Error("ESPN summary returned no eligible NFL player statistics");
        }

        const gameplayEligible = isNflGameplayEligibleSeasonType(game.seasonType);
        const displayPlayers: ReturnType<typeof toDisplayPlayer>[] = [];
        const resolved: Array<{ line: EspnNflPlayerStatLine; player: any; identity: any }> = [];
        for (const line of lines) {
          const { player, identity } = await resolveExistingPlayer(line, identities);
          displayPlayers.push(toDisplayPlayer(line, player, identity));
          if (player) {
            resolved.push({ line, player, identity });
            result.identityResolved++;
          } else {
            result.identityUnresolved++;
          }
        }

        const homePlayers = displayPlayers.filter((player) => player.team === game.homeTeam);
        const awayPlayers = displayPlayers.filter((player) => player.team === game.awayTeam);
        const boxscorePayload = {
          gameId,
          sport: "NFL",
          provider: "espn-nfl",
          status: game.status,
          season: game.season,
          seasonType: game.seasonType,
          week: game.week,
          gameplayEligible,
          homeTeam: game.homeTeam,
          homeScore: game.homeScore ?? 0,
          awayTeam: game.awayTeam,
          awayScore: game.awayScore ?? 0,
          homePlayers,
          awayPlayers,
          homeTopPerformers: [],
          awayTopPerformers: [],
          fetchedAt: now.toISOString(),
        };
        await upsertGameBoxscore({
          gameId,
          sport: "NFL",
          provider: "espn-nfl",
          payload: boxscorePayload,
          reconciliationStatus: game.status === "completed" ? "complete" : "live",
          isFinal: game.status === "completed",
          sourceFetchedAt: now,
        });
        result.boxscoresWritten++;

        for (const { line, player, identity } of resolved) {
          const stat = line.stats;
          const fantasyInput = {
            passingYards: espnStatNumber(stat, "passingYards"),
            passingTouchdowns: espnStatNumber(stat, "passingTouchdowns", "passingTDs"),
            interceptions: espnStatNumber(stat, "interceptions"),
            rushingYards: espnStatNumber(stat, "rushingYards"),
            rushingTouchdowns: espnStatNumber(stat, "rushingTouchdowns", "rushingTDs"),
            receptions: espnStatNumber(stat, "receptions"),
            receivingYards: espnStatNumber(stat, "receivingYards"),
            receivingTouchdowns: espnStatNumber(stat, "receivingTouchdowns", "receivingTDs"),
            fumblesLost: espnStatNumber(stat, "fumblesLost", "lostFumbles"),
            extraPointsMade: espnStatNumber(stat, "extraPointsMade"),
            fieldGoalsMade: espnStatNumber(stat, "fieldGoalsMade"),
            fieldGoalDistances: line.fieldGoalDistances,
          };
          const fantasyPoints = gameplayEligible ? calculateNflFantasyPoints(fantasyInput) : 0;
          const team = String(line.team || player.team || identity?.team || "").toUpperCase();
          const isHome = team === game.homeTeam;
          const opponent = isHome ? game.awayTeam : game.homeTeam;
          const statsJson = {
            provider: "espn-nfl",
            espnId: line.espnId,
            position: line.position || player.position,
            seasonType: game.seasonType,
            gameplayEligible,
            ...fantasyInput,
            raw: stat,
            liveState: {
              status: game.status,
              quarter: game.period,
              clock: game.clock,
              homeScore: game.homeScore,
              awayScore: game.awayScore,
            },
          };

          await storage.upsertPlayerGameStats({
            playerId: player.id,
            gameId,
            sport: "NFL",
            gameDate: game.startsAt,
            week: game.week,
            season: String(game.season),
            opponentTeam: opponent,
            homeAway: isHome ? "home" : "away",
            statsJson,
            minutes: 0,
            points: 0,
            fieldGoalsMade: 0,
            fieldGoalsAttempted: 0,
            threePointersMade: 0,
            threePointersAttempted: 0,
            freeThrowsMade: 0,
            freeThrowsAttempted: 0,
            rebounds: 0,
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            isDoubleDouble: false,
            isTripleDouble: false,
            fantasyPoints: fantasyPoints.toFixed(2),
          });
          result.recordsProcessed++;
        }
        if (game.status === "completed") result.finalReconciliations++;
        result.gamesProcessed++;
      } catch (error: any) {
        result.errorCount++;
        result.errors.push(`${gameId}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    result.errorCount++;
    result.errors.push(error?.message || String(error));
  }

  return result;
}

export default syncNFLStats;
''')

# Date-range backfill command.
write("scripts/nfl-boxscore-backfill.ts", r'''import "dotenv/config";
import { pool } from "../server/db";
import { syncNFLStats } from "../server/jobs/sync-nfl-stats";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function compactDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  return value.replaceAll("-", "");
}

async function main() {
  const from = getArg("from");
  const to = getArg("to") || from;
  if (!from || !to) throw new Error("Usage: npm run nfl:backfill-boxscores -- --from=YYYY-MM-DD --to=YYYY-MM-DD");
  const dates = `${compactDate(from)}-${compactDate(to)}`;
  const result = await syncNFLStats(new Date(`${to}T23:59:59.000Z`), { dates, forceFinal: true });
  console.log(`[nfl_boxscore_backfill] ${JSON.stringify({ from, to, ...result })}`);
  if (result.errorCount > 0 || result.gamesProcessed === 0 || result.boxscoresWritten === 0) {
    throw new Error(`NFL box-score backfill verification failed: ${JSON.stringify(result)}`);
  }
}

main()
  .catch((error) => {
    console.error("[nfl_boxscore_backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
''')

# Package command.
pkg_path = ROOT / "package.json"
pkg = json.loads(pkg_path.read_text())
pkg["scripts"]["nfl:backfill-boxscores"] = "tsx scripts/nfl-boxscore-backfill.ts"
pkg_path.write_text(json.dumps(pkg, indent=2) + "\n")

# Add the persisted-only NFL branch to the public game stats route.
routes_path = "server/routes.ts"
routes = read(routes_path)
routes = replace_once(
    routes,
    'import { buildGameStatsPayload } from "./game-stats-response";',
    'import { buildGameStatsPayload } from "./game-stats-response";\nimport { getGameBoxscore } from "./game-boxscores";',
    "routes boxscore import",
)
route_start = routes.index('app.get("/api/games/:gameId/live-stats"')
mlb_branch = routes.index('      if (game.sport === "MLB") {', route_start)
nfl_branch = r'''      if (game.sport === "NFL") {
        // NFL public reads are persisted-only. The five-minute scheduled sync owns ESPN calls.
        const storedBoxscore = await getGameBoxscore<any>(game.gameId);
        if (storedBoxscore) {
          return res.json(storedBoxscore.payload);
        }
        return res.json({
          gameId: game.gameId,
          sport: "NFL",
          status: game.status,
          seasonType: game.seasonType,
          gameplayEligible: game.seasonType !== "preseason",
          homeTeam: game.homeTeam,
          homeScore: game.homeScore ?? 0,
          awayTeam: game.awayTeam,
          awayScore: game.awayScore ?? 0,
          homePlayers: [],
          awayPlayers: [],
          homeTopPerformers: [],
          awayTopPerformers: [],
          message: "NFL box score is not available yet",
        });
      } else '''
routes = routes[:mlb_branch] + nfl_branch + routes[mlb_branch:]
write(routes_path, routes)

# Replace NFL modal types and table. Keep unresolved provider athletes visible but non-clickable.
modal_path = "client/src/components/game-stats-modal.tsx"
modal = read(modal_path)
type_start = modal.index("export interface NFLPlayerStats")
type_end = modal.index("export interface MLBPlayerStats", type_start)
modal = modal[:type_start] + r'''export interface NFLPlayerStats {
  id: string;
  espnId: string;
  playerId?: string | null;
  name: string;
  position: string;
  passingCompletions?: number;
  passingAttempts?: number;
  passingYards?: number;
  passingTDs?: number;
  interceptions?: number;
  rushingAttempts?: number;
  rushingYards?: number;
  rushingTDs?: number;
  receptions?: number;
  receivingTargets?: number;
  receivingYards?: number;
  receivingTDs?: number;
  fieldGoalsMade?: number;
  fieldGoalsAttempted?: number;
  extraPointsMade?: number;
  extraPointsAttempted?: number;
}

export interface NFLLiveStats {
  gameId: string;
  sport: "NFL";
  status: string;
  seasonType?: string;
  gameplayEligible: boolean;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  homePlayers: NFLPlayerStats[];
  awayPlayers: NFLPlayerStats[];
  homeTopPerformers: never[];
  awayTopPerformers: never[];
  message?: string;
}

''' + modal[type_end:]
func_start = modal.index("function NFLStatsTable")
func_end = modal.index("// MLB Stats Table", func_start)
new_table = r'''function NFLStatsTable({ liveStats }: { liveStats: NFLLiveStats }) {
  const PlayerName = ({ player }: { player: NFLPlayerStats }) =>
    player.playerId ? (
      <ModalPlayerName playerId={player.playerId} name={player.name} />
    ) : (
      <span className="truncate" title="Provider player not yet admitted to Sportfolio">
        {player.name}
      </span>
    );

  const PlayerTable = ({ players, teamName }: { players: NFLPlayerStats[]; teamName: string }) => (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground mb-1">{teamName}</h4>
      <div className="overflow-x-auto rounded-sm border">
        <div className="grid min-w-[620px] grid-cols-[2fr_1.2fr_.8fr_1.2fr_1.4fr_1fr_1fr] gap-1 px-2 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground">
          <div>PLAYER</div>
          <div className="text-center">PASS</div>
          <div className="text-center">TD/INT</div>
          <div className="text-center">RUSH</div>
          <div className="text-center">REC</div>
          <div className="text-center">FG</div>
          <div className="text-center">XP</div>
        </div>
        {players.map((player) => (
          <div
            key={`${player.espnId}-${player.position}`}
            className="grid min-w-[620px] grid-cols-[2fr_1.2fr_.8fr_1.2fr_1.4fr_1fr_1fr] gap-1 px-2 py-1.5 border-t text-xs hover:bg-muted/30"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[9px] bg-secondary px-1 rounded min-w-6 text-center flex-shrink-0">
                {player.position || "-"}
              </span>
              <PlayerName player={player} />
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.passingAttempts
                ? `${player.passingCompletions || 0}/${player.passingAttempts} ${player.passingYards || 0}`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.passingAttempts ? `${player.passingTDs || 0}/${player.interceptions || 0}` : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.rushingAttempts
                ? `${player.rushingAttempts}-${player.rushingYards || 0} ${player.rushingTDs || 0}TD`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.receptions || player.receivingTargets
                ? `${player.receptions || 0}/${player.receivingTargets || 0}-${player.receivingYards || 0} ${player.receivingTDs || 0}TD`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.fieldGoalsAttempted
                ? `${player.fieldGoalsMade || 0}/${player.fieldGoalsAttempted}`
                : "-"}
            </div>
            <div className="text-center font-mono text-[10px]">
              {player.extraPointsAttempted
                ? `${player.extraPointsMade || 0}/${player.extraPointsAttempted}`
                : "-"}
            </div>
          </div>
        ))}
        {players.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No player stats available.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {liveStats.seasonType === "preseason" && (
        <div className="rounded-sm border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Preseason statistics are informational and do not earn Sportfolio fantasy points.
        </div>
      )}
      <PlayerTable players={liveStats.awayPlayers} teamName={liveStats.awayTeam} />
      <PlayerTable players={liveStats.homePlayers} teamName={liveStats.homeTeam} />
    </div>
  );
}

'''
modal = modal[:func_start] + new_table + modal[func_end:]
write(modal_path, modal)

# Expand parser regression tests with Hall-of-Fame-game-like missing-position rows.
test_path = "server/nfl/espn-client.test.ts"
test = read(test_path)
insert_at = test.rfind("});")
extra = r'''

  it("keeps preseason offensive box-score rows when ESPN omits athlete position", () => {
    const rows = extractEspnPlayerStats({
      boxscore: {
        players: [
          {
            team: { abbreviation: "CAR" },
            statistics: [
              {
                name: "passing",
                names: ["C/ATT", "YDS", "TD", "INT"],
                athletes: [
                  { athlete: { id: "101", displayName: "Preseason QB" }, stats: ["12/18", "141", "1", "0"] },
                ],
              },
              {
                name: "rushing",
                names: ["CAR", "YDS", "TD"],
                athletes: [
                  { athlete: { id: "102", displayName: "Preseason Runner" }, stats: ["7", "44", "1"] },
                ],
              },
              {
                name: "receiving",
                names: ["REC", "TGTS", "YDS", "TD"],
                athletes: [
                  { athlete: { id: "103", displayName: "Preseason Receiver" }, stats: ["4", "6", "65", "1"] },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ espnId: "101", position: "QB" });
    expect(rows[0].stats).toMatchObject({
      passingcompletions: 12,
      passingattempts: 18,
      passingyards: 141,
      passingtouchdowns: 1,
    });
    expect(rows[1].stats).toMatchObject({ rushingattempts: 7, rushingyards: 44 });
    expect(rows[2].stats).toMatchObject({ receptions: 4, receivingtargets: 6, receivingyards: 65 });
  });

  it("preserves made and attempted kicking values", () => {
    const [row] = extractEspnPlayerStats({
      boxscore: {
        players: [{
          team: { abbreviation: "ARI" },
          statistics: [{
            name: "kicking",
            names: ["FG", "XP"],
            athletes: [{ athlete: { id: "9", displayName: "Kicker" }, stats: ["2/3", "3/3"] }],
          }],
        }],
      },
    });
    expect(row.position).toBe("K");
    expect(row.stats).toMatchObject({
      fieldgoalsmade: 2,
      fieldgoalsattempted: 3,
      extrapointsmade: 3,
      extrapointsattempted: 3,
    });
  });
'''
test = test[:insert_at] + extra + test[insert_at:]
write(test_path, test)

# Documentation for operational semantics.
write("docs/NFL_BOXSCORE_PIPELINE.md", r'''# NFL box-score pipeline

- ESPN scoreboard/summary is fetched only by scheduled/operational ingestion, never by the public game-stats route.
- The normalized game-level box score is persisted in `game_boxscores` so provider athletes can display without being Sportfolio assets.
- A box-score row only projects into `player_game_stats` when it resolves to an already-admitted NFL player. Statistics ingestion does not create assets.
- Preseason rows use `gameplayEligible=false` and persist `fantasyPoints=0.00`; raw football statistics remain visible.
- Completed games are reconciled at the game-box-score level. `npm run nfl:backfill-boxscores -- --from=YYYY-MM-DD --to=YYYY-MM-DD` force-refreshes a bounded date range idempotently.
- Live polling cadence remains five minutes.
''')

print("NFL box-score deterministic patch applied")
