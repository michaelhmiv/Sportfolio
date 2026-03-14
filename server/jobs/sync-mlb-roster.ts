/**
 * MLB Roster Sync Job
 *
 * Fetches active MLB players from Ball Don't Lie API and syncs to database.
 * Also attempts to fetch injury data to set vesting eligibility.
 */

import { storage } from "../storage";
import {
  fetchActivePlayers,
  fetchInjuries,
  createMLBPlayerId,
  normalizePosition,
  isMLBApiConfigured,
  type MLBInjury,
} from "../balldontlie-mlb";

interface SyncResult {
  success: boolean;
  playersProcessed: number;
  playersAdded: number;
  playersUpdated: number;
  playersDeactivated: number;
  injuredPlayers: number;
  errors: string[];
}

export async function syncMLBRoster(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    playersProcessed: 0,
    playersAdded: 0,
    playersUpdated: 0,
    playersDeactivated: 0,
    injuredPlayers: 0,
    errors: [],
  };

  if (!isMLBApiConfigured()) {
    result.errors.push("BALLDONTLIE_API_KEY not configured");
    console.error("[MLB Roster Sync] API key not configured");
    return result;
  }

  console.log("[MLB Roster Sync] Starting roster synchronization...");
  const startTime = Date.now();

  try {
    console.log("[MLB Roster Sync] Fetching active players from API...");
    const apiPlayers = await fetchActivePlayers();
    console.log(`[MLB Roster Sync] Fetched ${apiPlayers.length} players from API`);

    let injuries: MLBInjury[] = [];
    try {
      console.log("[MLB Roster Sync] Fetching injury report...");
      injuries = await fetchInjuries();
      console.log(`[MLB Roster Sync] Fetched ${injuries.length} injury records`);
    } catch (error: any) {
      console.warn("[MLB Roster Sync] Injury fetch unavailable, continuing:", error.message);
    }

    const injuryMap = new Map<number, MLBInjury>();
    for (const injury of injuries) {
      injuryMap.set(injury.player.id, injury);
    }
    result.injuredPlayers = injuryMap.size;

    const existingPlayers = await storage.getPlayersBySport("MLB");
    const existingPlayerIds = new Set(existingPlayers.map((p: { id: string }) => p.id));
    const activeApiPlayerIds = new Set<string>();

    for (const apiPlayer of apiPlayers) {
      result.playersProcessed++;

      if (!apiPlayer.team) {
        continue;
      }

      const normalizedPosition = normalizePosition(
        apiPlayer.position_abbreviation || apiPlayer.position,
      );
      const fantasyPositions = ["P", "C", "1B", "2B", "3B", "SS", "OF", "DH", "UTIL"];
      if (!fantasyPositions.includes(normalizedPosition)) {
        continue;
      }

      const playerId = createMLBPlayerId(apiPlayer.id);
      activeApiPlayerIds.add(playerId);

      const injury = injuryMap.get(apiPlayer.id);
      const injuryStatus = (injury?.status || "").toLowerCase();
      const isEligibleForVesting =
        !injury || !["out", "il", "injured", "injured list"].includes(injuryStatus);

      const playerData = {
        id: playerId,
        sport: "MLB" as const,
        firstName: apiPlayer.first_name,
        lastName: apiPlayer.last_name,
        team: apiPlayer.team.abbreviation,
        position: normalizedPosition,
        jerseyNumber: apiPlayer.jersey_number || null,
        isActive: true,
        isEligibleForVesting,
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
    console.log(`  - Injured players: ${result.injuredPlayers}`);
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
