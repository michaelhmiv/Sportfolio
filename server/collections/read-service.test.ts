import { describe, expect, it } from "vitest";
import { CollectionApiReadService } from "./read-service";
import { CollectionDomainError } from "./state-engine";
import type { CollectionReadRepository } from "./read-repository";
import type { CollectionDetailResponse, CollectionListEntry } from "@shared/collection-api";

function makeEntry(slug: string): CollectionListEntry {
  return {
    slug,
    definitionId: `def-${slug}`,
    sport: "MLB",
    league: "NL",
    season: "2025",
    family: "sluggers",
    kind: "player_slots",
    lifecycleStatus: "tracking",
    versionId: `ver-${slug}`,
    version: 1,
    title: "Test Collection",
    description: "A test collection",
    artKey: "default-key",
    state: "tracking",
    assemblyState: "unstarted",
    allocatedQuantity: "0.0000",
    requiredQuantity: "1.0000",
    qualifiedSlotCount: 0,
    requiredSlotCount: 5,
    progressBps: 0,
    award: null,
  };
}

function makeDetail(
  slug: string,
  overrides?: Partial<CollectionDetailResponse>,
): CollectionDetailResponse {
  return {
    ...makeEntry(slug),
    qualificationDescription: "Score 5 runs",
    slots: [],
    prerequisites: [],
    ...overrides,
  };
}

describe("CollectionApiReadService", () => {
  it("listCollections passes through to the repository", async () => {
    const expected: CollectionListEntry[] = [makeEntry("hr-king"), makeEntry("rbis")];
    const repo: CollectionReadRepository = {
      listCollections: async () => expected,
      getCollectionBySlug: async () => null,
    };
    const svc = new CollectionApiReadService(repo);
    const result = await svc.listCollections("user-1");
    expect(result).toBe(expected);
  });

  it("getCollectionBySlug returns detail when repository returns it", async () => {
    const detail = makeDetail("hr-king");
    const repo: CollectionReadRepository = {
      listCollections: async () => [],
      getCollectionBySlug: async (_uid, slug) => (slug === "hr-king" ? detail : null),
    };
    const svc = new CollectionApiReadService(repo);
    const result = await svc.getCollectionBySlug("user-1", "hr-king");
    expect(result).toEqual(detail);
  });

  it("getCollectionBySlug throws COLLECTION_NOT_FOUND (404) when repository returns null", async () => {
    const repo: CollectionReadRepository = {
      listCollections: async () => [],
      getCollectionBySlug: async () => null,
    };
    const svc = new CollectionApiReadService(repo);

    await expect(svc.getCollectionBySlug("user-1", "does-not-exist")).rejects.toThrow(
      CollectionDomainError,
    );

    try {
      await svc.getCollectionBySlug("user-1", "does-not-exist");
    } catch (err) {
      expect(err).toBeInstanceOf(CollectionDomainError);
      const domainErr = err as CollectionDomainError;
      expect(domainErr.code).toBe("COLLECTION_NOT_FOUND");
      expect(domainErr.status).toBe(404);
      expect(domainErr.details).toEqual({ slug: "does-not-exist" });
    }
  });

  it("listCollections returns empty array when repository returns nothing", async () => {
    const repo: CollectionReadRepository = {
      listCollections: async () => [],
      getCollectionBySlug: async () => null,
    };
    const svc = new CollectionApiReadService(repo);
    const result = await svc.listCollections("user-1");
    expect(result).toEqual([]);
  });
});
