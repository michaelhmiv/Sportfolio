import type { NflversePlayerIdentity } from "./nflverse";

const NFL_TEAM_ALIASES: Record<string, string> = {
  WAS: "WSH",
  LA: "LAR",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
};

export function normalizeNflTeamAbbreviation(value: string | null | undefined): string {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return NFL_TEAM_ALIASES[normalized] || normalized;
}

export function createNflPlayerId(gsisId: string): string {
  const normalized = String(gsisId || "").trim();
  if (!normalized) throw new Error("NFL GSIS id is required");
  return `nfl_${normalized}`;
}

export function createNflEspnAlias(espnId: string): string {
  const normalized = String(espnId || "").trim();
  if (!normalized) throw new Error("NFL ESPN id is required");
  return `nfl_espn_${normalized}`;
}

export interface NflIdentityMaps {
  byEspnId: Map<string, NflversePlayerIdentity>;
  byGsisId: Map<string, NflversePlayerIdentity>;
}

export function buildNflIdentityMaps(players: NflversePlayerIdentity[]): NflIdentityMaps {
  const byEspnId = new Map<string, NflversePlayerIdentity>();
  const byGsisId = new Map<string, NflversePlayerIdentity>();
  for (const player of players) {
    if (!player.gsisId) continue;
    byGsisId.set(player.gsisId, player);
    if (player.espnId) byEspnId.set(player.espnId, player);
  }
  return { byEspnId, byGsisId };
}

export function splitNflDisplayName(displayName: string): { firstName: string; lastName: string } {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "Unknown", lastName: "Player" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
