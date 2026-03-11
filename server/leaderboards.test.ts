import { describe, expect, it } from "vitest";
import {
  buildLeaderboardWindow,
  getLeaderboardRankChange,
  normalizeLeaderboardCategory,
  type LeaderboardEntry,
} from "./leaderboards";

describe("leaderboards helpers", () => {
  it("normalizes legacy leaderboard categories", () => {
    expect(normalizeLeaderboardCategory("sharesMined")).toBe("tradingVolume24h");
    expect(normalizeLeaderboardCategory("netWorth")).toBe("netWorth");
  });

  it("returns null for unsupported categories", () => {
    expect(normalizeLeaderboardCategory("unknown_metric")).toBeNull();
  });

  it("builds a centered current-user leaderboard window", () => {
    const entries: LeaderboardEntry[] = [
      {
        rank: 1,
        userId: "u1",
        username: "alpha",
        profileImageUrl: null,
        value: 100,
        rankChange: null,
      },
      {
        rank: 2,
        userId: "u2",
        username: "bravo",
        profileImageUrl: null,
        value: 90,
        rankChange: null,
      },
      {
        rank: 3,
        userId: "u3",
        username: "charlie",
        profileImageUrl: null,
        value: 80,
        rankChange: null,
      },
      {
        rank: 4,
        userId: "u4",
        username: "delta",
        profileImageUrl: null,
        value: 70,
        rankChange: null,
      },
      {
        rank: 5,
        userId: "u5",
        username: "echo",
        profileImageUrl: null,
        value: 60,
        rankChange: null,
      },
    ];

    expect(buildLeaderboardWindow(entries, "u3", 1).map((entry) => entry.userId)).toEqual([
      "u2",
      "u3",
      "u4",
    ]);
  });

  it("returns an empty window when the current user is missing", () => {
    const entries: LeaderboardEntry[] = [
      {
        rank: 1,
        userId: "u1",
        username: "alpha",
        profileImageUrl: null,
        value: 100,
        rankChange: null,
      },
    ];

    expect(buildLeaderboardWindow(entries, "u999", 2)).toEqual([]);
  });

  it("computes rank movement relative to the previous rank", () => {
    expect(getLeaderboardRankChange(10, 7)).toBe(3);
    expect(getLeaderboardRankChange(3, 5)).toBe(-2);
    expect(getLeaderboardRankChange(null, 5)).toBeNull();
  });
});
