import type {
  UserActivityCategory,
  UserActivityFeedSummary,
  UserActivityItem,
} from "@shared/activity-feed";

export type PortfolioActivityCategoryFilter = "all" | UserActivityCategory;
export type PortfolioActivityFocusFilter = "all" | "cash" | "pending" | "gameplay";

const PENDING_STATUSES = new Set(["pending", "active", "locked"]);
const GAMEPLAY_CATEGORIES = new Set<UserActivityCategory>([
  "scout",
  "stacking",
  "boosts",
  "community",
  "payouts",
]);

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
    if (filters.category !== "all" && activity.category !== filters.category) {
      return false;
    }

    if (filters.focus === "cash" && Math.abs(Number(activity.cashDelta || 0)) === 0) {
      return false;
    }

    if (
      filters.focus === "pending" &&
      !PENDING_STATUSES.has(String(activity.status || "").toLowerCase())
    ) {
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
  summary?: UserActivityFeedSummary,
): UserActivityFeedSummary {
  if (summary) {
    return summary;
  }

  return {
    total: activities.length,
    cashCount: activities.filter((activity) => Math.abs(Number(activity.cashDelta || 0)) > 0)
      .length,
    pendingCount: activities.filter((activity) =>
      PENDING_STATUSES.has(String(activity.status || "").toLowerCase()),
    ).length,
    gameplayCount: activities.filter((activity) => GAMEPLAY_CATEGORIES.has(activity.category))
      .length,
  };
}
