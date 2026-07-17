import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  PublicUserIdentity,
  PublicIdentityBatchResponse,
} from "@shared/public-user-identity";

const STALE_TIME = 30_000;

function isBlankOrPool(id: string): boolean {
  return !id.trim() || id.trim().toLowerCase().startsWith("pool");
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function buildQueryKey(userIds: string[]) {
  const cleaned = dedupe(userIds.filter((id) => !isBlankOrPool(id))).sort();
  return ["/api/public-identities", ...cleaned];
}

export function usePublicIdentities(
  userIds: string[],
): Record<string, PublicUserIdentity | null> {
  const validIds = userIds.filter((id) => !isBlankOrPool(id));
  const deduped = dedupe(validIds);

  const { data } = useQuery<PublicIdentityBatchResponse>({
    queryKey: buildQueryKey(userIds),
    queryFn: async () => {
      if (deduped.length === 0) {
        return { identities: [] };
      }
      const res = await apiRequest("POST", "/api/public-identities/resolve", {
        userIds: deduped,
      });
      return res.json() as Promise<PublicIdentityBatchResponse>;
    },
    staleTime: STALE_TIME,
    enabled: deduped.length > 0,
  });

  if (!data || deduped.length === 0) {
    // Return empty object for non-qualifying inputs
    if (validIds.length === 0) return {};
    return {};
  }

  // Map response identities back to deduped IDs
  const identityMap = new Map<string, PublicUserIdentity | null>();
  for (let i = 0; i < deduped.length; i++) {
    identityMap.set(deduped[i], data.identities[i] ?? null);
  }

  // Build result record from original valid IDs
  const result: Record<string, PublicUserIdentity | null> = {};
  for (const id of validIds) {
    result[id] = identityMap.get(id) ?? null;
  }

  return result;
}
