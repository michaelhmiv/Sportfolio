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
  "components/portfolio-activity-tab.tsx",
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

const allowedHardcodedRadiusBySurface: Partial<
  Record<(typeof coreSurfaces)[number], readonly string[]>
> = {
  "pages/boosts.tsx": ["rounded-md", "rounded-none"],
};

describe("core exchange visual contract", () => {
  it.each(coreSurfaces)("uses semantic color roles in %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), "client/src", relativePath), "utf8");
    const allowedRadii = new Set(allowedHardcodedRadiusBySurface[relativePath] ?? []);
    const unapprovedRadii = (source.match(hardcodedRadius) ?? []).filter(
      (radius) => !allowedRadii.has(radius),
    );

    expect(source.match(hardcodedPalette) ?? []).toEqual([]);
    expect(unapprovedRadii).toEqual([]);
    expect(source.match(emojiPresentation) ?? []).toEqual([]);
  });

  it("keeps product badges, ownership, and boost chrome off chart-series aliases", () => {
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

    const poolsBoard = read("market-mobile-pools-board.tsx");
    expect(poolsBoard).not.toContain("chart-");
    const chipMap = poolsBoard.slice(
      poolsBoard.indexOf("function getChipClassName"),
      poolsBoard.indexOf("function getFreshnessClassName"),
    );
    expect(chipMap).not.toMatch(/(?:chart-|premium|market-negative)/);
    expect(chipMap).toContain("category-boost");
    expect(chipMap).toContain("category-scout");
    expect(chipMap).toContain("category-whale");
    expect(chipMap).toContain("category-thin-pool");
    expect(chipMap).toContain("category-momentum");

    const compactMap = poolsBoard.slice(
      poolsBoard.indexOf("function getCompactStatusToken"),
      poolsBoard.indexOf("function MarketPlayerCompactRow"),
    );
    expect(compactMap).not.toMatch(/(?:chart-|premium|category-stacking)/);
    for (const role of ["boost", "liquidity", "community"] as const) {
      expect(compactMap).toContain(`category-${role}`);
    }

    const playerSheet = read("market-mobile-player-sheet.tsx");
    expect(playerSheet).not.toContain("chart-");
    expect(playerSheet).not.toContain("category-stacking");
    const playerHeader = playerSheet.slice(
      playerSheet.indexOf("{showBoostContext"),
      playerSheet.indexOf("{quickContext?.isWatchlisted"),
    );
    expect(playerHeader).not.toContain("chart-");
    expect(playerHeader).toContain("category-community");
    expect(playerHeader).toContain("category-momentum");

    const modal = read("game-command-center-modal.tsx");
    expect(modal).not.toContain("chart-");
    expect(modal).not.toContain("category-stacking");
    expect(modal).not.toContain("Your Multiplier Leaders");
    expect(modal).toContain("category-ownership");
    expect(modal).toContain("aria-pressed={selectedTier === tier}");
    expect(modal).toContain("const BOOST_SLOT_TIERS = [10, 7, 5, 3, 2] as const");
    expect(modal).not.toMatch(/hover:bg-tier-(?:boosted|elite|legendary|mythic)\//);

    const card = read("game-command-center-card.tsx");
    expect(card).not.toContain("category-stacking");
    expect(card).not.toContain("Stacked Shares");
    expect(card).toContain("aria-pressed={selectedTier === tier}");
    expect(card).toContain("const BOOST_SLOT_TIERS = [10, 7, 5, 3, 2] as const");
    expect(card).toContain("aria-label={`Open ${game.awayTeam} at ${game.homeTeam} game details`}");
    expect(card).not.toContain(
      'return (\n    <button\n      type="button"\n      onClick={onOpen}',
    );

    const dashboard = readFileSync(
      resolve(process.cwd(), "client/src/pages/dashboard.tsx"),
      "utf8",
    );
    expect(dashboard).not.toContain(
      'slateStatus === "scheduled"\n                          ? "bg-chart-',
    );
    expect(dashboard).not.toMatch(/(?:race|game)MarketStateClass[\s\S]{0,350}text-chart-/);
    expect(dashboard).not.toContain("font-mono text-chart-4");
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
