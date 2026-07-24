// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicIdentityBatchResponse } from "@shared/public-user-identity";
import { usePublicIdentities } from "./usePublicIdentities";

// ── hoisted mocks ────────────────────────────────────────────────────────────

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual: any = await vi.importActual("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: mockApiRequest,
  };
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeWrapper(queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function makeIdentity(userId: string) {
  return {
    userId,
    username: `user_${userId}`,
    avatarUrl: null,
    premiumActive: false,
    activeBadge: null,
  };
}

function mockResolveResponse(identities: PublicIdentityBatchResponse["identities"]) {
  mockApiRequest.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ identities }),
  });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("usePublicIdentities", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("returns empty object when given empty array (no fetch)", () => {
    const { result } = renderHook(() => usePublicIdentities([]), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toEqual({});
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("returns empty object when given only blank/empty strings (no fetch)", () => {
    const { result } = renderHook(() => usePublicIdentities(["", "  ", "\t"]), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toEqual({});
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("returns empty object when given only pool-like IDs (no fetch)", () => {
    const { result } = renderHook(() => usePublicIdentities(["POOL", "pool-1", "pool_abc"]), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toEqual({});
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("filters blank and pool IDs, fetches only valid ones", async () => {
    mockResolveResponse([
      makeIdentity("valid-1"),
      null, // for "valid-2"
      makeIdentity("valid-3"),
    ]);

    const { result } = renderHook(
      () => usePublicIdentities(["valid-1", "", "valid-2", "pool-abc", "valid-3", "  "]),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current).not.toEqual({});
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/public-identities/resolve", {
      userIds: ["valid-1", "valid-2", "valid-3"],
    });

    // Result maps back to the original IDs (including filtered ones get null)
    expect(result.current["valid-1"]?.userId).toBe("valid-1");
    expect(result.current["valid-2"]).toBeNull();
    expect(result.current["valid-3"]?.userId).toBe("valid-3");
    // Pool IDs and blank IDs are filtered out entirely (not in result)
    expect(result.current["pool-abc"]).toBeUndefined();
    expect(result.current[""]).toBeUndefined();
    expect(result.current["  "]).toBeUndefined();
  });

  it("deduplicates IDs before fetching", async () => {
    mockResolveResponse([makeIdentity("dup-1")]);

    const { result } = renderHook(() => usePublicIdentities(["dup-1", "dup-1", "dup-1"]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).not.toEqual({});
    });

    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/public-identities/resolve", {
      userIds: ["dup-1"],
    });
    expect(result.current["dup-1"]?.userId).toBe("dup-1");
  });

  it("chunks identity requests at the endpoint limit", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `user-${index}`);
    mockResolveResponse(ids.slice(0, 100).map(makeIdentity));
    mockResolveResponse([makeIdentity(ids[100])]);

    const { result } = renderHook(() => usePublicIdentities(ids), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current[ids[100]]?.userId).toBe(ids[100]);
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(2);
    expect(mockApiRequest).toHaveBeenNthCalledWith(1, "POST", "/api/public-identities/resolve", {
      userIds: ids.slice(0, 100),
    });
    expect(mockApiRequest).toHaveBeenNthCalledWith(2, "POST", "/api/public-identities/resolve", {
      userIds: [ids[100]],
    });
  });

  it("maps identities back to original IDs in correct positions", async () => {
    mockResolveResponse([
      makeIdentity("a"),
      null, // b not found
      makeIdentity("c"),
    ]);

    const { result } = renderHook(() => usePublicIdentities(["a", "b", "c"]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(Object.keys(result.current).length).toBeGreaterThan(1);
    });

    expect(result.current["a"]?.userId).toBe("a");
    expect(result.current["b"]).toBeNull();
    expect(result.current["c"]?.userId).toBe("c");
  });

  it("returns empty object on fetch error", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => usePublicIdentities(["x"]), { wrapper: makeWrapper() });

    await waitFor(() => {
      // After error, it should still have loaded (with empty result)
      expect(mockApiRequest).toHaveBeenCalled();
    });

    // On error, we return empty object as fallback
    expect(result.current).toEqual({});
  });

  it("caches per unique set of IDs (dedup by key)", async () => {
    mockResolveResponse([makeIdentity("key-1")]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result, rerender } = renderHook(({ ids }) => usePublicIdentities(ids), {
      wrapper: makeWrapper(qc),
      initialProps: { ids: ["key-1"] },
    });

    await waitFor(() => {
      expect(result.current["key-1"]).toBeTruthy();
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);

    // Re-render with same IDs should not trigger another fetch
    mockApiRequest.mockClear();
    rerender({ ids: ["key-1"] });

    // No new fetch triggered for same key
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
