export const LEADERBOARD_CATEGORY_META = {
  netWorth: {
    label: "Net Worth",
    description: "Overall account standing across cash and marked portfolio value.",
    unit: "currency",
  },
  cashBalance: {
    label: "Cash Balance",
    description: "Liquid Sportfolio Bucks currently available on the account.",
    unit: "currency",
  },
  portfolioValue: {
    label: "Portfolio Value",
    description: "Marked value of current player holdings at the latest market prices.",
    unit: "currency",
  },
  tradingVolume24h: {
    label: "Trading Volume (24h)",
    description: "Rolling 24 hour executed notional from market trades.",
    unit: "currency",
  },
  marketOrders: {
    label: "Market Orders",
    description: "Lifetime market-order activity, useful for spotting active traders.",
    unit: "count",
  },
} as const;

export type LeaderboardCategory = keyof typeof LEADERBOARD_CATEGORY_META;
export type LeaderboardUnit = (typeof LEADERBOARD_CATEGORY_META)[LeaderboardCategory]["unit"];

const LEADERBOARD_CATEGORY_ALIASES: Record<string, LeaderboardCategory> = {
  worth: "netWorth",
  networth: "netWorth",
  cash: "cashBalance",
  portfolio: "portfolioValue",
  volume: "tradingVolume24h",
  tradingVolume: "tradingVolume24h",
  tradingVolume24h: "tradingVolume24h",
  sharesMined: "tradingVolume24h",
  marketOrders: "marketOrders",
};

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  value: number;
  rankChange: number | null;
}

export type LeaderboardCandidate = Omit<LeaderboardEntry, "rank"> & { eligible: boolean };

export function isLeaderboardEligibleUser(user: {
  id: string;
  isBot: boolean;
  deletedAt: Date | null;
}): boolean {
  return !user.isBot && !user.deletedAt && user.id !== "dev-user-12345678";
}

export function hasLeaderboardValue(value: number): boolean {
  return value !== 0;
}

export function rankLeaderboardEntries(entries: LeaderboardCandidate[]): LeaderboardEntry[] {
  return entries
    .filter((entry) => entry.eligible && hasLeaderboardValue(entry.value))
    .sort((a, b) => b.value - a.value || a.userId.localeCompare(b.userId))
    .map(({ eligible: _eligible, ...entry }, index) => ({
      ...entry,
      rank: index + 1,
      value: Math.round(entry.value * 100) / 100,
    }));
}

export function normalizeLeaderboardCategory(input?: string | null): LeaderboardCategory | null {
  if (!input) {
    return "netWorth";
  }

  if (input in LEADERBOARD_CATEGORY_META) {
    return input as LeaderboardCategory;
  }

  return LEADERBOARD_CATEGORY_ALIASES[input] || null;
}

export function getLeaderboardRankChange(
  previousRank: number | null | undefined,
  currentRank: number,
): number | null {
  if (!previousRank || previousRank <= 0) {
    return null;
  }

  return previousRank - currentRank;
}

export function buildLeaderboardWindow(
  entries: LeaderboardEntry[],
  currentUserId?: string | null,
  radius = 2,
): LeaderboardEntry[] {
  if (!currentUserId) {
    return [];
  }

  const index = entries.findIndex((entry) => entry.userId === currentUserId);
  if (index === -1) {
    return [];
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(entries.length, index + radius + 1);
  return entries.slice(start, end);
}

export function getLeaderboardMeta(category: LeaderboardCategory) {
  return LEADERBOARD_CATEGORY_META[category];
}
