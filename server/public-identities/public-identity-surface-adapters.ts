import type { PublicUserIdentity } from "@shared/public-user-identity";
import { publicIdentityRepository } from "./public-identity-repository";

// ── batch identity resolver ─────────────────────────────────────────────────

const MAX_BATCH_SIZE = 100;

/**
 * Synthetic / pool / blank IDs that should never be resolved.
 */
const EXCLUDED_IDS = new Set(["pool", "system", "bot", ""]);

/**
 * Deduplicate, exclude synthetic/pool/blank IDs, chunk into ≤100 batches,
 * resolve all, and return a Map<userId, PublicUserIdentity | null>.
 *
 * Null values in the map indicate missing or soft-deleted users.
 */
export async function resolveIdentityBatch(
  userIds: Iterable<string>,
): Promise<Map<string, PublicUserIdentity | null>> {
  // Deduplicate and filter
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const id of userIds) {
    const trimmed = id.trim();
    if (!trimmed || EXCLUDED_IDS.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
  }

  if (clean.length === 0) return new Map();

  const result = new Map<string, PublicUserIdentity | null>();

  // Chunk into ≤100 batches
  for (let i = 0; i < clean.length; i += MAX_BATCH_SIZE) {
    const chunk = clean.slice(i, i + MAX_BATCH_SIZE);
    const identities = await publicIdentityRepository.resolveIdentities(chunk);
    for (let j = 0; j < chunk.length; j++) {
      result.set(chunk[j], identities[j]);
    }
  }

  return result;
}

/**
 * Extract non-pool buyer/seller IDs from a market activity item.
 */
export function extractActorIds(items: Array<{
  buyerId?: string | null;
  sellerId?: string | null;
}>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.buyerId && item.buyerId !== "pool") {
      ids.add(item.buyerId);
    }
    if (item.sellerId && item.sellerId !== "pool") {
      ids.add(item.sellerId);
    }
  }
  return Array.from(ids);
}
