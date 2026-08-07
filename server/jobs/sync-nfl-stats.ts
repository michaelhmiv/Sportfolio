import { storage } from "../storage";
import { espnNfl, espnStatNumber, extractEspnPlayerStats } from "../nfl/espn-client";
import { buildNflIdentityMaps, createNflPlayerId, splitNflDisplayName } from "../nfl/identity";
import { nflverse } from "../nfl/nflverse";
import { calculateNflFantasyPoints } from "../nfl/scoring";
import { isNflGameplayEligibleSeasonType } from "../nfl/season";

export interface NflStatsSyncResult {
  requestCount: number;
  recordsProcessed: number;
  gamesProcessed: number;
  playersRecovered: number;
  finalReconciliations: number;
  errorCount: number;
  errors: string[];
}

const formatDate = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

const finalReconciled = (rows: Array<{ statsJson?: any }>) =>
  rows.some((row) => row.statsJson?.finalReconciliation?.status === "complete");

export async function syncNFLStats(now = new Date()): Promise<NflStatsSyncResult> {
  const result: NflStatsSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    gamesProcessed: 0,
    playersRecovered: 0,
    finalReconciliations: 0,
    errorCount: 0,
    errors: [],
  };

  try {
    const identities = buildNflIdentityMaps(await nflverse.getPlayers());
    const yesterday = new Date(now.getTime() - 86_400_000);
    const games = await espnNfl.getGames({
      dates: `${formatDate(yesterday)}-${formatDate(now)}`,
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
        if (game.status === "completed") {
          const currentRows = await storage.getGameStatsByGameId(gameId);
          if (finalReconciled(currentRows)) continue;
        }

        const summary = await espnNfl.getSummary(game.espnId);
        result.requestCount++;
        const lines = extractEspnPlayerStats(summary);
        if (lines.length === 0) {
          throw new Error("ESPN summary returned no eligible NFL player statistics");
        }
        let written = 0;
        for (const line of lines) {
          const identity = identities.byEspnId.get(line.espnId);
          if (!identity?.gsisId) continue;
          const playerId = createNflPlayerId(identity.gsisId);
          let player = await storage.getPlayer(playerId);
          if (!player) {
            const { firstName, lastName } = splitNflDisplayName(line.displayName || identity.displayName);
            await storage.upsertPlayer({
              id: playerId,
              sport: "NFL",
              firstName,
              lastName,
              team: line.team || identity.team || "FA",
              position: line.position || identity.position || "UTIL",
              isActive: identity.active,
              isEligibleForVesting: identity.active,
            });
            player = await storage.getPlayer(playerId);
            result.playersRecovered++;
          }

          const stat = line.stats;
          const fantasyInput = {
            passingYards: espnStatNumber(stat, "passingYards", "yards"),
            passingTouchdowns: espnStatNumber(stat, "passingTouchdowns", "passingTDs", "touchdowns"),
            interceptions: espnStatNumber(stat, "interceptions"),
            rushingYards: espnStatNumber(stat, "rushingYards"),
            rushingTouchdowns: espnStatNumber(stat, "rushingTouchdowns", "rushingTDs"),
            receptions: espnStatNumber(stat, "receptions"),
            receivingYards: espnStatNumber(stat, "receivingYards"),
            receivingTouchdowns: espnStatNumber(stat, "receivingTouchdowns", "receivingTDs"),
            fumblesLost: espnStatNumber(stat, "fumblesLost", "lostFumbles"),
            extraPointsMade: espnStatNumber(stat, "extraPointsMade", "extraPointMade"),
            fieldGoalsMade: espnStatNumber(stat, "fieldGoalsMade", "fieldGoalMade"),
            fieldGoalDistances: line.fieldGoalDistances,
          };
          const fantasyPoints = calculateNflFantasyPoints(fantasyInput);
          const team = (line.team || player?.team || identity.team || "FA").toUpperCase();
          const isHome = team === game.homeTeam;
          const opponent = isHome ? game.awayTeam : game.homeTeam;
          const isLastWrittenCandidate = written === lines.length - 1;
          const statsJson = {
            provider: "espn-nfl",
            espnId: line.espnId,
            position: line.position,
            seasonType: game.seasonType,
            gameplayEligible: isNflGameplayEligibleSeasonType(game.seasonType),
            ...fantasyInput,
            raw: stat,
            liveState: {
              status: game.status,
              quarter: game.period,
              clock: game.clock,
              homeScore: game.homeScore,
              awayScore: game.awayScore,
            },
            ...(game.status === "completed" && isLastWrittenCandidate
              ? {
                  finalReconciliation: {
                    status: "complete",
                    completedAt: now.toISOString(),
                  },
                }
              : {}),
          };

          await storage.upsertPlayerGameStats({
            playerId,
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
          written++;
          result.recordsProcessed++;
        }
        if (game.status === "completed" && written > 0) result.finalReconciliations++;
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
