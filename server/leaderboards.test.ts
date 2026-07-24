import { describe, expect, it } from "vitest";
import {
  buildLeaderboardWindow,
  getLeaderboardRankChange,
  isLeaderboardEligibleUser,
  normalizeLeaderboardCategory,
  rankLeaderboardEntries,
  type LeaderboardEntry,
} from "./leaderboards";

describe("leaderboards helpers", () => {
  it("excludes non-human and deleted accounts from competitive ranks", () => {
    expect(isLeaderboardEligibleUser({ id: "u1", isBot: false, deletedAt: null })).toBe(true);
    expect(isLeaderboardEligibleUser({ id: "bot", isBot: true, deletedAt: null })).toBe(false);
    expect(isLeaderboardEligibleUser({ id: "deleted", isBot: false, deletedAt: new Date() })).toBe(
      false,
    );
    expect(
      isLeaderboardEligibleUser({ id: "dev-user-12345678", isBot: false, deletedAt: null }),
    ).toBe(false);
  });

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

  it("ranks only eligible users with non-zero values", () => {
    const ranked = rankLeaderboardEntries([
      {
        userId: "market-maker",
        username: "Market Maker",
        profileImageUrl: null,
        value: 500_000_000,
        rankChange: null,
        eligible: false,
      },
      {
        userId: "zero",
        username: "Zero",
        profileImageUrl: null,
        value: 0,
        rankChange: null,
        eligible: true,
      },
      {
        userId: "u2",
        username: "Bravo",
        profileImageUrl: null,
        value: 90.126,
        rankChange: null,
        eligible: true,
      },
      {
        userId: "u3",
        username: "Charlie",
        profileImageUrl: null,
        value: -10,
        rankChange: null,
        eligible: true,
      },
      {
        userId: "u1",
        username: "Alpha",
        profileImageUrl: null,
        value: 100,
        rankChange: null,
        eligible: true,
      },
    ]);

    expect(ranked).toEqual([
      {
        rank: 1,
        userId: "u1",
        username: "Alpha",
        profileImageUrl: null,
        value: 100,
        rankChange: null,
      },
      {
        rank: 2,
        userId: "u2",
        username: "Bravo",
        profileImageUrl: null,
        value: 90.13,
        rankChange: null,
      },
      {
        rank: 3,
        userId: "u3",
        username: "Charlie",
        profileImageUrl: null,
        value: -10,
        rankChange: null,
      },
    ]);
  });

  it("computes rank movement relative to the previous rank", () => {
    expect(getLeaderboardRankChange(10, 7)).toBe(3);
    expect(getLeaderboardRankChange(3, 5)).toBe(-2);
    expect(getLeaderboardRankChange(null, 5)).toBeNull();
  });
});
