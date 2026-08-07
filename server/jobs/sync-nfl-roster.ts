import { storage } from "../storage";
import { NFL_ELIGIBLE_POSITIONS, espnNfl } from "../nfl/espn-client";
import {
  buildNflIdentityMaps,
  createNflEspnAlias,
  createNflPlayerId,
  splitNflDisplayName,
} from "../nfl/identity";
import { nflverse } from "../nfl/nflverse";

export interface NflRosterSyncResult {
  requestCount: number;
  playersAdded: number;
  playersUpdated: number;
  playersDeactivated: number;
  unresolvedIdentities: number;
  errors: string[];
}

export async function syncNFLRoster(): Promise<NflRosterSyncResult> {
  const result: NflRosterSyncResult = {
    requestCount: 0,
    playersAdded: 0,
    playersUpdated: 0,
    playersDeactivated: 0,
    unresolvedIdentities: 0,
    errors: [],
  };

  try {
    const identities = await nflverse.getPlayers();
    result.requestCount++;
    const identityMaps = buildNflIdentityMaps(identities);
    const teams = await espnNfl.getTeams();
    result.requestCount++;
    const existingPlayers = await storage.getPlayersBySport("NFL");
    const existingIds = new Set(existingPlayers.map((player) => player.id));
    const seen = new Set<string>();

    for (const team of teams) {
      try {
        const roster = await espnNfl.getTeamRoster(team.id);
        result.requestCount++;
        for (const athlete of roster) {
          if (!NFL_ELIGIBLE_POSITIONS.has(athlete.position)) continue;
          const identity = identityMaps.byEspnId.get(athlete.espnId);
          if (!identity?.gsisId) {
            result.unresolvedIdentities++;
            continue;
          }
          const playerId = createNflPlayerId(identity.gsisId);
          const { firstName, lastName } = splitNflDisplayName(athlete.displayName || identity.displayName);
          await storage.upsertPlayer({
            id: playerId,
            sport: "NFL",
            firstName,
            lastName,
            team: team.abbreviation,
            position: athlete.position,
            jerseyNumber: athlete.jersey,
            isActive: athlete.active,
            isEligibleForVesting: athlete.active,
          });
          await storage.upsertPlayerIdAlias({
            aliasPlayerId: createNflEspnAlias(athlete.espnId),
            canonicalPlayerId: playerId,
            sport: "NFL",
            reason: "espn_gsis_crosswalk",
          });
          seen.add(playerId);
          if (existingIds.has(playerId)) result.playersUpdated++;
          else result.playersAdded++;
        }
      } catch (error: any) {
        result.errors.push(`${team.abbreviation}: ${error?.message || error}`);
      }
    }

    for (const player of existingPlayers) {
      if (seen.has(player.id) || !player.isActive) continue;
      await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });
      result.playersDeactivated++;
    }
  } catch (error: any) {
    result.errors.push(error?.message || String(error));
  }

  return result;
}

export default syncNFLRoster;
