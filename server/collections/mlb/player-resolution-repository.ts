import { playerPools, players } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { loadPlayerIdentityContexts } from "../../player-identity";
import type { ImportedCollectionMember } from "./catalog-importer";
import {
  resolveTradeableMembers,
  type PlayerResolutionRow,
  type ResolvedCollectionMember,
  type PlayerResolutionError,
} from "./player-resolver";

export async function resolveImportedMembers(
  members: ImportedCollectionMember[],
  requireFunding = true,
): Promise<{ members: ResolvedCollectionMember[]; errors: PlayerResolutionError[] }> {
  if (members.length === 0) return { members: [], errors: [] };

  const requestedIds = Array.from(new Set(members.map((member) => `mlb_${member.mlbamId}`)));
  const identityContexts = await loadPlayerIdentityContexts(db, requestedIds);
  const canonicalByRequested = new Map(
    requestedIds.map((requestedId) => [
      requestedId,
      identityContexts.get(requestedId)?.canonicalId || requestedId,
    ]),
  );
  const canonicalIds = Array.from(
    new Set(
      requestedIds.map((requestedId) => canonicalByRequested.get(requestedId) || requestedId),
    ),
  );
  const playerRows = await db
    .select({
      canonicalPlayerId: players.id,
      sport: players.sport,
      isActive: players.isActive,
      poolShares: playerPools.shares,
      poolPlayMoney: playerPools.playMoney,
    })
    .from(players)
    .leftJoin(playerPools, eq(playerPools.playerId, players.id))
    .where(inArray(players.id, canonicalIds));
  const playerById = new Map(playerRows.map((row) => [row.canonicalPlayerId, row]));
  const rows: PlayerResolutionRow[] = [];
  for (const requestedPlayerId of requestedIds) {
    const canonicalPlayerId = canonicalByRequested.get(requestedPlayerId) || requestedPlayerId;
    const player = playerById.get(canonicalPlayerId);
    if (!player) continue;
    rows.push({ requestedPlayerId, ...player });
  }
  return resolveTradeableMembers(members, rows, requireFunding);
}
