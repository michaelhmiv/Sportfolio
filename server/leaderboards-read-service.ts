import { getOrCompute } from "./cache";
import {
  buildLeaderboardWindow,
  getLeaderboardMeta,
  getLeaderboardRankChange,
  normalizeLeaderboardCategory,
  type LeaderboardCategory,
  type LeaderboardEntry,
} from "./leaderboards";
import { storage } from "./storage";

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export type LeaderboardReadResponse = {
  category: LeaderboardCategory;
  categoryLabel: string;
  description: string;
  unit: "currency" | "count";
  updatedAt: string;
  totalEntries: number;
  leaderboard: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
  currentUserWindow: LeaderboardEntry[];
};

export async function getLeaderboardReadResponse(
  categoryInput: string | null | undefined,
  currentUserId?: string | null,
): Promise<LeaderboardReadResponse> {
  const category = normalizeLeaderboardCategory(categoryInput);
  if (!category) {
    const error = new Error("Invalid category") as Error & { code?: string };
    error.code = "invalid_category";
    throw error;
  }

  const result = await getOrCompute(
    `leaderboard:v2:${category}`,
    async () => {
      const meta = getLeaderboardMeta(category);
      const allUsers = await storage.getUsers();
      const rankEntries = (entries: Array<Omit<LeaderboardEntry, "rank">>): LeaderboardEntry[] =>
        entries
          .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username))
          .map((entry, index) => ({
            ...entry,
            rank: index + 1,
            value: roundToTwo(entry.value),
          }));

      let leaderboard: LeaderboardEntry[] = [];

      if (category === "marketOrders") {
        leaderboard = rankEntries(
          allUsers.map((user) => ({
            userId: user.id,
            username: user.username || "Unknown",
            profileImageUrl: user.profileImageUrl || null,
            value: user.totalMarketOrders,
            rankChange: null,
          })),
        );
      } else if (category === "tradingVolume24h") {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const volumeByUser = await storage.getUserTradingVolumeSince(since);
        leaderboard = rankEntries(
          allUsers.map((user) => ({
            userId: user.id,
            username: user.username || "Unknown",
            profileImageUrl: user.profileImageUrl || null,
            value: volumeByUser.get(user.id) || 0,
            rankChange: null,
          })),
        );
      } else {
        const [usersForRanking, latestSnapshotRanks] = await Promise.all([
          storage.getAllUsersForRanking(),
          storage.getLatestSnapshotRanks(),
        ]);
        const userMap = new Map(allUsers.map((user) => [user.id, user]));

        leaderboard = rankEntries(
          usersForRanking.map((userData) => {
            const user = userMap.get(userData.userId);
            const snapshotRank = latestSnapshotRanks.get(userData.userId);
            const cashValue = toNumber(userData.balance);
            const portfolioValue = userData.portfolioValue;
            const netWorthValue = cashValue + portfolioValue;

            let value = netWorthValue;
            let previousRank = snapshotRank?.netWorthRank;
            if (category === "cashBalance") {
              value = cashValue;
              previousRank = snapshotRank?.cashRank;
            } else if (category === "portfolioValue") {
              value = portfolioValue;
              previousRank = snapshotRank?.portfolioRank;
            }

            return {
              userId: userData.userId,
              username: user?.username || "Unknown",
              profileImageUrl: user?.profileImageUrl || null,
              value,
              rankChange: previousRank ?? null,
            };
          }),
        ).map((entry) => ({
          ...entry,
          rankChange: getLeaderboardRankChange(entry.rankChange, entry.rank),
        }));
      }

      return {
        category,
        categoryLabel: meta.label,
        description: meta.description,
        unit: meta.unit,
        updatedAt: new Date().toISOString(),
        totalEntries: leaderboard.length,
        leaderboard,
      };
    },
    30_000,
  );

  const currentUser = currentUserId
    ? result.leaderboard.find((entry) => entry.userId === currentUserId) || null
    : null;

  return {
    ...result,
    currentUser,
    currentUserWindow: buildLeaderboardWindow(result.leaderboard, currentUserId, 2),
  };
}
