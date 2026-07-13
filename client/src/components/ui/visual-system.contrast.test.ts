import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

type Theme = ":root" | ".dark";
type Hsl = readonly [number, number, number];
type Rgb = readonly [number, number, number];

function extractBlock(selector: Theme) {
  const start = globalCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} token block`);

  let depth = 0;
  for (let index = start; index < globalCss.length; index += 1) {
    if (globalCss[index] === "{") depth += 1;
    if (globalCss[index] === "}") {
      depth -= 1;
      if (depth === 0) return globalCss.slice(start, index + 1);
    }
  }

  throw new Error(`Unclosed ${selector} token block`);
}

function token(theme: Theme, name: string): Hsl {
  const block = extractBlock(theme);
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (match) return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];

  const alias = block.match(new RegExp(`--${name}:\\s*var\\(--([\\w-]+)\\)`));
  if (alias) return token(theme, alias[1]);
  throw new Error(`${theme} is missing a literal or aliased HSL value for --${name}`);
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = l - chroma / 2;
  const [r, g, b] =
    section < 1
      ? [chroma, intermediate, 0]
      : section < 2
        ? [intermediate, chroma, 0]
        : section < 3
          ? [0, chroma, intermediate]
          : section < 4
            ? [0, intermediate, chroma]
            : section < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  return [r + offset, g + offset, b + offset];
}

function luminanceRgb(rgb: Rgb) {
  return rgb
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function luminance(hsl: Hsl) {
  return luminanceRgb(hslToRgb(hsl));
}

function contrast(first: Hsl, second: Hsl) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function composite(foreground: Hsl, background: Hsl, alpha: number): Rgb {
  const foregroundRgb = hslToRgb(foreground);
  const backgroundRgb = hslToRgb(background);
  return foregroundRgb.map(
    (channel, index) => channel * alpha + backgroundRgb[index] * (1 - alpha),
  ) as [number, number, number];
}

function renderedTintContrast(
  theme: Theme,
  foreground: string,
  tint: string,
  backdrop: string,
  alpha = 0.1,
) {
  const renderedBackground = composite(token(theme, tint), token(theme, backdrop), alpha);
  const [light, dark] = [
    luminance(token(theme, foreground)),
    luminanceRgb(renderedBackground),
  ].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const normalTextPairs = [
  ["text", "canvas"],
  ["text-muted", "canvas"],
  ["text-subtle", "canvas"],
  ["brand-foreground", "brand"],
  ["action-primary-foreground", "action-primary"],
  ["action-secondary-foreground", "action-secondary"],
  ["selected-foreground", "selected"],
  ["market-positive", "canvas"],
  ["market-negative", "canvas"],
  ["status-live", "canvas"],
  ["status-upcoming", "canvas"],
  ["status-info", "canvas"],
  ["status-warning", "canvas"],
  ["boost", "canvas"],
  ["boost-foreground", "boost"],
  ["premium", "canvas"],
  ["premium-foreground", "premium"],
  ["text-inverse", "tier-standard"],
  ["text-inverse", "tier-boosted"],
  ["text-inverse", "tier-elite"],
  ["text-inverse", "tier-legendary"],
  ["text-inverse", "tier-mythic"],
  ["category-market", "canvas"],
  ["category-liquidity", "canvas"],
  ["category-stacking", "canvas"],
  ["category-stacking", "hover"],
  ["category-payout", "canvas"],
  ["category-scout", "canvas"],
  ["category-whale", "canvas"],
  ["category-thin-pool", "canvas"],
  ["category-boost", "canvas"],
  ["category-community", "canvas"],
  ["category-momentum", "canvas"],
  ["category-value", "canvas"],
  ["category-pool", "canvas"],
  ["category-ownership", "canvas"],
] as const;

const tintedSurfacePairs = [
  ["boost", "boost", "surface", 0.1],
  ["boost", "boost", "surface", 0.2],
  ["boost", "boost", "canvas", 0.1],
  ["premium", "premium", "surface", 0.1],
  ["market-positive", "market-positive", "surface", 0.1],
  ["market-positive", "market-positive", "canvas", 0.1],
  ["category-boost", "category-boost", "surface", 0.1],
  ["category-boost", "category-boost", "canvas", 0.1],
  ["category-community", "category-community", "surface", 0.1],
  ["category-community", "category-community", "canvas", 0.1],
  ["category-liquidity", "category-liquidity", "surface", 0.1],
  ["category-liquidity", "category-liquidity", "canvas", 0.1],
  ["category-stacking", "category-stacking", "surface", 0.1],
  ["category-stacking", "category-stacking", "canvas", 0.1],
  ["category-payout", "category-payout", "surface", 0.1],
  ["category-payout", "category-payout", "canvas", 0.1],
  ["category-scout", "category-scout", "surface", 0.1],
  ["category-scout", "category-scout", "canvas", 0.1],
  ["category-whale", "category-whale", "surface", 0.1],
  ["category-whale", "category-whale", "canvas", 0.1],
  ["category-momentum", "category-momentum", "surface", 0.1],
  ["category-momentum", "category-momentum", "canvas", 0.1],
  ["category-value", "category-value", "surface", 0.1],
  ["category-value", "category-value", "canvas", 0.1],
  ["category-pool", "category-pool", "surface", 0.1],
  ["category-pool", "category-pool", "canvas", 0.1],
  ["category-ownership", "category-ownership", "surface", 0.1],
  ["category-ownership", "category-ownership", "canvas", 0.1],
  ["category-thin-pool", "category-thin-pool", "surface", 0.1],
  ["category-thin-pool", "category-thin-pool", "canvas", 0.1],
  ["status-live", "status-live", "surface", 0.1],
  ["status-info", "status-info", "surface", 0.1],
  ["status-warning", "status-warning", "surface", 0.1],
] as const;

const renderedCoreSurfaces = [
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

function hasThemeToken(theme: Theme, name: string) {
  try {
    token(theme, name);
    return true;
  } catch {
    return false;
  }
}

function renderedCoreClassPairs(theme: Theme) {
  const pairs: Array<{
    file: string;
    foreground: string;
    background: string;
    alpha: number;
    classValue: string;
  }> = [];

  for (const file of renderedCoreSurfaces) {
    const source = readFileSync(resolve(process.cwd(), "client/src", file), "utf8");
    const classValues = [...source.matchAll(/["'`]([^"'`\n]*(?:bg-|text-)[^"'`\n]*)["'`]/g)].map(
      (match) => match[1],
    );

    for (const classValue of classValues) {
      const foregrounds = [...classValue.matchAll(/(?:^|\s)(?:[\w-]+:)*text-([a-z][\w-]*)/g)]
        .map((match) => match[1])
        .filter((name) => hasThemeToken(theme, name));
      const backgrounds = [
        ...classValue.matchAll(
          /(?:^|\s)(?:[\w-]+:)*bg-([a-z][\w-]*)(?:\/\[?([\d.]+)\]?)?(?=\s|$)/g,
        ),
      ]
        .map((match) => ({
          name: match[1],
          alpha: match[2] ? Number(match[2]) / (Number(match[2]) > 1 ? 100 : 1) : 1,
        }))
        .filter(({ name }) => hasThemeToken(theme, name));

      for (const foreground of foregrounds) {
        for (const background of backgrounds) {
          pairs.push({
            file,
            foreground,
            background: background.name,
            alpha: background.alpha,
            classValue,
          });
        }
      }
    }
  }

  return pairs;
}

describe("Sportfolio semantic color contrast", () => {
  it.each([":root", ".dark"] as const)(
    "keeps product category treatments visually distinct in %s",
    (theme) => {
      const categoryTokens = [
        "category-liquidity",
        "category-stacking",
        "category-boost",
        "category-scout",
        "category-whale",
        "category-thin-pool",
        "category-community",
        "category-momentum",
        "category-ownership",
      ];
      const treatments = categoryTokens.map((name) => token(theme, name).join("/"));
      expect(new Set(treatments).size).toBe(categoryTokens.length);

      const hues = categoryTokens.map((name) => token(theme, name)[0]);
      const hueDistances = hues.flatMap((hue, index) =>
        hues.slice(index + 1).map((otherHue) => {
          const distance = Math.abs(hue - otherHue);
          return Math.min(distance, 360 - distance);
        }),
      );
      expect(Math.min(...hueDistances)).toBeGreaterThanOrEqual(20);
    },
  );

  it.each([":root", ".dark"] as const)("meets WCAG AA text contrast in %s", (theme) => {
    for (const [foreground, background] of normalTextPairs) {
      expect(
        contrast(token(theme, foreground), token(theme, background)),
        `${theme} --${foreground} on --${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([":root", ".dark"] as const)("keeps disabled text visibly distinct in %s", (theme) => {
    expect(
      contrast(token(theme, "disabled-foreground"), token(theme, "disabled")),
      `${theme} disabled foreground/background`,
    ).toBeGreaterThanOrEqual(3);
  });

  it.each([":root", ".dark"] as const)(
    "meets WCAG AA after translucent semantic tints are rendered in %s",
    (theme) => {
      const failures: string[] = [];
      for (const [foreground, tint, backdrop, alpha] of tintedSurfacePairs) {
        const ratio = renderedTintContrast(theme, foreground, tint, backdrop, alpha);
        if (ratio < 4.5) {
          failures.push(
            `${theme} --${foreground} on --${tint}/${alpha * 100} over --${backdrop}: ${ratio.toFixed(3)}:1`,
          );
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each([":root", ".dark"] as const)(
    "keeps same-class semantic text/background combinations at WCAG AA in %s",
    (theme) => {
      const failures = new Set<string>();
      for (const pair of renderedCoreClassPairs(theme)) {
        for (const backdrop of ["canvas", "surface"] as const) {
          const ratio = renderedTintContrast(
            theme,
            pair.foreground,
            pair.background,
            backdrop,
            pair.alpha,
          );
          if (ratio < 4.5) {
            failures.add(
              `${pair.file}: text-${pair.foreground} on bg-${pair.background}/${pair.alpha * 100} over ${backdrop} = ${ratio.toFixed(3)}:1 (${pair.classValue})`,
            );
          }
        }
      }
      expect([...failures]).toEqual([]);
    },
  );

  it.each([":root", ".dark"] as const)(
    "keeps text-content readable on every translucent stacked-share tier in %s",
    (theme) => {
      for (const tier of ["standard", "boosted", "elite", "legendary", "mythic"] as const) {
        expect(
          renderedTintContrast(theme, "text", `tier-${tier}`, "surface", 0.2),
          `${theme} --text on --tier-${tier}/20 over --surface`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
