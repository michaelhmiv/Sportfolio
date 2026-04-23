import {
  normalizeEtDateParam,
  normalizePlayersPagination,
  normalizePlayersSearchQuery,
  normalizePlayersSortField,
  normalizePlayersSortOrder,
  resolvePlayersWatchlistScope,
} from "./players-query";

describe("players-query helpers", () => {
  it("normalizes search query with q precedence", () => {
    expect(normalizePlayersSearchQuery({ q: "  LeBron  ", search: "Curry" })).toBe("LeBron");
    expect(normalizePlayersSearchQuery({ q: "   ", search: " Curry  " })).toBe("Curry");
    expect(normalizePlayersSearchQuery({ q: null, search: null })).toBeUndefined();
  });

  it("normalizes pagination with page fallback and clamped limits", () => {
    expect(normalizePlayersPagination({})).toEqual({ limit: 50, offset: 0 });
    expect(normalizePlayersPagination({ limit: "9000", page: "2" })).toEqual({
      limit: 5000,
      offset: 5000,
    });
    expect(normalizePlayersPagination({ limit: "10", page: "3", offset: "4" })).toEqual({
      limit: 10,
      offset: 4,
    });
  });

  it("normalizes sort field aliases and order", () => {
    expect(normalizePlayersSortField("liquidity")).toBe("tvl");
    expect(normalizePlayersSortField("invalid_field")).toBe("volume");
    expect(normalizePlayersSortOrder("asc")).toBe("asc");
    expect(normalizePlayersSortOrder("desc")).toBe("desc");
    expect(normalizePlayersSortOrder("random")).toBe("desc");
  });

  it("resolves watchlist scope and unauthorized state", () => {
    expect(
      resolvePlayersWatchlistScope({
        isWatchlist: "true",
      }),
    ).toEqual({
      requiresWatchlistScope: true,
      isUnauthorized: true,
    });

    expect(
      resolvePlayersWatchlistScope({
        isWatchlist: "true",
        watchlistId: "all",
        requestUser: { claims: { sub: "user-123" } },
      }),
    ).toEqual({
      requiresWatchlistScope: true,
      isUnauthorized: false,
      watchlistUserId: "user-123",
      scopedWatchlistId: undefined,
    });

    expect(
      resolvePlayersWatchlistScope({
        watchlistId: "wl-42",
        requestUser: { id: "user-abc" },
      }),
    ).toEqual({
      requiresWatchlistScope: true,
      isUnauthorized: false,
      watchlistUserId: "user-abc",
      scopedWatchlistId: "wl-42",
    });
  });

  it("normalizes ET date query values", () => {
    expect(normalizeEtDateParam("2026-04-23")).toBe("2026-04-23");
    expect(normalizeEtDateParam("2026-4-3")).toBeNull();
    expect(normalizeEtDateParam("today")).toBeNull();
    expect(normalizeEtDateParam(undefined)).toBeNull();
  });
});
