import { storage } from "../storage";
import { createNhlPlayerId, nhlApi, selectNhlSeason, type NhlRosterPlayer } from "../nhl-api";

export interface NhlRosterSyncResult {
  success: boolean;
  playersProcessed: number;
  playersAdded: number;
  playersUpdated: number;
  playersDeactivated: number;
  requestCount: number;
  errors: string[];
}
const namePart = (value: NhlRosterPlayer["firstName"], fallback: string) =>
  String(value?.default || fallback).trim() || fallback;
const position = (value?: string) =>
  ({ C: "C", L: "LW", R: "RW", D: "D", G: "G" })[String(value || "").toUpperCase()] || "UTIL";

/** One validated team roster is authoritative only for that team's NHL players. Partial API failures never cause deletion. */
export async function syncNhlRoster(): Promise<NhlRosterSyncResult> {
  const result: NhlRosterSyncResult = {
    success: false,
    playersProcessed: 0,
    playersAdded: 0,
    playersUpdated: 0,
    playersDeactivated: 0,
    requestCount: 0,
    errors: [],
  };
  try {
    const seasons = await nhlApi.getSeasons();
    result.requestCount++;
    const season = selectNhlSeason(seasons);
    const { standings } = await nhlApi.getStandings();
    result.requestCount++;
    const teams = standings
      .filter((team) => team.abbrev)
      .reduce(
        (unique, team) => unique.set(team.abbrev, team),
        new Map<string, (typeof standings)[number]>(),
      );
    const existing = await storage.getPlayersBySport("NHL");
    const existingIds = new Set(existing.map((player) => player.id));
    for (const [teamCode] of teams) {
      try {
        const roster = await nhlApi.getRoster(teamCode, season);
        result.requestCount++;
        const verifiedRoster = [...roster.forwards, ...roster.defensemen, ...roster.goalies].filter(
          (player) => Number.isSafeInteger(player.id),
        );
        if (verifiedRoster.length === 0)
          throw new Error("validated roster was empty; refusing team deactivation");
        const activeIds = new Set<string>();
        for (const player of verifiedRoster) {
          const id = createNhlPlayerId(player.id);
          activeIds.add(id);
          result.playersProcessed++;
          const data = {
            id,
            sport: "NHL",
            firstName: namePart(player.firstName, "Unknown"),
            lastName: namePart(player.lastName, "Player"),
            team: teamCode,
            position: position(player.positionCode),
            jerseyNumber: player.sweaterNumber == null ? null : String(player.sweaterNumber),
            isActive: true,
            isEligibleForVesting: true,
          };
          if (existingIds.has(id)) {
            await storage.updatePlayer(id, data);
            result.playersUpdated++;
          } else {
            await storage.upsertPlayer(data);
            existingIds.add(id);
            result.playersAdded++;
          }
        }
        // The table lacks a provider team-id field. Team abbreviation is the existing sport convention.
        for (const player of existing.filter(
          (entry) => entry.team === teamCode && entry.isActive && !activeIds.has(entry.id),
        )) {
          await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });
          result.playersDeactivated++;
        }
      } catch (error: any) {
        result.errors.push(`${teamCode}: ${error?.message || error}`);
        console.warn(
          `[nhl_roster_sync] ${teamCode} failed; existing players retained`,
          error?.message || error,
        );
      }
    }
    result.success = result.errors.length === 0;
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error?.message || error}`);
  }
  return result;
}
export default syncNhlRoster;
