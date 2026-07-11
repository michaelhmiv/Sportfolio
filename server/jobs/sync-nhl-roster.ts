import { storage } from "../storage";
import { createNhlPlayerId, nhlApi, selectNhlSeason, type NhlRosterPlayer } from "../nhl-api";

export interface NhlRosterSyncResult {
  success: boolean;
  playersProcessed: number;
  playersAdded: number;
  playersUpdated: number;
  playersDeactivated: number;
  requestCount: number;
  successfulTeams: number;
  errors: string[];
}

type AuthoritativePlayer = { player: NhlRosterPlayer; team: string };
const namePart = (value: NhlRosterPlayer["firstName"], fallback: string) =>
  String(value?.default || fallback).trim() || fallback;
const position = (value?: string) =>
  ({ C: "C", L: "LW", R: "RW", D: "D", G: "G" })[String(value || "").toUpperCase()] || "UTIL";
const validRoster = (roster: { forwards: NhlRosterPlayer[]; defensemen: NhlRosterPlayer[]; goalies: NhlRosterPlayer[] }) => {
  const players = [...roster.forwards, ...roster.defensemen, ...roster.goalies];
  if (!players.length) return null;
  const valid = players.filter((player) => Number.isSafeInteger(player.id) && Number(player.id) > 0);
  // A non-empty response with no usable provider identities is not authoritative.
  return valid.length ? valid : null;
};

/**
 * Reconciles rosters in two phases. A team is authoritative only after its complete,
 * non-empty roster validates; failed responses retain last-known-good players. This
 * deliberately avoids order-dependent transfer deactivation.
 */
export async function syncNhlRoster(): Promise<NhlRosterSyncResult> {
  const result: NhlRosterSyncResult = {
    success: false, playersProcessed: 0, playersAdded: 0, playersUpdated: 0,
    playersDeactivated: 0, requestCount: 0, successfulTeams: 0, errors: [],
  };
  try {
    const seasons = await nhlApi.getSeasons();
    result.requestCount++;
    const season = selectNhlSeason(seasons);
    const { standings } = await nhlApi.getStandings();
    result.requestCount++;
    const teams = [...new Set(standings.map((team) => String(team.abbrev || "").trim().toUpperCase()).filter(Boolean))];
    const existing = await storage.getPlayersBySport("NHL");
    const existingIds = new Set(existing.map((player) => player.id));
    const successfulTeams = new Set<string>();
    const authoritativePlayers = new Map<string, AuthoritativePlayer>();

    // Phase 1: fetch and validate every team before altering any activity state.
    await Promise.all(teams.map(async (team) => {
      try {
        const roster = await nhlApi.getRoster(team, season);
        result.requestCount++;
        const players = validRoster(roster);
        if (!players) throw new Error("empty or malformed roster; refusing deactivation");
        successfulTeams.add(team);
        for (const player of players) {
          const id = createNhlPlayerId(player.id);
          const current = authoritativePlayers.get(id);
          // A duplicate cannot make destructive reconciliation unsafe. Keep first deterministic team.
          if (!current) authoritativePlayers.set(id, { player, team });
          else if (current.team !== team) result.errors.push(`${id}: appears on ${current.team} and ${team}; retained active`);
        }
      } catch (error: any) {
        const message = `${team}: ${error?.message || error}`;
        result.errors.push(message);
        console.warn(`[nhl_roster_sync] ${message}; existing players retained`);
      }
    }));
    result.successfulTeams = successfulTeams.size;

    // Phase 2a: write every successfully observed player before considering deactivation.
    for (const [id, { player, team }] of authoritativePlayers) {
      const data = {
        id, sport: "NHL", firstName: namePart(player.firstName, "Unknown"),
        lastName: namePart(player.lastName, "Player"), team, position: position(player.positionCode),
        jerseyNumber: player.sweaterNumber == null ? null : String(player.sweaterNumber),
        isActive: true, isEligibleForVesting: true,
      };
      await storage.upsertPlayer(data);
      result.playersProcessed++;
      if (existingIds.has(id)) result.playersUpdated++;
      else { existingIds.add(id); result.playersAdded++; }
    }

    // Phase 2b: only a successful former team may deactivate a player absent from all successful rosters.
    for (const player of existing) {
      const previousTeam = String(player.team || "").toUpperCase();
      if (!player.isActive || !successfulTeams.has(previousTeam) || authoritativePlayers.has(player.id)) continue;
      await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });
      result.playersDeactivated++;
    }
    result.success = result.errors.length === 0;
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error?.message || error}`);
  }
  return result;
}
export default syncNhlRoster;
