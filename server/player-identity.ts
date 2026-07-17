import { playerIdAliases } from "@shared/schema";
import { inArray, or } from "drizzle-orm";

export interface PlayerAliasEdge {
  aliasPlayerId: string;
  canonicalPlayerId: string;
}

export interface PlayerIdentityContext {
  requestedId: string;
  canonicalId: string;
  aliasIds: string[];
  allIds: string[];
}

export function holdingReservationDomain(
  userId: string,
  assetType: string,
  identityIds: string[],
): string {
  const sortedIds = Array.from(new Set(identityIds)).sort();
  return `${userId}\u0000${assetType}\u0000${sortedIds.join("\u0000")}`;
}

export function buildPlayerIdentityContexts(
  playerIds: string[],
  edges: PlayerAliasEdge[],
): Map<string, PlayerIdentityContext> {
  const requestedIds = Array.from(
    new Set(playerIds.map((playerId) => String(playerId || "").trim()).filter(Boolean)),
  );
  const outgoing = new Map(edges.map((edge) => [edge.aliasPlayerId, edge.canonicalPlayerId]));
  const adjacent = new Map<string, Set<string>>();
  for (const edge of edges) {
    const aliasNeighbors = adjacent.get(edge.aliasPlayerId) || new Set<string>();
    aliasNeighbors.add(edge.canonicalPlayerId);
    adjacent.set(edge.aliasPlayerId, aliasNeighbors);
    const canonicalNeighbors = adjacent.get(edge.canonicalPlayerId) || new Set<string>();
    canonicalNeighbors.add(edge.aliasPlayerId);
    adjacent.set(edge.canonicalPlayerId, canonicalNeighbors);
  }

  const contexts = new Map<string, PlayerIdentityContext>();
  for (const requestedId of requestedIds) {
    const component = new Set<string>([requestedId]);
    const pending = [requestedId];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of Array.from(adjacent.get(current) || [])) {
        if (component.has(neighbor)) continue;
        component.add(neighbor);
        pending.push(neighbor);
      }
    }

    let canonicalId = requestedId;
    const canonicalPath = new Set<string>();
    while (outgoing.has(canonicalId)) {
      if (canonicalPath.has(canonicalId)) {
        throw new Error(`Player alias cycle detected for ${requestedId}`);
      }
      canonicalPath.add(canonicalId);
      canonicalId = outgoing.get(canonicalId)!;
    }
    const allIds = Array.from(component).sort();
    contexts.set(requestedId, {
      requestedId,
      canonicalId,
      aliasIds: allIds.filter((identityId) => identityId !== canonicalId),
      allIds,
    });
  }
  return contexts;
}

export async function loadPlayerIdentityContexts(
  executor: any,
  playerIds: string[],
): Promise<Map<string, PlayerIdentityContext>> {
  const requestedIds = Array.from(
    new Set(playerIds.map((playerId) => String(playerId || "").trim()).filter(Boolean)),
  );
  if (requestedIds.length === 0) return new Map();

  const discovered = new Set(requestedIds);
  const edges = new Map<string, PlayerAliasEdge>();
  let frontier = requestedIds;
  while (frontier.length > 0) {
    const rows = (await executor
      .select({
        aliasPlayerId: playerIdAliases.aliasPlayerId,
        canonicalPlayerId: playerIdAliases.canonicalPlayerId,
      })
      .from(playerIdAliases)
      .where(
        or(
          inArray(playerIdAliases.aliasPlayerId, frontier),
          inArray(playerIdAliases.canonicalPlayerId, frontier),
        ),
      )) as PlayerAliasEdge[];
    const nextFrontier: string[] = [];
    for (const row of rows) {
      edges.set(`${row.aliasPlayerId}\u0000${row.canonicalPlayerId}`, row);
      for (const identityId of [row.aliasPlayerId, row.canonicalPlayerId]) {
        if (discovered.has(identityId)) continue;
        discovered.add(identityId);
        nextFrontier.push(identityId);
      }
    }
    frontier = nextFrontier;
  }
  return buildPlayerIdentityContexts(requestedIds, Array.from(edges.values()));
}

export async function loadPlayerIdentityContext(
  executor: any,
  playerId: string,
): Promise<PlayerIdentityContext> {
  const requestedId = String(playerId || "").trim();
  if (!requestedId) {
    return { requestedId, canonicalId: requestedId, aliasIds: [], allIds: [] };
  }
  const contexts = await loadPlayerIdentityContexts(executor, [requestedId]);
  return contexts.get(requestedId)!;
}
