import { storage } from "../storage";
import { getGameBoxscore, upsertGameBoxscore } from "../game-boxscores";
import {
  espnNfl,
  espnStatNumber,
  extractEspnPlayerStats,
  type EspnNflPlayerStatLine,
} from "../nfl/espn-client";
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

async function resolveExistingPlayer(
  line: EspnNflPlayerStatLine,
  identities: ReturnType<typeof buildNflIdentityMaps>,
) {
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
