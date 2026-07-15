import { describe, expect, it, vi } from "vitest";

// Mock the repository
vi.mock("./public-identity-repository", () => ({
  publicIdentityRepository: {
    resolveIdentities: vi.fn(),
  },
}));

import { publicIdentityRepository } from "./public-identity-repository";
import { resolveIdentityBatch, extractActorIds } from "./public-identity-surface-adapters";
import type { PublicUserIdentity } from "@shared/public-user-identity";

function makeIdentity(userId: string): PublicUserIdentity {
  return {
    userId,
    username: `user-${userId}`,
    avatarUrl: null,
    premiumActive: false,
    activeBadge: null,
  };
}

describe("resolveIdentityBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns empty map for empty input", async () => {
    const result = await resolveIdentityBatch([]);
    expect(result.size).toBe(0);
  });

  it("deduplicates IDs", async () => {
    (publicIdentityRepository.resolveIdentities as any).mockResolvedValue([
      makeIdentity("a"),
      makeIdentity("b"),
    ]);

    const result = await resolveIdentityBatch(["a", "b", "a", "b"]);
    expect(result.size).toBe(2);
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenCalledWith(["a", "b"]);
  });

  it("excludes pool/system/bot/blank IDs", async () => {
    (publicIdentityRepository.resolveIdentities as any).mockResolvedValue([
      makeIdentity("real"),
    ]);

    const result = await resolveIdentityBatch(["pool", "system", "bot", "", "  ", "real"]);
    expect(result.size).toBe(1);
    expect(result.has("real")).toBe(true);
    expect(result.has("pool")).toBe(false);
    expect(result.has("system")).toBe(false);
    expect(result.has("bot")).toBe(false);
  });

  it("chunks into ≤100 batches", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `user-${i}`);
    const chunk1 = ids.slice(0, 100).map(makeIdentity);
    const chunk2 = ids.slice(100, 200).map(makeIdentity);
    const chunk3 = ids.slice(200, 250).map(makeIdentity);

    (publicIdentityRepository.resolveIdentities as any)
      .mockResolvedValueOnce(chunk1)
      .mockResolvedValueOnce(chunk2)
      .mockResolvedValueOnce(chunk3);

    const result = await resolveIdentityBatch(ids);
    expect(result.size).toBe(250);
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenCalledTimes(3);
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenNthCalledWith(1, ids.slice(0, 100));
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenNthCalledWith(2, ids.slice(100, 200));
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenNthCalledWith(3, ids.slice(200, 250));
  });

  it("maps null for missing users", async () => {
    (publicIdentityRepository.resolveIdentities as any).mockResolvedValue([
      makeIdentity("a"),
      null,
      makeIdentity("c"),
    ]);

    const result = await resolveIdentityBatch(["a", "b", "c"]);
    expect(result.get("a")).not.toBeNull();
    expect(result.get("b")).toBeNull();
    expect(result.get("c")).not.toBeNull();
  });

  it("trims IDs before deduplication", async () => {
    (publicIdentityRepository.resolveIdentities as any).mockResolvedValue([
      makeIdentity("user-1"),
    ]);

    const result = await resolveIdentityBatch(["  user-1  "]);
    expect(result.has("user-1")).toBe(true);
    expect(publicIdentityRepository.resolveIdentities).toHaveBeenCalledWith(["user-1"]);
  });
});

describe("extractActorIds", () => {
  it("extracts non-pool buyer/seller IDs", () => {
    const items = [
      { buyerId: "user-1", sellerId: "pool" },
      { buyerId: "pool", sellerId: "user-2" },
      { buyerId: "user-3", sellerId: "user-4" },
    ];
    const ids = extractActorIds(items);
    expect(ids.sort()).toEqual(["user-1", "user-2", "user-3", "user-4"]);
  });

  it("handles null/undefined IDs", () => {
    const items = [
      { buyerId: null, sellerId: null },
      { buyerId: undefined, sellerId: undefined },
      { buyerId: "user-1", sellerId: null },
    ];
    const ids = extractActorIds(items);
    expect(ids).toEqual(["user-1"]);
  });

  it("deduplicates across items", () => {
    const items = [
      { buyerId: "user-1", sellerId: "pool" },
      { buyerId: "user-1", sellerId: "user-2" },
      { buyerId: "user-2", sellerId: "user-1" },
    ];
    const ids = extractActorIds(items);
    expect(ids.sort()).toEqual(["user-1", "user-2"]);
  });
});
