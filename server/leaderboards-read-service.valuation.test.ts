import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getUsers: vi.fn(),
  getAllUsersForRanking: vi.fn(),
  getLatestSnapshotRanks: vi.fn(),
}));

vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./cache", () => ({
  getOrCompute: vi.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
}));

import { getLeaderboardReadResponse } from "./leaderboards-read-service";

describe("portfolio-value leaderboard canonical inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUsers.mockResolvedValue([
      { id: "user-a", username: "Alpha", profileImageUrl: null },
      { id: "user-b", username: "Beta", profileImageUrl: null },
    ]);
    storageMock.getLatestSnapshotRanks.mockResolvedValue(new Map());
  });

  it("ranks $600 of liquid Singles above $200 without adding Stack Power", async () => {
    storageMock.getAllUsersForRanking.mockResolvedValue([
      { userId: "user-a", balance: "100.00", portfolioValue: 600 },
      { userId: "user-b", balance: "100.00", portfolioValue: 200 },
    ]);

    const result = await getLeaderboardReadResponse("portfolioValue", "user-a");
    expect(result.leaderboard).toMatchObject([
      { userId: "user-a", rank: 1, value: 600 },
      { userId: "user-b", rank: 2, value: 200 },
    ]);
    expect(result.currentUser).toMatchObject({ userId: "user-a", value: 600 });
    expect(result.leaderboard.every((entry) => entry.value > 0)).toBe(true);
  });
});
