// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUserIdentity } from "@shared/public-user-identity";
import Leaderboards from "./leaderboards";

const { mockUseQuery, mockUsePublicIdentities, mockApiRequest } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockUsePublicIdentities: vi.fn(),
  mockApiRequest: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mockUseQuery }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u2", username: "bravo" } }),
}));
vi.mock("@/hooks/usePublicIdentities", () => ({
  usePublicIdentities: mockUsePublicIdentities,
}));
vi.mock("@/lib/websocket", () => ({
  useWebSocket: () => ({ subscribe: () => () => {}, connectionState: "connected" }),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: mockApiRequest,
  queryClient: { invalidateQueries: vi.fn() },
}));

const identity = (userId: string, username: string, withBadge = false): PublicUserIdentity => ({
  userId,
  username,
  avatarUrl: null,
  premiumActive: false,
  activeBadge: withBadge
    ? {
        definitionId: "def-1",
        versionId: "v1",
        slug: "2025-home-run-leaders",
        title: "2025 Home Run Leaders",
        artKey: "mlb-home-runs",
        sport: "MLB",
        league: "MLB",
        season: "2025",
        family: "season_leaders",
        firstCompletedAt: "2026-07-20T00:00:00.000Z",
      }
    : null,
});

const response = {
  category: "netWorth",
  categoryLabel: "Net Worth",
  description: "Overall account standing.",
  unit: "currency",
  updatedAt: "2026-07-24T20:00:00.000Z",
  totalEntries: 2,
  leaderboard: [
    {
      rank: 1,
      userId: "u1",
      username: "alpha",
      profileImageUrl: null,
      value: 125000,
      rankChange: null,
    },
    {
      rank: 2,
      userId: "u2",
      username: "bravo",
      profileImageUrl: null,
      value: 100000,
      rankChange: 1,
    },
  ],
  currentUser: {
    rank: 2,
    userId: "u2",
    username: "bravo",
    profileImageUrl: null,
    value: 100000,
    rankChange: 1,
  },
  currentUserWindow: [],
};

describe("Leaderboards", () => {
  beforeEach(() => {
    window.location.hash = "";
    mockUseQuery.mockReturnValue({
      data: response,
      isLoading: false,
      refetch: vi.fn(),
      isFetching: false,
    });
    mockUsePublicIdentities.mockReturnValue({
      u1: identity("u1", "alpha", true),
      u2: identity("u2", "bravo"),
    });
    mockApiRequest.mockResolvedValue({ json: () => Promise.resolve(response) });
  });

  it("puts the personal rank before one dense identity-aware board", async () => {
    render(<Leaderboards />);

    expect(screen.queryByText("Live Market Rankings")).toBeNull();
    expect(screen.queryByText("Competitors")).toBeNull();
    expect(screen.queryByText("How To Read It")).toBeNull();
    expect(screen.queryByText("Flat")).toBeNull();
    expect(screen.getByLabelText("Movement history unavailable")).toBeTruthy();
    expect(screen.getByTestId("badge-pin").getAttribute("aria-label")).toBe(
      "Badge: 2025 Home Run Leaders",
    );

    const personal = screen.getByTestId("current-user-rank");
    const board = screen.getByTestId("leaderboard-list");
    expect(personal.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId("identity-trigger")[0].className).toContain("min-w-0");
    expect(screen.getAllByTestId("identity-trigger")[0].className).toContain("max-w-full");
    expect(screen.getAllByTestId(/leaderboard-row-/)).toHaveLength(2);
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["/api/leaderboards?category=netWorth", "u2"],
      }),
    );
    await mockUseQuery.mock.calls[0][0].queryFn();
    expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/leaderboards?category=netWorth");
  });

  it("resolves identities for around-me rows outside the top board", () => {
    const nearby = {
      rank: 51,
      userId: "u51",
      username: "nearby",
      profileImageUrl: null,
      value: 25000,
      rankChange: null,
    };
    mockUseQuery.mockReturnValue({
      data: { ...response, currentUserWindow: [response.currentUser, nearby] },
      isLoading: false,
      refetch: vi.fn(),
      isFetching: false,
    });

    render(<Leaderboards />);

    expect(mockUsePublicIdentities).toHaveBeenLastCalledWith(["u1", "u2", "u51"]);
  });

  it("keeps metric controls at mobile touch-target height", () => {
    render(<Leaderboards />);

    const metricGroup = screen.getByRole("group", { name: "Leaderboard metric" });
    for (const button of metricGroup.querySelectorAll("button")) {
      expect(button.className).toContain("min-h-11");
    }
  });
});
