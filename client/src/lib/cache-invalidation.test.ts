import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueries } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
}));

vi.mock("./queryClient", () => ({
  queryClient: { invalidateQueries },
}));

import { debouncedInvalidatePortfolio, invalidatePortfolioQueries } from "./cache-invalidation";

describe("collection cache invalidation after holdings changes", () => {
  beforeEach(() => invalidateQueries.mockClear());

  it("refreshes collection availability for realtime portfolio events", () => {
    debouncedInvalidatePortfolio();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/me/collections"] });
  });

  it("refreshes collection availability after user-initiated trades", async () => {
    await invalidatePortfolioQueries();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/me/collections"] });
  });
});
