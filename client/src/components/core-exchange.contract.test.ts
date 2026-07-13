import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coreSurfaces = [
  "pages/dashboard.tsx",
  "pages/marketplace.tsx",
  "pages/portfolio.tsx",
  "pages/boosts.tsx",
  "pages/analytics.tsx",
  "pages/leaderboards.tsx",
  "pages/watchlists.tsx",
  "pages/player.tsx",
  "components/player-modal.tsx",
  "components/portfolio-card-view.tsx",
  "components/portfolio-activity-tab.tsx",
  "components/portfolio-stacking-tab.tsx",
  "components/market-mobile-home.tsx",
  "components/market-mobile-pools-board.tsx",
  "components/market-mobile-player-sheet.tsx",
  "components/market-activity-ledger.tsx",
  "components/market-activity-widget.tsx",
  "components/market-ticker.tsx",
  "components/market/market-pulse.tsx",
  "components/game-command-center-card.tsx",
  "components/game-command-center-modal.tsx",
  "components/mlb-gameplay-signals.tsx",
  "components/mlb-player-context-panel.tsx",
] as const;

const hardcodedPalette =
  /(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)(?:-\d+)?(?:\/\d+)?/g;
const hardcodedRadius = /\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b/g;

describe("core exchange visual contract", () => {
  it.each(coreSurfaces)("uses semantic color roles in %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), "client/src", relativePath), "utf8");
    expect(source.match(hardcodedPalette) ?? []).toEqual([]);
    expect(source.match(hardcodedRadius) ?? []).toEqual([]);
  });

  it("preserves distinct semantic multiplier tiers instead of collapsing them to one color", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/components/portfolio-card-view.tsx"),
      "utf8",
    );
    for (const tier of ["standard", "boosted", "elite", "legendary", "mythic"] as const) {
      expect(source).toContain(`bg-tier-${tier}`);
    }
  });

  it("orders MLB game detail by score, exposure, lineups, then collapsed scoring context", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/components/game-command-center-modal.tsx"),
      "utf8",
    );
    const lifecycleStart = source.indexOf("function MlbLifecycleCard");
    const lifecycleEnd = source.indexOf("function GameCommandCenterModal", lifecycleStart);
    const lifecycle = source.slice(lifecycleStart, lifecycleEnd);
    const orderedLabels = [
      "<MlbLinescorePanel",
      "Your exposure",
      "Starting lineups",
      "Scoring summary",
    ];
    const positions = orderedLabels.map((label) => lifecycle.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(lifecycle).toContain("aria-expanded={scoringExpanded}");
    expect(lifecycle).toContain('aria-controls="mlb-scoring-summary"');
    expect(lifecycle).toContain('id="mlb-scoring-summary"');
    expect(lifecycle).toContain("const [scoringExpanded, setScoringExpanded] = useState(false)");
  });

  it("keeps watchlist management reachable and touch-safe without horizontal controls", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/watchlists.tsx"), "utf8");
    expect(source).toContain('aria-label="Add player"');
    expect(source).toContain('aria-label="Edit watchlist"');
    expect(source).toContain('aria-label="Delete watchlist"');
    expect(source).toContain('aria-label="Remove player"');
    expect(source.match(/h-11 w-11 sm:h-8 sm:w-8/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("aria-expanded={expandedListId === list.id}");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).toContain('className="flex min-h-11 flex-1');
    const resultList = source.slice(source.indexOf("searchResults.map"));
    expect(resultList).not.toContain("<PlayerName");
  });

  it("activates class-based dark tokens in the core fixture", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/visual-fixtures/core-exchange.tsx"),
      "utf8",
    );
    expect(source).toContain('document.documentElement.classList.toggle("dark", prefersDark)');
  });
});
