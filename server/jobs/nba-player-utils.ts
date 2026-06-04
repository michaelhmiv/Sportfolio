import type { Player } from "@shared/schema";

import type { NBAGameStats } from "../balldontlie-nba";
import { createNBAPlayerId } from "../balldontlie-nba";
import { storage } from "../storage";

type NBAStatPlayerLike = Pick<NBAGameStats, "player" | "team">;

export async function ensureNBAPlayerFromStat(stat: NBAStatPlayerLike): Promise<Player> {
  const playerId = createNBAPlayerId(stat.player.id);
  const [existingPlayer] = await storage.getPlayersByIds([playerId]);

  if (existingPlayer) {
    return existingPlayer;
  }

  return await storage.upsertPlayer({
    id: playerId,
    sport: "NBA",
    firstName: stat.player.first_name,
    lastName: stat.player.last_name,
    team: stat.team?.abbreviation || stat.player.team?.abbreviation || "UNK",
    position: stat.player.position || "G",
    jerseyNumber: stat.player.jersey_number || "",
    isActive: true,
    isEligibleForVesting: true,
  });
}
