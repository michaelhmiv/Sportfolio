import { storage } from "../storage";
import { formatNhlGameDay, nhlApi, normalizeNhlGame } from "../nhl-api";

export interface NhlScheduleSyncResult {
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  gamesAdded: number;
  gamesUpdated: number;
}
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Reconciles late finals, today, and upcoming games. Empty official dates are normal offseason results. */
export async function syncNhlSchedule(now = new Date()): Promise<NhlScheduleSyncResult> {
  const result: NhlScheduleSyncResult = {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
  };
  const dates = Array.from(
    new Set([-1, 0, 1, 2, 3, 4, 5, 6, 7].map((offset) => formatNhlGameDay(addDays(now, offset)))),
  );
  const gamesById = new Map<number, unknown>();
  // Schedule responses overlap through gameWeek. Fetch first, then write each official ID once.
  for (const date of dates) {
    try {
      const schedule = await nhlApi.getSchedule(date);
      result.requestCount++;
      for (const game of schedule.gameWeek.flatMap((day) => day.games || [])) {
        if (Number.isSafeInteger(game.id) && !gamesById.has(game.id)) gamesById.set(game.id, game);
      }
    } catch (error: any) {
      result.errorCount++;
      console.warn(`[nhl_schedule_sync] ${date} failed: ${error?.message || error}`);
    }
  }
  for (const game of gamesById.values()) {
    try {
      const validGame = game as Parameters<typeof normalizeNhlGame>[0];
      const id = `nhl_${validGame.id}`;
      const existing = await storage.getDailyGameByGameId(id);
      const normalized = normalizeNhlGame(validGame, existing?.status);
      if (existing) {
        await storage.updateDailyGame(existing.id, { ...normalized, week: null });
        result.gamesUpdated++;
      } else {
        await storage.createDailyGame({ ...normalized, week: null });
        result.gamesAdded++;
      }
      result.recordsProcessed++;
    } catch (error: any) {
      result.errorCount++;
      console.warn(`[nhl_schedule_sync] ignoring malformed game: ${error?.message || error}`);
    }
  }
  return result;
}
export default syncNhlSchedule;
