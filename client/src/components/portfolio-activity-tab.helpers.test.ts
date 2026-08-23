import { describe, expect, it } from "vitest";

import { USER_ACTIVITY_CATEGORIES } from "@shared/activity-feed";
import type { UserActivityItem } from "@shared/activity-feed";

import {
  buildPortfolioActivityFeedQueryParams,
  buildPortfolioActivitySummary,
  filterPortfolioActivities,
} from "@/components/portfolio-activity-tab.helpers";

const baseActivity = {
  timestamp: "2026-03-09T12:00:00.000Z",
  balanceAfter: undefined,
  entity: undefined,
  context: undefined,
  metadata: {},
} satisfies Partial<UserActivityItem>;

describe("portfolio activity tab helpers", () => {
  it("requests every supported category in the live portfolio ledger", () => {
    const params = buildPortfolioActivityFeedQueryParams(80);

    expect(params.get("limit")).toBe("40");
    expect(params.get("offset")).toBe("80");
    expect(params.get("types")?.split(",")).toEqual(USER_ACTIVITY_CATEGORIES);
  });

  it("filters by category, focus, and search text", () => {
    const activities: UserActivityItem[] = [
      {
        ...baseActivity,
        id: "trade-1",
        category: "market",
        type: "trade_buy",
        title: "Bought shares",
        description: "Bought 5 shares of Jalen Brunson",
        cashDelta: "-50.00",
        entity: { kind: "player", id: "jalen", label: "Jalen Brunson", href: "/player/jalen" },
        metadata: { playerName: "Jalen Brunson" },
      } as UserActivityItem,
      {
        ...baseActivity,
        id: "boost-1",
        category: "boosts",
        type: "boost_entered",
        title: "Entered daily boost",
        description: "Entered 5x boost on Amen Thompson",
        status: "locked",
        entity: { kind: "boosts", label: "Amen Thompson", href: "/boosts" },
        context: { summary: "5x Daily Boost slot" },
        metadata: { playerName: "Amen Thompson" },
      } as UserActivityItem,
    ];

    expect(
      filterPortfolioActivities(activities, {
        category: "boosts",
        focus: "pending",
        search: "amen",
      }).map((activity) => activity.id),
    ).toEqual(["boost-1"]);
  });

  it("counts cash and gameplay activity when server summary is absent", () => {
    const activities: UserActivityItem[] = [
      {
        ...baseActivity,
        id: "cash-1",
        category: "market",
        type: "trade_sell",
        title: "Sold shares",
        description: "Sold shares",
        cashDelta: "20.00",
      } as UserActivityItem,
      {
        ...baseActivity,
        id: "scout-1",
        category: "scout",
        type: "distribution",
        title: "Scout reward",
        description: "Scout reward",
        status: "processed",
      } as UserActivityItem,
      {
        ...baseActivity,
        id: "boost-1",
        category: "boosts",
        type: "boost_entered",
        title: "Entered daily boost",
        description: "Boost",
        status: "active",
      } as UserActivityItem,
    ];

    expect(buildPortfolioActivitySummary(activities)).toEqual({
      total: 3,
      cashCount: 1,
      pendingCount: 1,
      gameplayCount: 2,
    });
  });

  it("prefers server-provided summary counts when available", () => {
    expect(
      buildPortfolioActivitySummary([], {
        total: 42,
        cashCount: 10,
        pendingCount: 3,
        gameplayCount: 19,
      }),
    ).toEqual({
      total: 42,
      cashCount: 10,
      pendingCount: 3,
      gameplayCount: 19,
    });
  });
});
