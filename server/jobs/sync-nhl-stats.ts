import { storage } from "../storage";
import { calculateNhlFantasyPoints } from "../nhl-fantasy-scoring";
import {
  createNhlPlayerId,
  formatNhlGameDay,
  nhlApi,
  normalizeNhlGame,
  selectNhlSeason,
  type NhlBoxscorePlayer,
} from "../nhl-api";

export interface NhlStatsSyncResult {
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  skippedMissingPlayers: number;
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

export async function syncNhlStats(now = new Date()): Promise<NhlStatsSyncResult> {
  const result: NhlStatsSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
    skippedMissingPlayers: 0,
  };
  const today = formatNhlGameDay(now);
  const score = await nhlApi.getScore(today);
  result.requestCount++;
  let season = String(now.getUTCFullYear());
  try {
    season = selectNhlSeason(await nhlApi.getSeasons(), now);
    result.requestCount++;
  } catch (error: any) {
    console.warn(
      `[nhl_stats_sync] season metadata unavailable; stats skipped safely: ${error?.message || error}`,
    );
    return { ...result, errorCount: result.errorCount + 1 };
  }
  for (const scoreGame of score.games) {
    const id = `nhl_${scoreGame.id}`;
    try {
      const persisted = await storage.getDailyGameByGameId(id);
      if (persisted) {
        const normalized = normalizeNhlGame(scoreGame, persisted.status);
        await storage.updateDailyGame(persisted.id, { ...normalized, week: null });
      }
      const status = normalizeNhlGame(scoreGame, persisted?.status).status;
      if (status !== "inprogress" && status !== "completed") continue;
      const boxscore = await nhlApi.getBoxscore(gameNumber(id));
      result.requestCount++;
      for (const side of ["home", "away"] as const) {
        const opponent =
          side === "home" ? scoreGame.awayTeam?.abbrev || "" : scoreGame.homeTeam?.abbrev || "";
        for (const player of teamPlayers(boxscore, side)) {
          if (!Number.isSafeInteger(player.playerId)) continue;
          const playerId = createNhlPlayerId(player.playerId);
          const existing = await storage.getPlayersByIds([playerId]);
          if (!existing.length) {
            result.skippedMissingPlayers++;
            console.warn(
              `[nhl_stats_sync] missing roster player ${playerId}; stat retained for next roster reconciliation`,
            );
            continue;
          }
          const goalie = isGoalie(player);
          const scoring = goalie
            ? calculateNhlFantasyPoints({
                kind: "goalie",
                decision: player.decision,
                saves: player.saves,
                goalsAgainst: player.goalsAgainst,
                shutout:
                  status === "completed" &&
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
          // Short-handed and shootout bonuses require PBP enrichment. Never guess them from boxscore aggregates.
          const statsJson = goalie
            ? {
                position: "G",
                saves: safe(player.saves),
                shotsAgainst: safe(player.shotsAgainst),
                goalsAgainst: safe(player.goalsAgainst),
                savePercentage: safe(player.savePctg),
                timeOnIce: player.toi || null,
                starter: player.starter === true,
                decision: player.decision || null,
                scoringEnrichment: {
                  shortHandedPoints: null,
                  shootoutGoals: null,
                  status: "not_attempted",
                },
              }
            : {
                position: player.position || null,
                goals: safe(player.goals),
                assists: safe(player.assists),
                points: safe(player.points),
                plusMinus: safe(player.plusMinus),
                penaltyMinutes: safe(player.pim),
                hits: safe(player.hits),
                powerPlayGoals: safe(player.powerPlayGoals),
                shotsOnGoal: safe(player.sog),
                faceoffWinningPercentage: safe(player.faceoffWinningPctg),
                timeOnIce: player.toi || null,
                blockedShots: safe(player.blockedShots),
                shifts: safe(player.shifts),
                giveaways: safe(player.giveaways),
                takeaways: safe(player.takeaways),
                scoringEnrichment: {
                  shortHandedPoints: null,
                  shootoutGoals: null,
                  status: "not_attempted",
                },
              };
          await storage.upsertPlayerGameStats({
            playerId,
            gameId: id,
            sport: "NHL",
            gameDate: new Date(scoreGame.startTimeUTC || now),
            week: null,
            season,
            opponentTeam: String(opponent).toUpperCase(),
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
