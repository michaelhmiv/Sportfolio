import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CollectionDetailResponse } from "@shared/collection-api";
import CollectionDetailPage from "@/pages/collection-detail";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";

const requestedTheme = new URLSearchParams(window.location.search).get("theme");
document.documentElement.classList.toggle("dark", requestedTheme !== "light");
window.history.replaceState(
  {},
  "",
  `/collections/fixture-leaders?theme=${requestedTheme ?? "dark"}`,
);

const detail: CollectionDetailResponse = {
  slug: "fixture-leaders",
  definitionId: "definition-fixture",
  sport: "baseball",
  league: "MLB",
  season: "2026",
  family: "Season Leaders",
  kind: "player_slots",
  lifecycleStatus: "tracking",
  versionId: "version-fixture",
  version: 1,
  title: "2026 Strikeout Leaders",
  description: "Allocate shares to the pitchers defining the live strikeout leaderboard.",
  qualificationDescription: "Top MLB strikeout leaders",
  artKey: "mlb-strikeout-leaders-2026",
  state: "tracking",
  assemblyState: "in_progress",
  allocatedQuantity: "0.5000",
  requiredQuantity: "3.0000",
  qualifiedSlotCount: 0,
  requiredSlotCount: 3,
  progressBps: 1667,
  award: null,
  prerequisites: [],
  slots: [
    {
      slotId: "slot-skenes",
      slotKey: "rank-1",
      slotLabel: "Strikeout leader #1",
      requiredQuantity: "1.0000",
      isRequired: true,
      displayOrder: 1,
      rank: 1,
      statKey: "strikeouts",
      qualificationValue: "184",
      qualificationMetadata: null,
      statLabel: "strikeouts",
      allocation: {
        allocationId: "allocation-skenes",
        allocatedQuantity: "0.5000",
        status: "active",
      },
      maxAllocatableQuantity: "1.0000",
      ownedQuantity: "1.0000",
      lockedElsewhereQuantity: "0.0000",
      player: {
        playerId: "player-skenes",
        firstName: "Paul",
        lastName: "Skenes",
        team: "PIT",
        position: "SP",
      },
    },
    {
      slotId: "slot-skubal",
      slotKey: "rank-2",
      slotLabel: "Strikeout leader #2",
      requiredQuantity: "1.0000",
      isRequired: true,
      displayOrder: 2,
      rank: 2,
      statKey: "strikeouts",
      qualificationValue: "178",
      qualificationMetadata: null,
      statLabel: "strikeouts",
      allocation: null,
      maxAllocatableQuantity: "0.0000",
      ownedQuantity: "1.0000",
      lockedElsewhereQuantity: "1.0000",
      player: {
        playerId: "player-skubal",
        firstName: "Tarik",
        lastName: "Skubal",
        team: "DET",
        position: "SP",
      },
    },
    {
      slotId: "slot-crochet",
      slotKey: "rank-3",
      slotLabel: "Strikeout leader #3",
      requiredQuantity: "1.0000",
      isRequired: true,
      displayOrder: 3,
      rank: 3,
      statKey: "strikeouts",
      qualificationValue: "171",
      qualificationMetadata: null,
      statLabel: "strikeouts",
      allocation: null,
      maxAllocatableQuantity: "0.0000",
      ownedQuantity: "0.0000",
      lockedElsewhereQuantity: "0.0000",
      player: {
        playerId: "player-crochet",
        firstName: "Garrett",
        lastName: "Crochet",
        team: "BOS",
        position: "SP",
      },
    },
  ],
};

const user = {
  id: "fixture-user",
  email: "fixture@sportfolio.app",
  username: "Fixture User",
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/user")) {
    return Response.json(user);
  }
  if (url.includes("/api/auth/config")) {
    return Response.json({ url: "https://fixture.supabase.co", anonKey: "fixture-anon-key" });
  }
  if (url.includes("/api/me/collections/fixture-leaders")) {
    return Response.json({ data: detail });
  }
  return nativeFetch(input, init);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <CollectionDetailPage />
    <Toaster />
  </QueryClientProvider>,
);
