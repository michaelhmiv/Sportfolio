import { describe, expect, it } from "vitest";

import { USER_ACTIVITY_CATEGORIES } from "@shared/activity-feed";
import type { UserActivityItem } from "@shared/activity-feed";

import {
  buildPortfolioActivityFeedQueryParams,
  buildPortfolioActivitySummary,
  filterPortfolioActivities,
  isActualPortfolioActivity,
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

  it("keeps a real boost action even when its current status is locked", () => {
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
        focus: "gameplay",
        search: "amen",
      }).map((activity) => activity.id),
    ).toEqual(["boost-1"]);
  });

  it("excludes synthetic pending payout snapshots from every Activity Ledger view", () => {
    const pendingPayout = {
      ...baseActivity,
      id: "holder-payout-pending",
      category: "payouts",
      type: "share_payout_pending",
      title: "Holder payout pending",
      description: "Queued holder payout",
      status: "pending",
    } as UserActivityItem;

    expect(isActualPortfolioActivity(pendingPayout)).toBe(false);
    expect(
      filterPortfolioActivities([pendingPayout], {
        category: "all",
        focus: "all",
        search: "",
      }),
    ).toEqual([]);
  });

  it("includes an actual processed holder payout", () => {
    const processedPayout = {
      ...baseActivity,
      id: "holder-payout-processed",
      category: "payouts",
      type: "share_payout_processed",
      title: "Holder payout credited",
      description: "Credited holder payout",
      status: "processed",
      cashDelta: "12.50",
    } as UserActivityItem;

    expect(isActualPortfolioActivity(processedPayout)).toBe(true);
    expect(
      filterPortfolioActivities([processedPayout], {
        category: "payouts",
        focus: "cash",
        search: "credited",
      }),
    ).toEqual([processedPayout]);
  });

  it("counts only actual cash and gameplay activity when server summary is absent", () => {
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
      {
        ...baseActivity,
        id: "pending-1",
        category: "payouts",
        type: "share_payout_pending",
        title: "Holder payout pending",
        description: "Queued payout",
        status: "pending",
      } as UserActivityItem,
    ];

    expect(buildPortfolioActivitySummary(activities)).toEqual({
      total: 3,
      cashCount: 1,
      pendingCount: 0,
      gameplayCount: 2,
    });
  });

  it("zeroes the legacy pending count when a clean server summary is available", () => {
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
      pendingCount: 0,
      gameplayCount: 19,
    });
  });

  it("does not trust server totals when loaded rows contain legacy pending snapshots", () => {
    const pendingPayout = {
      ...baseActivity,
      id: "pending-1",
      category: "payouts",
      type: "share_payout_pending",
      title: "Holder payout pending",
      description: "Queued payout",
      status: "pending",
    } as UserActivityItem;
    const trade = {
      ...baseActivity,
      id: "trade-1",
      category: "market",
      type: "trade_buy",
      title: "Bought shares",
      description: "Bought shares",
      cashDelta: "-10.00",
    } as UserActivityItem;

    expect(
      buildPortfolioActivitySummary([pendingPayout, trade], {
        total: 2,
        cashCount: 1,
        pendingCount: 1,
        gameplayCount: 1,
      }),
    ).toEqual({
      total: 1,
      cashCount: 1,
      pendingCount: 0,
      gameplayCount: 0,
    });
  });
});
