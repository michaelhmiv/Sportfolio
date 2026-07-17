import type { ImportedCollectionMember } from "./catalog-importer";

export interface PlayerResolutionRow {
  requestedPlayerId: string;
  canonicalPlayerId: string;
  sport: string;
  isActive: boolean;
  poolShares: string | null;
  poolPlayMoney: string | null;
}

export type PlayerResolutionErrorCode =
  | "PLAYER_NOT_FOUND"
  | "PLAYER_INACTIVE"
  | "PLAYER_SPORT_MISMATCH"
  | "PLAYER_NOT_TRADEABLE"
  | "DUPLICATE_CANONICAL_PLAYER";

export interface PlayerResolutionError {
  code: PlayerResolutionErrorCode;
  mlbamId: number;
  requestedPlayerId: string;
  message: string;
}

export interface ResolvedCollectionMember extends ImportedCollectionMember {
  playerId: string;
}

function isPositiveQuantity(value: string | null): boolean {
  if (value === null) return false;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0;
}

export function resolveTradeableMembers(
  members: ImportedCollectionMember[],
  rows: PlayerResolutionRow[],
  requireFunding = true,
): { members: ResolvedCollectionMember[]; errors: PlayerResolutionError[] } {
  const byRequestedId = new Map(rows.map((row) => [row.requestedPlayerId, row]));
  const canonicalOwners = new Map<string, number>();
  const errors: PlayerResolutionError[] = [];
  const resolved: ResolvedCollectionMember[] = [];

  for (const member of members) {
    const requestedPlayerId = `mlb_${member.mlbamId}`;
    const row = byRequestedId.get(requestedPlayerId);
    if (!row) {
      errors.push({
        code: "PLAYER_NOT_FOUND",
        mlbamId: member.mlbamId,
        requestedPlayerId,
        message: `${member.playerName} does not resolve to a Sportfolio player`,
      });
      continue;
    }
    if (row.sport.toUpperCase() !== "MLB") {
      errors.push({
        code: "PLAYER_SPORT_MISMATCH",
        mlbamId: member.mlbamId,
        requestedPlayerId,
        message: `${member.playerName} resolved to a non-MLB player`,
      });
      continue;
    }
    if (!row.isActive) {
      errors.push({
        code: "PLAYER_INACTIVE",
        mlbamId: member.mlbamId,
        requestedPlayerId,
        message: `${member.playerName} is inactive and cannot back a collection slot`,
      });
      continue;
    }
    if (requireFunding && (!isPositiveQuantity(row.poolShares) || !isPositiveQuantity(row.poolPlayMoney))) {
      errors.push({
        code: "PLAYER_NOT_TRADEABLE",
        mlbamId: member.mlbamId,
        requestedPlayerId,
        message: `${member.playerName} does not have an active liquid Sportfolio market`,
      });
      continue;
    }
    const existingMlbamId = canonicalOwners.get(row.canonicalPlayerId);
    if (existingMlbamId !== undefined && existingMlbamId !== member.mlbamId) {
      errors.push({
        code: "DUPLICATE_CANONICAL_PLAYER",
        mlbamId: member.mlbamId,
        requestedPlayerId,
        message: `${member.playerName} duplicates MLB person ${existingMlbamId} after alias resolution`,
      });
      continue;
    }
    canonicalOwners.set(row.canonicalPlayerId, member.mlbamId);
    resolved.push({ ...member, playerId: row.canonicalPlayerId });
  }

  return errors.length > 0 ? { members: [], errors } : { members: resolved, errors: [] };
}
