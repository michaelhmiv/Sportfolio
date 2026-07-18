import { createRoot } from "react-dom/client";
import { Layers, Sparkles, Trophy } from "lucide-react";
import type { CollectionListEntry } from "@shared/collection-api";
import { CollectionArt } from "@/components/collection-art";
import { FeaturedCollection, Shelf, SummaryRail } from "@/pages/collections";
import "@/index.css";

const award = {
  awardId: "award-42",
  firstCompletedAt: "2026-07-01T00:00:00.000Z",
  completionSequence: 42,
};

const base: CollectionListEntry = {
  slug: "fixture",
  definitionId: "definition-fixture",
  sport: "MLB",
  league: "MLB",
  season: "2026",
  family: "Season Leaders",
  kind: "player_slots",
  lifecycleStatus: "tracking",
  versionId: "version-fixture",
  version: 1,
  title: "League Leaders",
  description: "Collect the players defining this season.",
  artKey: "mlb-leaders-2026",
  state: "tracking",
  assemblyState: "in_progress",
  allocatedQuantity: "7.5000",
  requiredQuantity: "10.0000",
  qualifiedSlotCount: 7,
  requiredSlotCount: 10,
  progressBps: 7500,
  award: null,
};

const collections: CollectionListEntry[] = [
  {
    ...base,
    slug: "ready-leaders",
    title: "2026 League Leaders",
    assemblyState: "ready",
    allocatedQuantity: "10.0000",
    qualifiedSlotCount: 10,
    progressBps: 10_000,
  },
  {
    ...base,
    slug: "thirty-thirty",
    family: "Threshold Clubs",
    title: "30 / 30 Club",
    artKey: "mlb-thirty-thirty-2026",
    progressBps: 6_250,
  },
  {
    ...base,
    slug: "official-award",
    family: "Official Awards",
    title: "Most Valuable Player",
    artKey: "mlb-mvp-2026",
    assemblyState: "unstarted",
    allocatedQuantity: "0.0000",
    qualifiedSlotCount: 0,
    progressBps: 0,
    lifecycleStatus: "final",
    state: "final",
  },
  {
    ...base,
    slug: "official-team",
    family: "Official Teams",
    title: "All-League First Team",
    artKey: "mlb-all-league-2026",
    progressBps: 9_999,
  },
  {
    ...base,
    slug: "postseason",
    family: "Postseason",
    title: "Championship Series Heroes",
    artKey: "mlb-postseason-2026",
    progressBps: 4_000,
  },
  {
    ...base,
    slug: "master",
    family: "Master",
    kind: "master",
    title: "2026 Baseball Master Crest",
    description: "Activate every required collection to complete the season crest.",
    artKey: "mlb-master-2026",
    requiredQuantity: "5.0000",
    allocatedQuantity: "3.0000",
    requiredSlotCount: 5,
    qualifiedSlotCount: 3,
    progressBps: 6_000,
  },
  {
    ...base,
    slug: "earned-inactive",
    family: "Official Awards",
    title: "Historic Slugger Award",
    artKey: "mlb-slugger-award-2026",
    assemblyState: "inactive",
    award,
    progressBps: 8_500,
  },
  {
    ...base,
    slug: "active-trophy",
    family: "Official Teams",
    title: "All-Star Starting Lineup",
    artKey: "mlb-all-star-2026",
    assemblyState: "active",
    award: { ...award, awardId: "award-7", completionSequence: 7 },
    progressBps: 10_000,
  },
];

function CollectionsFixture() {
  const requestedTheme = new URLSearchParams(window.location.search).get("theme");
  document.documentElement.classList.toggle("dark", requestedTheme !== "light");

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-canvas px-3 py-5 text-content sm:px-6 sm:py-8"
      data-testid="collections-fixture"
    >
      <div className="mx-auto max-w-5xl space-y-7">
        <header className="border-b border-border-subtle pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
            Collections
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Build your shelf</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Chase the next set, finish what you started, and display permanent achievements.
          </p>
        </header>

        <SummaryRail collections={collections} />
        <FeaturedCollection collection={collections[0]} />
        <Shelf
          title="Threshold Clubs"
          icon={<Layers className="h-4 w-4" aria-hidden="true" />}
          collections={collections.slice(1, 3)}
          testId="fixture-threshold-shelf"
        />
        <Shelf
          title="Team & Postseason"
          icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          collections={collections.slice(3, 5)}
          testId="fixture-team-shelf"
        />
        <Shelf
          title="Master Collections"
          icon={<Trophy className="h-4 w-4" aria-hidden="true" />}
          collections={[collections[5]]}
          testId="fixture-master-shelf"
        />
        <Shelf
          title="Trophy Case"
          icon={<Trophy className="h-4 w-4" aria-hidden="true" />}
          collections={collections.slice(6)}
          testId="fixture-trophy-shelf"
        />

        <section aria-labelledby="detail-preview" className="space-y-4 pb-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
              Detail preview
            </p>
            <h2 id="detail-preview" className="text-xl font-black">
              Immersive collection hero
            </h2>
          </div>
          <div className="relative overflow-hidden rounded-panel border border-border-strong bg-surface p-5 shadow-medium">
            <div
              className="absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-status-info/10"
              aria-hidden="true"
            />
            <div className="relative flex items-start gap-4">
              <CollectionArt {...collections[1]} size="lg" className="h-36 w-28" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-status-warning">
                  Tracking · 3 slots remaining
                </p>
                <h3 className="mt-2 text-xl font-black">30 / 30 Club</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Membership updates with the live season. Allocate exact shares from each player
                  slot.
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-pill bg-border-subtle">
                  <div className="h-full w-[62.5%] rounded-pill bg-brand" />
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Fully allocated", "More shares needed"].map((state, index) => (
              <article
                key={state}
                className="rounded-panel border border-border-subtle bg-surface p-4 shadow-low"
              >
                <p
                  className={
                    index === 0
                      ? "text-xs font-bold text-status-live"
                      : "text-xs font-bold text-status-warning"
                  }
                >
                  {state}
                </p>
                <h3 className="mt-2 text-base font-black">
                  {index === 0 ? "Aaron Judge" : "Bobby Witt Jr."}
                </h3>
                <p className="text-xs text-muted-foreground">
                  MLB · Position player · 30 HR / 30 SB
                </p>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Required</dt>
                    <dd className="font-mono font-bold">1</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Available</dt>
                    <dd className="font-mono font-bold">{index === 0 ? "1" : "0.5"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Allocated</dt>
                    <dd className="font-mono font-bold">{index === 0 ? "1" : "0"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<CollectionsFixture />);
