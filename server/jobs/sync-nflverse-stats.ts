import { storage } from "../storage";
import { NFL_ELIGIBLE_POSITIONS } from "../nfl/espn-client";
import {
  buildNflIdentityMaps,
  createNflEspnAlias,
  createNflPlayerId,
  splitNflDisplayName,
  normalizeNflTeamAbbreviation,
} from "../nfl/identity";
import {
  nflverse,
  nflverseNumber,
  nflverseSeasonType,
  nflverseWeek,
  type NflverseWeeklyStat,
} from "../nfl/nflverse";
import { calculateNflFantasyPoints } from "../nfl/scoring";
import { isNflGameplayEligibleSeasonType } from "../nfl/season";

export interface NflverseStatsSyncResult {
  requestCount: number;
  recordsProcessed: number;
  playersRecovered: number;
  gamesMissing: number;
  errorCount: number;
  errors: string[];
}

function gameLookupKey(input: {
  season: number;
  seasonType: string;
  week: number;
  team: string;
  opponent: string;
}) {
  return [
    input.season,
    input.seasonType,
    input.week,
    input.team.toUpperCase(),
    input.opponent.toUpperCase(),
  ].join("|");
}

function buildGameLookup(games: any[]) {
  const lookup = new Map<string, any>();
  for (const game of games) {
    const season = Number(game.season);
    const week = Number(game.week);
    if (!Number.isFinite(season) || !Number.isFinite(week) || !game.seasonType) continue;
    lookup.set(
      gameLookupKey({
        season,
        seasonType: String(game.seasonType),
        week,
        team: game.homeTeam,
        opponent: game.awayTeam,
      }),
      game,
    );
    lookup.set(
      gameLookupKey({
        season,
        seasonType: String(game.seasonType),
        week,
        team: game.awayTeam,
        opponent: game.homeTeam,
      }),
      game,
    );
  }
  return lookup;
}

function historicalFantasyInput(row: NflverseWeeklyStat) {
  return {
    passingYards: nflverseNumber(row, "passing_yards"),
    passingTouchdowns: nflverseNumber(row, "passing_tds"),
    interceptions: nflverseNumber(row, "interceptions"),
    rushingYards: nflverseNumber(row, "rushing_yards"),
    rushingTouchdowns: nflverseNumber(row, "rushing_tds"),
    receptions: nflverseNumber(row, "receptions"),
    receivingYards: nflverseNumber(row, "receiving_yards"),
    receivingTouchdowns: nflverseNumber(row, "receiving_tds"),
    fumblesLost:
      nflverseNumber(row, "fumbles_lost") ||
      nflverseNumber(row, "sack_fumbles_lost") +
        nflverseNumber(row, "rushing_fumbles_lost") +
        nflverseNumber(row, "receiving_fumbles_lost"),
    extraPointsMade: nflverseNumber(row, "extra_points_made", "pat_made"),
    fieldGoalsMade: nflverseNumber(row, "field_goals_made", "fg_made"),
    fieldGoalDistances: [] as number[],
  };
}

export async function syncNflverseStats(
  options: {
    years?: number[];
    now?: Date;
  } = {},
): Promise<NflverseStatsSyncResult> {
  const now = options.now || new Date();
  const years = [
    ...new Set(options.years || [now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1]),
  ]
    .filter((year) => Number.isInteger(year) && year >= 2024 && year <= now.getFullYear())
    .sort();
  const result: NflverseStatsSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    playersRecovered: 0,
    gamesMissing: 0,
    errorCount: 0,
    errors: [],
  };

  try {
    const identityPlayers = await nflverse.getPlayers();
    result.requestCount++;
    const identities = buildNflIdentityMaps(identityPlayers);
    for (const year of years) {
      try {
        const rows = await nflverse.getWeeklyStats(year);
        result.requestCount++;
        const games = await storage.getDailyGamesBySport(
          "NFL",
          new Date(`${year}-07-01T00:00:00Z`),
          new Date(`${year + 1}-03-15T23:59:59Z`),
        );
        const gamesByKey = buildGameLookup(games);

        for (const row of rows) {
          try {
            const seasonType = nflverseSeasonType(row);
            if (seasonType === "preseason") continue;
            const week = nflverseWeek(row);
            const gsisId = String(row.player_id || "").trim();
            const team = normalizeNflTeamAbbreviation(row.recent_team);
            const opponent = normalizeNflTeamAbbreviation(row.opponent_team);
            const identity = identities.byGsisId.get(gsisId);
            const position = String(row.position || identity?.position || "")
              .trim()
              .toUpperCase();
            if (!week || !gsisId || !team || !opponent || !NFL_ELIGIBLE_POSITIONS.has(position))
              continue;
            const game = gamesByKey.get(
              gameLookupKey({ season: year, seasonType, week, team, opponent }),
            );
            if (!game) {
              result.gamesMissing++;
              continue;
            }

            const playerId = createNflPlayerId(gsisId);
            let player = await storage.getPlayer(playerId);
            if (!player) {
              const { firstName, lastName } = splitNflDisplayName(
                identity?.displayName || row.player_display_name || row.player_name || gsisId,
              );
              await storage.upsertPlayer({
                id: playerId,
                sport: "NFL",
                firstName,
                lastName,
                team: identity?.team || team || "FA",
                position,
                isActive: identity?.active ?? false,
                isEligibleForVesting: identity?.active ?? false,
              });
              if (identity?.espnId) {
                await storage.upsertPlayerIdAlias({
                  aliasPlayerId: createNflEspnAlias(identity.espnId),
                  canonicalPlayerId: playerId,
                  sport: "NFL",
                  reason: "espn_gsis_crosswalk",
                });
              }
              player = await storage.getPlayer(playerId);
              result.playersRecovered++;
            }

            const fantasyInput = historicalFantasyInput(row);
            const fantasyPoints = calculateNflFantasyPoints(fantasyInput);
            const homeAway = game.homeTeam === team ? "home" : "away";
            await storage.upsertPlayerGameStats({
              playerId,
              gameId: game.gameId,
              sport: "NFL",
              gameDate: new Date(game.startTime),
              week,
              season: String(year),
              opponentTeam: opponent,
              homeAway,
              statsJson: {
                provider: "nflverse",
                position,
                seasonType,
                gameplayEligible: isNflGameplayEligibleSeasonType(seasonType),
                ...fantasyInput,
                advanced: {
                  passingEpa: nflverseNumber(row, "passing_epa"),
                  rushingEpa: nflverseNumber(row, "rushing_epa"),
                  receivingEpa: nflverseNumber(row, "receiving_epa"),
                  targetShare: nflverseNumber(row, "target_share"),
                  airYardsShare: nflverseNumber(row, "air_yards_share"),
                  wopr: nflverseNumber(row, "wopr"),
                },
                sourceFantasyPointsPpr: nflverseNumber(row, "fantasy_points_ppr"),
                finalReconciliation: {
                  status: "complete",
                  completedAt: now.toISOString(),
                },
              },
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
          } catch (error: any) {
            result.errorCount++;
            result.errors.push(`${year} row: ${error?.message || error}`);
          }
        }
      } catch (error: any) {
        result.errorCount++;
        result.errors.push(`${year}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    result.errorCount++;
    result.errors.push(error?.message || String(error));
  }

  return result;
}

export default syncNflverseStats;
