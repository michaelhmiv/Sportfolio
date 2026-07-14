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
  /(?:accent|bg|border|caret|decoration|divide|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)(?:-\d+)?(?:\/[\d.\[\]]+)?/g;
const hardcodedRadius =
  /(?:\brounded(?!-)\b|\brounded-\[[^\]]+\]|\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b)/g;
const emojiPresentation = /\p{Extended_Pictographic}/gu;

describe("core exchange visual contract", () => {
  it.each(coreSurfaces)("uses semantic color roles in %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), "client/src", relativePath), "utf8");
    expect(source.match(hardcodedPalette) ?? []).toEqual([]);
    expect(source.match(hardcodedRadius) ?? []).toEqual([]);
    expect(source.match(emojiPresentation) ?? []).toEqual([]);
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

  it("keeps product badges, ownership, stacking, and boost chrome off chart-series aliases", () => {
    const read = (relativePath: string) =>
      readFileSync(resolve(process.cwd(), "client/src/components", relativePath), "utf8");
    const chartAlias = /\b(?:bg|border|fill|stroke|text)-chart-\d\b/g;

    for (const relativePath of [
      "components/game-command-center-card.tsx",
      "components/game-command-center-modal.tsx",
      "components/player-modal.tsx",
      "pages/boosts.tsx",
      "pages/player.tsx",
      "pages/portfolio.tsx",
      "components/portfolio-activity-tab.tsx",
      "components/market-activity-widget.tsx",
      "components/market/market-pulse.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), "client/src", relativePath), "utf8");
      expect(
        source.match(chartAlias) ?? [],
        `${relativePath} reserves chart aliases for charts`,
      ).toEqual([]);
    }

    for (const relativePath of ["market-mobile-home.tsx", "market-mobile-pools-board.tsx"]) {
      const source = read(relativePath);
      expect(source).not.toContain("chart-");
      const chipMap = source.slice(
        source.indexOf("function getChipClassName"),
        source.indexOf("function getFreshnessClassName"),
      );
      expect(chipMap).not.toMatch(/(?:chart-|premium|market-negative)/);
      expect(chipMap).toContain("category-boost");
      expect(chipMap).toContain("category-scout");
      expect(chipMap).toContain("category-whale");
      expect(chipMap).toContain("category-thin-pool");
      expect(chipMap).toContain("category-momentum");
    }

    const poolsBoard = read("market-mobile-pools-board.tsx");
    const compactMap = poolsBoard.slice(
      poolsBoard.indexOf("function getCompactStatusToken"),
      poolsBoard.indexOf("function MarketPlayerCompactRow"),
    );
    expect(compactMap).not.toMatch(/(?:chart-|premium)/);
    for (const role of ["boost", "liquidity", "stacking", "community"] as const) {
      expect(compactMap).toContain(`category-${role}`);
    }

    const playerSheet = read("market-mobile-player-sheet.tsx");
    expect(playerSheet).not.toContain("chart-");
    const playerHeader = playerSheet.slice(
      playerSheet.indexOf("{showBoostContext"),
      playerSheet.indexOf("{quickContext?.isWatchlisted"),
    );
    expect(playerHeader).not.toContain("chart-");
    expect(playerHeader).toContain("category-stacking");
    expect(playerHeader).toContain("category-community");
    expect(playerHeader).toContain("category-momentum");

    const modal = read("game-command-center-modal.tsx");
    expect(modal).not.toContain("chart-");
    expect(modal).toContain("category-ownership");
    expect(modal).toContain("aria-pressed={selectedTier === tier}");
    expect(modal).not.toMatch(/hover:bg-tier-(?:boosted|elite|legendary|mythic)\//);

    const card = read("game-command-center-card.tsx");
    expect(card).toContain("aria-pressed={selectedTier === tier}");
    expect(card).toContain("aria-label={`Open ${game.awayTeam} at ${game.homeTeam} game details`}");
    expect(card).not.toContain(
      'return (\n    <button\n      type="button"\n      onClick={onOpen}',
    );

    const multiplierLeaders = modal.slice(
      modal.indexOf("Your Multiplier Leaders"),
      modal.indexOf("Quick Scout", modal.indexOf("Your Multiplier Leaders")),
    );
    expect(multiplierLeaders).not.toContain("chart-");
    expect(multiplierLeaders).toContain("category-stacking");
    for (const tier of ["boosted", "elite", "legendary", "mythic"] as const) {
      expect(multiplierLeaders).toContain(`tier-${tier}`);
    }

    expect(read("portfolio-card-view.tsx")).not.toContain("chart-");

    const dashboard = readFileSync(
      resolve(process.cwd(), "client/src/pages/dashboard.tsx"),
      "utf8",
    );
    expect(dashboard).not.toContain(
      'slateStatus === "scheduled"\n                          ? "bg-chart-',
    );
    expect(dashboard).not.toMatch(/(?:race|game)MarketStateClass[\s\S]{0,350}text-chart-/);
    expect(dashboard).not.toContain("font-mono text-chart-4");

    const mobileHome = read("market-mobile-home.tsx");
    expect(mobileHome).toContain(
      'label: "Boost Ready",\n        accentClassName: "bg-category-boost"',
    );
    expect(mobileHome).toContain('label: "Watchlist",\n        accentClassName: "bg-selected"');

    const stacking = read("portfolio-stacking-tab.tsx");
    expect(stacking).not.toContain("chart-");
    expect(stacking).toContain('gameStatus === "live") return "text-status-live"');
    expect(stacking).toContain('gameStatus === "upcoming") return "text-status-info"');
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
