/**
 * MLB Roster Sync Job
 *
 * Fetches active MLB players from the public MLB StatsAPI (no auth required)
 * and syncs to the database.
 *
 * Identity: Uses MLBAM IDs. Canonical ID format: mlb_<MLBAM_ID>
 */
import { storage } from "../storage";
import {
  fetchAllPlayers,
  fetchTeams,
  fetchTeamRoster,
  normalizePosition,
  createPlayerId,
  getCurrentSeason,
} from "../mlb-statsapi";

interface SyncResult {
  success: boolean;
  playersProcessed: number;
  playersAdded: number;
  playersUpdated: number;
  playersDeactivated: number;
  errors: string[];
}

export async function syncMLBRoster(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    playersProcessed: 0,
    playersAdded: 0,
    playersUpdated: 0,
    playersDeactivated: 0,
    errors: [],
  };

  console.log("[MLB Roster Sync] Starting roster synchronization via StatsAPI...");
  const startTime = Date.now();

  try {
    const season = getCurrentSeason();
    console.log(`[MLB Roster Sync] Fetching all MLB players for season ${season}...`);
    const apiPlayers = await fetchAllPlayers(season);
    console.log(`[MLB Roster Sync] Fetched ${apiPlayers.length} players from StatsAPI`);

    // Fetch team data so we can map team IDs to abbreviations for roster lookups.
    console.log("[MLB Roster Sync] Fetching teams...");
    const teams = await fetchTeams(season);
    const teamIdToAbbr = new Map<number, string>();
    for (const team of teams) {
      teamIdToAbbr.set(team.id, team.abbreviation);
    }
    console.log(`[MLB Roster Sync] Fetched ${teams.length} teams`);

    // Build team roster lookups (team ID -> roster entries) for position/jersey data.
    // The /sports/1/players response has limited position info for some players.
    const teamRosters = new Map<number, Map<number, { jerseyNumber: string; position: string }>>();
    for (const team of teams) {
      try {
        const roster = await fetchTeamRoster(team.id, season);
        const playerMap = new Map<number, { jerseyNumber: string; position: string }>();
        for (const entry of roster) {
          playerMap.set(entry.person.id, {
            jerseyNumber: entry.jerseyNumber || "",
            position: normalizePosition(entry.position?.abbreviation),
          });
        }
        teamRosters.set(team.id, playerMap);
      } catch (err: any) {
        console.warn(
          `[MLB Roster Sync] Could not fetch roster for team ${team.abbreviation}: ${err.message}`,
        );
      }
    }

    const existingPlayers = await storage.getPlayersBySport("MLB");
    const existingPlayerIds = new Set(existingPlayers.map((p: { id: string }) => p.id));
    const activeApiPlayerIds = new Set<string>();
    const fantasyPositions = new Set(["P", "C", "1B", "2B", "3B", "SS", "OF", "DH", "UTIL"]);

    for (const apiPlayer of apiPlayers) {
      result.playersProcessed++;

      const mlbamId = apiPlayer.id;
      const playerId = createPlayerId(mlbamId);

      // Resolve team abbreviation — prefer currentTeam, fall back to team roster
      let teamAbbr = apiPlayer.currentTeam?.abbreviation || "";
      if (!teamAbbr && apiPlayer.active) {
        // Try to find which team this player is on via team rosters
        for (const [teamId, roster] of Array.from(teamRosters.entries())) {
          if (roster.has(mlbamId)) {
            teamAbbr = teamIdToAbbr.get(teamId) || "";
            break;
          }
        }
      }
      if (!teamAbbr) continue; // Skip free agents and retired players

      // Resolve position — prefer team roster data, fall back to primaryPosition
      let position = "UTIL";
      let jerseyNumber = "";
      for (const [, roster] of Array.from(teamRosters.entries())) {
        const entry = roster.get(mlbamId);
        if (entry) {
          position = entry.position;
          jerseyNumber = entry.jerseyNumber;
          break;
        }
      }
      if (position === "UTIL" && apiPlayer.primaryPosition?.abbreviation) {
        position = normalizePosition(apiPlayer.primaryPosition.abbreviation);
      }
      if (!fantasyPositions.has(position)) continue;

      if (!jerseyNumber) {
        jerseyNumber = apiPlayer.primaryNumber || "";
      }

      activeApiPlayerIds.add(playerId);

      const playerData = {
        id: playerId,
        sport: "MLB" as const,
        firstName: apiPlayer.firstName,
        lastName: apiPlayer.lastName,
        team: teamAbbr,
        position,
        jerseyNumber: jerseyNumber || null,
        isActive: apiPlayer.active !== false,
        isEligibleForVesting: true, // StatsAPI doesn't expose IL; injured skip handled upstream
      };

      try {
        if (existingPlayerIds.has(playerId)) {
          await storage.updatePlayer(playerId, playerData);
          result.playersUpdated++;
        } else {
          const upserted = await storage.upsertPlayer(playerData);
          activeApiPlayerIds.add(upserted.id);
          result.playersAdded++;
        }
      } catch (error: any) {
        result.errors.push(`Failed to sync player ${playerId}: ${error.message}`);
      }
    }

    // Deactivate players no longer in the API roster
    for (const existingPlayer of existingPlayers) {
      if (!activeApiPlayerIds.has(existingPlayer.id) && existingPlayer.isActive) {
        try {
          await storage.updatePlayer(existingPlayer.id, {
            isActive: false,
            isEligibleForVesting: false,
          });
          result.playersDeactivated++;
        } catch (error: any) {
          result.errors.push(`Failed to deactivate player ${existingPlayer.id}: ${error.message}`);
        }
      }
    }

    result.success = result.errors.length === 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[MLB Roster Sync] Completed in ${duration}s`);
    console.log(`  - Players processed: ${result.playersProcessed}`);
    console.log(`  - Players added: ${result.playersAdded}`);
    console.log(`  - Players updated: ${result.playersUpdated}`);
    console.log(`  - Players deactivated: ${result.playersDeactivated}`);
    if (result.errors.length > 0) {
      console.log(`  - Errors: ${result.errors.length}`);
    }
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    console.error("[MLB Roster Sync] Fatal error:", error);
  }

  return result;
}

export default syncMLBRoster;
