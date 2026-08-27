import {
  USER_ACTIVITY_CATEGORIES,
  UserActivityCategory,
  UserActivityFeedSummary,
  UserActivityItem,
} from "@shared/activity-feed";

export type PortfolioActivityCategoryFilter = "all" | UserActivityCategory;
export type PortfolioActivityFocusFilter = "all" | "cash" | "gameplay";

const GAMEPLAY_CATEGORIES = new Set<UserActivityCategory>([
  "scout",
  "boosts",
  "community",
  "payouts",
]);

export function isActualPortfolioActivity(activity: UserActivityItem) {
  // Pending holder payouts are state snapshots, not completed user/system actions.
  // Keep real actions whose current state may be active/locked (for example a Daily Boost entry).
  return activity.type !== "share_payout_pending";
}

export function buildPortfolioActivityFeedQueryParams(offset: number) {
  return new URLSearchParams({
    limit: "40",
    offset: String(offset),
    types: USER_ACTIVITY_CATEGORIES.join(","),
  });
}

export function filterPortfolioActivities(
  activities: UserActivityItem[],
  filters: {
    category: PortfolioActivityCategoryFilter;
    focus: PortfolioActivityFocusFilter;
    search: string;
  },
) {
  const search = filters.search.trim().toLowerCase();

  return activities.filter((activity) => {
    if (!isActualPortfolioActivity(activity)) {
      return false;
    }

    if (filters.category !== "all" && activity.category !== filters.category) {
      return false;
    }

    if (filters.focus === "cash" && Math.abs(Number(activity.cashDelta || 0)) === 0) {
      return false;
    }

    if (filters.focus === "gameplay" && !GAMEPLAY_CATEGORIES.has(activity.category)) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = [
      activity.title,
      activity.description,
      activity.entity?.label,
      activity.entity?.secondaryLabel,
      activity.context?.summary,
      activity.metadata.playerName,
      activity.metadata.playerTeam,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });
}

export function buildPortfolioActivitySummary(
  activities: UserActivityItem[],
): UserActivityFeedSummary {
  const actualActivities = activities.filter(isActualPortfolioActivity);

  return {
    total: actualActivities.length,
    cashCount: actualActivities.filter((activity) => Math.abs(Number(activity.cashDelta || 0)) > 0)
      .length,
    pendingCount: 0,
    gameplayCount: actualActivities.filter((activity) => GAMEPLAY_CATEGORIES.has(activity.category))
      .length,
  };
}

export function buildPortfolioActivityCategoryCounts(
  activities: UserActivityItem[],
): Partial<Record<UserActivityCategory, number>> {
  const counts: Partial<Record<UserActivityCategory, number>> = {};

  for (const activity of activities) {
    if (!isActualPortfolioActivity(activity)) {
      continue;
    }
    counts[activity.category] = (counts[activity.category] || 0) + 1;
  }

  return counts;
}
