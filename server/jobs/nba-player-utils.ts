import { storage } from "../storage";

export type NBAPlayerStatPayload = {
  player?: {
    id?: number | string;
    first_name?: string;
    last_name?: string;
    position?: string;
    jersey_number?: string | number | null;
    team?: { abbreviation?: string | null } | null;
  } | null;
  team?: { abbreviation?: string | null } | null;
};

/**
 * Ensure a current NBA stat row resolves to a canonical local player.
 *
 * New Sportfolio admission is allowed only when the current stat payload identifies a
 * real team. Historical/free-agent rows must not create assets. A previously admitted
 * inactive player may be reactivated by current participation using the same provider ID.
 */
export async function ensureNBAPlayerFromStat(stat: NBAPlayerStatPayload) {
  const providerId = String(stat.player?.id ?? "").trim();
  if (!providerId) return null;

  const id = `nba_${providerId}`;
  const [existing] = await storage.getPlayersByIds([id]);
  const team = String(stat.team?.abbreviation || stat.player?.team?.abbreviation || "")
    .trim()
    .toUpperCase();
  const hasCurrentTeam = Boolean(team && team !== "FA");

  if (existing) {
    if (existing.isActive === false && hasCurrentTeam) {
      await storage.updatePlayer(id, {
        team,
        position: String(stat.player?.position || existing.position || "").trim(),
        jerseyNumber:
          stat.player?.jersey_number === null || stat.player?.jersey_number === undefined
            ? existing.jerseyNumber
            : String(stat.player.jersey_number),
        isActive: true,
        isEligibleForVesting: true,
      });
    }
    return existing;
  }

  if (!hasCurrentTeam) return null;

  const firstName = String(stat.player?.first_name ?? "").trim();
  const lastName = String(stat.player?.last_name ?? "").trim();
  if (!firstName || !lastName) return null;

  return storage.upsertPlayer({
    id,
    sport: "NBA",
    firstName,
    lastName,
    team,
    position: String(stat.player?.position || "").trim(),
    jerseyNumber:
      stat.player?.jersey_number === null || stat.player?.jersey_number === undefined
        ? null
        : String(stat.player.jersey_number),
    isActive: true,
    isEligibleForVesting: true,
  });
}
