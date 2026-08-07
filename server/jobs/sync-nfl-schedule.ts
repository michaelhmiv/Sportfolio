import { storage } from "../storage";
import { espnNfl, type EspnNflGame } from "../nfl/espn-client";
import { getNflSeasonYear, type NflSeasonType } from "../nfl/season";
import { normalizeNflTeamAbbreviation } from "../nfl/identity";

export interface NflScheduleSyncResult {
  requestCount: number;
  gamesProcessed: number;
  gamesAdded: number;
  gamesUpdated: number;
  errors: string[];
}

const formatDate = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

async function loadFullSeason(
  season: number,
  result: NflScheduleSyncResult,
): Promise<EspnNflGame[]> {
  const games = new Map<string, EspnNflGame>();
  const weekCounts: Record<NflSeasonType, number> = { preseason: 5, regular: 18, postseason: 6 };
  const calendarYears = [season, season + 1];

  for (const seasonType of ["preseason", "regular", "postseason"] as const) {
    let seasonTypeGames = 0;

    // ESPN's dates=YYYY filter is a calendar-year filter, not an NFL-season filter.
    // Every NFL season crosses into the following January/February, so query both
    // calendar years and retain only events whose ESPN season metadata matches.
    for (const calendarYear of calendarYears) {
      try {
        const values = await espnNfl.getGames({
          dates: String(calendarYear),
          seasonType,
          limit: 1000,
        });
        result.requestCount++;
        for (const game of values) {
          if (game.season !== season || game.seasonType !== seasonType) continue;
          if (!games.has(game.espnId)) seasonTypeGames++;
          games.set(game.espnId, game);
        }
      } catch (error: any) {
        result.errors.push(
          `${season} ${seasonType} calendar ${calendarYear}: ${error?.message || error}`,
        );
      }
    }

    if (seasonTypeGames > 0) continue;

    // Fallback for provider shape/regression changes. Keep both calendar years here
    // too so Week 18 and postseason cannot silently disappear again.
    for (let week = 1; week <= weekCounts[seasonType]; week++) {
      for (const calendarYear of calendarYears) {
        try {
          const values = await espnNfl.getGames({
            dates: String(calendarYear),
            seasonType,
            week,
            limit: 100,
          });
          result.requestCount++;
          for (const game of values) {
            if (game.season === season && game.seasonType === seasonType) {
              games.set(game.espnId, game);
            }
          }
        } catch (error: any) {
          result.errors.push(
            `${season} ${seasonType} week ${week} calendar ${calendarYear}: ${error?.message || error}`,
          );
        }
      }
    }
  }
  return [...games.values()];
}

async function persistGame(game: EspnNflGame, result: NflScheduleSyncResult) {
  const gameId = `nfl_${game.espnId}`;
  const data = {
    gameId,
    sport: "NFL",
    date: game.startsAt,
    week: game.week,
    season: game.season,
    seasonType: game.seasonType,
    homeTeam: normalizeNflTeamAbbreviation(game.homeTeam),
    awayTeam: normalizeNflTeamAbbreviation(game.awayTeam),
    venue: game.venue,
    status: game.status,
    startTime: game.startsAt,
    homeScore: game.homeScore == null ? null : Math.trunc(game.homeScore),
    awayScore: game.awayScore == null ? null : Math.trunc(game.awayScore),
  };
  const existing = await storage.getDailyGameByGameId(gameId);
  if (existing) {
    const status =
      existing.status === "completed" && data.status !== "completed"
        ? existing.status
        : data.status;
    await storage.updateDailyGame(existing.id, { ...data, status });
    result.gamesUpdated++;
  } else {
    await storage.createDailyGame(data);
    result.gamesAdded++;
  }
  result.gamesProcessed++;
}

export async function syncNFLSchedule(
  options: {
    season?: number;
    fullSeason?: boolean;
    now?: Date;
  } = {},
): Promise<NflScheduleSyncResult> {
  const result: NflScheduleSyncResult = {
    requestCount: 0,
    gamesProcessed: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    errors: [],
  };
  try {
    const now = options.now || new Date();
    const season = options.season ?? getNflSeasonYear(now);
    let games: EspnNflGame[];
    if (options.fullSeason) {
      games = await loadFullSeason(season, result);
    } else {
      const from = new Date(now.getTime() - 3 * 86_400_000);
      const to = new Date(now.getTime() + 21 * 86_400_000);
      games = await espnNfl.getGames({
        dates: `${formatDate(from)}-${formatDate(to)}`,
        limit: 200,
      });
      result.requestCount++;
    }
    for (const game of games) {
      if (options.fullSeason && game.season !== season) continue;
      try {
        await persistGame(game, result);
      } catch (error: any) {
        result.errors.push(`game ${game.espnId}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    result.errors.push(error?.message || String(error));
  }
  return result;
}

export default syncNFLSchedule;
