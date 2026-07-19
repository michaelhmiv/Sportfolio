import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { CollectionDetailResponse, CollectionListEntry } from "@shared/collection-api";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAuthenticated: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRoute: () => [true, { slug: "test-collection" }],
}));

import CollectionDetailPage from "./collection-detail";
import CollectionsPage from "./collections";

const baseDetail: CollectionDetailResponse = {
  slug: "test-collection",
  definitionId: "definition-1",
  sport: "baseball",
  league: "mlb",
  season: "2026",
  family: "leaders",
  kind: "player_slots",
  lifecycleStatus: "tracking",
  versionId: "version-1",
  version: 1,
  title: "Test Collection",
  description: "Rendered production component",
  qualificationDescription: "",
  artKey: "test",
  state: "tracking",
  assemblyState: "ready",
  allocatedQuantity: "1.0000",
  requiredQuantity: "1.0000",
  qualifiedSlotCount: 1,
  requiredSlotCount: 1,
  progressBps: 10_000,
  award: null,
  slots: [
    {
      slotId: "slot-1",
      slotKey: "slot-1",
      slotLabel: "Leader",
      requiredQuantity: "1.0000",
      isRequired: true,
      displayOrder: 1,
      rank: 1,
      statKey: "home_runs",
      qualificationValue: null,
      qualificationMetadata: null,
      statLabel: null,
      allocation: null,
      maxAllocatableQuantity: "0.5000",
      player: {
        playerId: "player-1",
        firstName: "Aaron",
        lastName: "Judge",
        team: "NYY",
        position: "OF",
      },
    },
  ],
  prerequisites: [],
};

const award = {
  awardId: "award-1",
  firstCompletedAt: "2026-07-01T00:00:00.000Z",
  completionSequence: 1,
};

function renderDetail(detail: CollectionDetailResponse): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["/api/me/collections", "user-1", "test-collection"], detail);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CollectionDetailPage />
    </QueryClientProvider>,
  );
}

function renderList(entries: CollectionListEntry[]): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["/api/me/collections", "user-1"], entries);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CollectionsPage />
    </QueryClientProvider>,
  );
}

describe("production collection page rendering", () => {
  it("renders Complete for a first-time ready collection", () => {
    const html = renderDetail(baseDetail);
    expect(html).toContain("button-complete-collection");
    expect(html).toContain(">Complete<");
    expect(html).not.toContain("button-reactivate-collection");
  });

  it("renders Reactivate for an awarded ready collection", () => {
    const html = renderDetail({ ...baseDetail, award });
    expect(html).toContain("button-reactivate-collection");
    expect(html).toContain(">Reactivate<");
  });

  it("renders active status without another completion action", () => {
    const html = renderDetail({ ...baseDetail, assemblyState: "active", award });
    expect(html).toContain(">Active<");
    expect(html).not.toContain("button-complete-collection");
    expect(html).not.toContain("button-reactivate-collection");
  });

  it("allows allocation controls for an awarded inactive collection", () => {
    const html = renderDetail({
      ...baseDetail,
      assemblyState: "inactive",
      progressBps: 0,
      allocatedQuantity: "0.0000",
      qualifiedSlotCount: 0,
      award,
    });
    expect(html).toContain("button-open-allocation-slot-1");
    expect(html).toContain("Manage allocation for Leader");
    expect(html).not.toContain("input-quantity-slot-1");
  });

  it("gives an unowned required player a direct acquisition action", () => {
    const html = renderDetail({
      ...baseDetail,
      assemblyState: "unstarted",
      progressBps: 0,
      allocatedQuantity: "0.0000",
      qualifiedSlotCount: 0,
      slots: [
        {
          ...baseDetail.slots[0],
          maxAllocatableQuantity: "0.0000",
          ownedQuantity: "0.0000",
          lockedElsewhereQuantity: "0.0000",
        },
      ],
    });

    expect(html).toContain("No shares owned");
    expect(html).toContain("Buy or scout shares");
    expect(html).toContain("button-acquire-slot-1");
  });

  it("explains when owned shares are locked by another collection", () => {
    const html = renderDetail({
      ...baseDetail,
      assemblyState: "unstarted",
      progressBps: 0,
      allocatedQuantity: "0.0000",
      qualifiedSlotCount: 0,
      slots: [
        {
          ...baseDetail.slots[0],
          maxAllocatableQuantity: "0.0000",
          ownedQuantity: "1.0000",
          lockedElsewhereQuantity: "1.0000",
        },
      ],
    });

    expect(html).toContain("Shares locked elsewhere");
    expect(html).toContain("Release shares from another collection or get more");
  });

  it("shows tracking volatility and an exact completion plan", () => {
    const html = renderDetail({
      ...baseDetail,
      assemblyState: "in_progress",
      progressBps: 5000,
      allocatedQuantity: "0.5000",
      qualifiedSlotCount: 0,
      slots: [
        {
          ...baseDetail.slots[0],
          allocation: { allocationId: "a1", allocatedQuantity: "0.5000", status: "active" },
        },
      ],
    });

    expect(html).toContain("0.5 shares still needed across 1 slot");
    expect(html).toContain("Leaderboard membership can change");
    expect(html).toContain("Allocated shares are locked from selling");
  });

  it("opens master prerequisites and offers a direct continue action", () => {
    const html = renderDetail({
      ...baseDetail,
      kind: "master",
      assemblyState: "in_progress",
      slots: [],
      prerequisites: [
        {
          prerequisiteId: "prereq-1",
          slug: "child-set",
          title: "Child Set",
          artKey: "child",
          isRequired: true,
          displayOrder: 1,
          state: { assemblyState: "in_progress", progressBps: 5000 },
        },
      ],
    });

    expect(html).toContain("Child Set");
    expect(html).toContain("Continue Child Set");
    expect(html).toContain('href="/collections/child-set"');
  });

  it("renders an immersive family hero, visual slot cards, and a safe-area sticky action", () => {
    const html = renderDetail(baseDetail);
    expect(html).toContain('data-testid="collection-immersive-hero"');
    expect(html).toContain('data-silhouette="scoreboard"');
    expect(html).toContain('data-testid="collection-slot-card-slot-1"');
    expect(html).toContain('data-testid="collection-mobile-action-bar"');
    expect(html).toContain("safe-area-inset-bottom");
  });

  it("renders exact 99.99 percent progress in the production list", () => {
    const {
      slots: _slots,
      prerequisites: _prerequisites,
      qualificationDescription: _qualification,
      ...entry
    } = {
      ...baseDetail,
      assemblyState: "in_progress" as const,
      progressBps: 9_999,
    };
    const html = renderList([entry]);
    expect(html).toContain("99.99%");
    expect(html).not.toContain("100.00%");
  });

  it("renders an immersive summary, family snap shelves, master prestige, and trophy case", () => {
    const { slots: _s, prerequisites: _p, qualificationDescription: _q, ...baseEntry } = baseDetail;
    const entries: CollectionListEntry[] = [
      { ...baseEntry, slug: "featured", family: "Season Leaders", assemblyState: "ready" },
      {
        ...baseEntry,
        slug: "threshold",
        title: "30/30 Club",
        family: "Threshold Clubs",
        assemblyState: "in_progress",
        progressBps: 5000,
      },
      {
        ...baseEntry,
        slug: "master",
        title: "Master Collection",
        family: "Master",
        kind: "master",
        assemblyState: "unstarted",
        progressBps: 0,
      },
      {
        ...baseEntry,
        slug: "trophy",
        title: "Earned Award",
        family: "Official Awards",
        assemblyState: "inactive",
        award,
      },
    ];

    const html = renderList(entries);
    expect(html).toContain('data-testid="collection-summary-rail"');
    expect(html).toContain("Closest");
    expect(html).toContain('data-testid="collection-advanced-filter-trigger"');
    expect(html).toContain("space-y-3 sm:space-y-5");
    expect(html).toContain("space-y-6 sm:space-y-8");
    expect(html).toContain("min-h-[170px]");
    expect(html).toContain("sm:min-h-[190px]");
    expect(html).toContain('data-testid="family-shelf-threshold-clubs"');
    expect(html).toContain("snap-x");
    expect(html).toContain('data-testid="master-prestige"');
    expect(html).toContain('data-testid="trophy-case"');
  });
});
