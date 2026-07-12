import { storage } from "../storage";
import { calculateNhlFantasyPoints } from "../nhl-fantasy-scoring";
import {
  createNhlPlayerId,
  formatNhlGameDay,
  nhlApi,
  normalizeNhlGame,
  selectNhlSeason,
  type NhlBoxscorePlayer,
  type NhlGame,
} from "../nhl-api";

export interface NhlStatsSyncResult {
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  playersRecovered: number;
  finalReconciliations: number;
}
const gameNumber = (id: string) => Number(id.replace(/^nhl_/, ""));
const isGoalie = (player: NhlBoxscorePlayer) => String(player.position || "").toUpperCase() === "G";
const teamPlayers = (boxscore: any, side: "home" | "away") => {
  const group = boxscore.playerByGameStats?.[`${side}Team`];
  return [
    ...(group?.forwards || []),
    ...(group?.defense || []),
    ...(group?.goalies || []),
  ] as NhlBoxscorePlayer[];
};
const safe = (value: unknown) => (Number.isFinite(value) ? Number(value) : null);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const gameKey = (game: NhlGame) => `nhl_${game.id}`;
const isUsableGame = (game: NhlGame) => Number.isSafeInteger(game.id) && Number(game.id) > 0;
const position = (value?: string) =>
  ({ C: "C", L: "LW", R: "RW", D: "D", G: "G" })[String(value || "").toUpperCase()] || "UTIL";
const playerName = (player: NhlBoxscorePlayer) =>
  String(player.name?.default || "Unknown Player").trim();
const hasCompletedFinalReconciliation = (rows: Array<{ statsJson?: any }>) => {
  const marker = rows.find((row) => row.statsJson?.finalReconciliation?.status === "complete")
    ?.statsJson?.finalReconciliation;
  return (
    Number.isSafeInteger(marker?.expectedPlayerCount) &&
    marker.expectedPlayerCount > 0 &&
    rows.length >= marker.expectedPlayerCount
  );
};

/**
 * Syncs yesterday + today score feeds and a bounded persisted lookback. This retains
 * cross-midnight games and retries recent finals until a final box score is written,
 * while never allowing a stale feed to regress completed status.
 */
export async function syncNhlStats(now = new Date()): Promise<NhlStatsSyncResult> {
  const result: NhlStatsSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
    playersRecovered: 0,
    finalReconciliations: 0,
  };
  let season: string;
  try {
    season = selectNhlSeason(await nhlApi.getSeasons(), now);
    result.requestCount++;
  } catch (error: any) {
    console.warn(
      `[nhl_stats_sync] season metadata unavailable; stats retained: ${error?.message || error}`,
    );
    return { ...result, errorCount: 1 };
  }

  const games = new Map<string, NhlGame>();
  try {
    const [yesterday, today, persisted] = await Promise.all([
      nhlApi.getScore(formatNhlGameDay(addDays(now, -1))),
      nhlApi.getScore(formatNhlGameDay(now)),
      storage.getDailyGamesBySport("NHL", addDays(now, -2), addDays(now, 1)),
    ]);
    result.requestCount += 2;
    for (const game of [...yesterday.games, ...today.games])
      if (isUsableGame(game)) games.set(gameKey(game), game);
    for (const row of persisted) {
      if (
        !row.gameId.startsWith("nhl_") ||
        (row.status !== "inprogress" && row.status !== "completed")
      )
        continue;
      const id = Number(row.gameId.slice(4));
      if (!Number.isSafeInteger(id) || games.has(row.gameId)) continue;
      games.set(row.gameId, {
        id,
        gameState: row.status === "completed" ? "OFF" : "LIVE",
        startTimeUTC: new Date(row.startTime).toISOString(),
        homeTeam: { abbrev: row.homeTeam, score: row.homeScore ?? undefined },
        awayTeam: { abbrev: row.awayTeam, score: row.awayScore ?? undefined },
      });
    }
  } catch (error: any) {
    console.warn(
      `[nhl_stats_sync] score feed unavailable; persisted data retained: ${error?.message || error}`,
    );
    return { ...result, errorCount: 1 };
  }

  for (const [id, scoreGame] of games) {
    try {
      const persisted = await storage.getDailyGameByGameId(id);
      const normalized = normalizeNhlGame(scoreGame, persisted?.status);
      if (persisted) await storage.updateDailyGame(persisted.id, { ...normalized, week: null });
      if (normalized.status !== "inprogress" && normalized.status !== "completed") continue;
      if (normalized.status === "completed") {
        const existingStats = await storage.getGameStatsByGameId(id);
        if (hasCompletedFinalReconciliation(existingStats)) continue;
      }
      const boxscore = await nhlApi.getBoxscore(gameNumber(id));
      result.requestCount++;
      const boxscorePlayers = (["home", "away"] as const)
        .flatMap((side) => teamPlayers(boxscore, side).map((player) => ({ player, side })))
        .filter(
          ({ player }) => Number.isSafeInteger(player.playerId) && Number(player.playerId) > 0,
        );
      const expectedPlayerCount = boxscorePlayers.length;
      if (!expectedPlayerCount) throw new Error("empty final box score; reconciliation deferred");
      const playerIds = boxscorePlayers.map(({ player }) => createNhlPlayerId(player.playerId));
      const knownPlayerIds = new Set(
        (await storage.getPlayersByIds(playerIds)).map((player) => player.id),
      );
      if (normalized.status === "completed") result.finalReconciliations++;
      let writtenPlayerCount = 0;
      for (const side of ["home", "away"] as const) {
        const team = side === "home" ? normalized.homeTeam : normalized.awayTeam;
        const opponent = side === "home" ? normalized.awayTeam : normalized.homeTeam;
        for (const player of teamPlayers(boxscore, side)) {
          if (!Number.isSafeInteger(player.playerId) || Number(player.playerId) <= 0) {
            result.errorCount++;
            continue;
          }
          const playerId = createNhlPlayerId(player.playerId);
          if (!knownPlayerIds.has(playerId)) {
            const [firstName = "Unknown", ...lastNameParts] = playerName(player).split(/\s+/);
            await storage.upsertPlayer({
              id: playerId,
              sport: "NHL",
              firstName,
              lastName: lastNameParts.join(" ") || "Player",
              team,
              position: position(player.position),
              jerseyNumber: player.sweaterNumber == null ? null : String(player.sweaterNumber),
              isActive: true,
              isEligibleForVesting: true,
            });
            knownPlayerIds.add(playerId);
            result.playersRecovered++;
          }
          const goalie = isGoalie(player);
          const scoring = goalie
            ? calculateNhlFantasyPoints({
                kind: "goalie",
                decision: player.decision,
                saves: player.saves,
                goalsAgainst: player.goalsAgainst,
                shutout:
                  normalized.status === "completed" &&
                  player.starter === true &&
                  safe(player.goalsAgainst) === 0,
              })
            : calculateNhlFantasyPoints({
                kind: "skater",
                goals: player.goals,
                assists: player.assists,
                shotsOnGoal: player.sog,
                blockedShots: player.blockedShots,
              });
          const statsJson = {
            position: goalie ? "G" : player.position || null,
            goals: safe(player.goals),
            assists: safe(player.assists),
            points: safe(player.points),
            plusMinus: safe(player.plusMinus),
            penaltyMinutes: safe(player.pim),
            hits: safe(player.hits),
            powerPlayGoals: safe(player.powerPlayGoals),
            shotsOnGoal: safe(player.sog),
            blockedShots: safe(player.blockedShots),
            timeOnIce: player.toi || null,
            saves: goalie ? safe(player.saves) : null,
            shotsAgainst: goalie ? safe(player.shotsAgainst) : null,
            goalsAgainst: goalie ? safe(player.goalsAgainst) : null,
            savePercentage: goalie ? safe(player.savePctg) : null,
            starter: goalie && player.starter === true,
            decision: goalie ? player.decision || null : null,
            liveState: {
              period: scoreGame.periodDescriptor?.number ?? null,
              periodType: scoreGame.periodDescriptor?.periodType ?? null,
              clock: scoreGame.clock?.timeRemaining ?? null,
              intermission: scoreGame.clock?.inIntermission === true,
              status: normalized.status,
            },
            scoringEnrichment: {
              model: "simplified-sportfolio-nhl",
              shortHandedPoints: null,
              shootoutGoals: null,
              status: "not_included",
            },
            ...(normalized.status === "completed" && writtenPlayerCount === expectedPlayerCount - 1
              ? {
                  finalReconciliation: {
                    status: "complete",
                    expectedPlayerCount,
                    completedAt: now.toISOString(),
                  },
                }
              : {}),
          };
          await storage.upsertPlayerGameStats({
            playerId,
            gameId: id,
            sport: "NHL",
            gameDate: new Date(scoreGame.startTimeUTC || now),
            week: null,
            season,
            opponentTeam: opponent,
            homeAway: side,
            statsJson,
            minutes: 0,
            points: goalie ? 0 : Number(player.points || 0),
            fieldGoalsMade: 0,
            fieldGoalsAttempted: 0,
            threePointersMade: 0,
            threePointersAttempted: 0,
            freeThrowsMade: 0,
            freeThrowsAttempted: 0,
            rebounds: 0,
            assists: goalie ? 0 : Number(player.assists || 0),
            steals: 0,
            blocks: goalie ? 0 : Number(player.blockedShots || 0),
            turnovers: 0,
            isDoubleDouble: false,
            isTripleDouble: false,
            fantasyPoints: String(scoring.points),
          });
          writtenPlayerCount++;
          result.recordsProcessed++;
        }
      }
    } catch (error: any) {
      result.errorCount++;
      console.warn(`[nhl_stats_sync] ${id} failed: ${error?.message || error}`);
    }
  }
  return result;
}
export default syncNhlStats;
