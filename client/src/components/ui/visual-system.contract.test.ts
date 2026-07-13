import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const globalCss = readFileSync(resolve(repositoryRoot, "client/src/index.css"), "utf8");
const tailwindConfig = readFileSync(resolve(repositoryRoot, "tailwind.config.ts"), "utf8");

const requiredThemeTokens = [
  "brand",
  "brand-foreground",
  "brand-subtle",
  "canvas",
  "surface",
  "surface-raised",
  "text",
  "text-muted",
  "text-subtle",
  "border-subtle",
  "border-strong",
  "focus-ring",
  "action-primary",
  "action-primary-foreground",
  "action-secondary",
  "action-secondary-foreground",
  "market-positive",
  "market-positive-subtle",
  "market-negative",
  "market-negative-subtle",
  "status-live",
  "status-live-subtle",
  "status-upcoming",
  "status-info",
  "status-warning",
  "status-warning-subtle",
  "boost",
  "boost-subtle",
  "boost-foreground",
  "premium",
  "premium-subtle",
  "premium-foreground",
  "destructive-subtle",
  "disabled",
  "disabled-foreground",
  "disabled-border",
  "status-offline",
  "status-stale",
  "status-reconnecting",
  "status-connected",
  "selected",
  "selected-foreground",
  "selected-border",
  "hover",
  "pressed",
  "skeleton",
  "skeleton-highlight",
  "scrim",
  "overlay-surface",
  "chart-grid",
  "chart-axis",
  "chart-tooltip",
  "chart-series-positive",
  "chart-series-negative",
  "chart-series-live",
  "team-accent",
  "team-accent-foreground",
  "tier-standard",
  "tier-boosted",
  "tier-elite",
  "tier-legendary",
  "tier-mythic",
  "category-market",
  "category-liquidity",
  "category-stacking",
  "category-payout",
  "category-scout",
  "category-whale",
  "category-thin-pool",
  "category-boost",
  "category-community",
  "category-momentum",
  "category-value",
  "category-pool",
];

const requiredGlobalTokens = [
  "radius-control-sm",
  "radius-control",
  "radius-card",
  "radius-pill",
  "radius-circle",
  "motion-fast",
  "motion-standard",
  "motion-slow",
  "ease-standard",
  "ease-emphasized",
  "shadow-none",
  "shadow-low",
  "shadow-medium",
  "shadow-overlay",
];

function extractBlock(selector: string) {
  const start = globalCss.indexOf(`${selector} {`);
  expect(start, `Missing ${selector} token block`).toBeGreaterThanOrEqual(0);

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

describe("Sportfolio visual-system token contract", () => {
  it.each([":root", ".dark"])("defines every semantic theme token in %s", (selector) => {
    const block = extractBlock(selector);

    for (const token of requiredThemeTokens) {
      expect(block, `${selector} is missing --${token}`).toContain(`--${token}:`);
    }
  });

  it("defines shared radius, motion, and elevation tokens", () => {
    const root = extractBlock(":root");

    for (const token of requiredGlobalTokens) {
      expect(root, `:root is missing --${token}`).toContain(`--${token}:`);
    }
  });

  it("maps core market/status intents through CSS variables in Tailwind", () => {
    for (const token of [
      "brand",
      "canvas",
      "surface",
      "surface-raised",
      "market-positive",
      "market-negative",
      "status-live",
      "status-upcoming",
      "status-warning",
      "boost",
      "premium",
      "status-offline",
      "status-stale",
      "status-reconnecting",
      "status-connected",
      "selected",
      "skeleton",
    ]) {
      expect(tailwindConfig, `Tailwind is missing the ${token} semantic alias`).toContain(
        `hsl(var(--${token}) / <alpha-value>)`,
      );
    }

    expect(tailwindConfig).not.toMatch(/positive:\s*["']#/);
    expect(tailwindConfig).not.toMatch(/negative:\s*["']#/);
  });

  it("preserves legacy generic radii and exposes semantic component aliases", () => {
    expect(tailwindConfig).toContain('lg: "0.25rem"');
    expect(tailwindConfig).toContain('md: "0.125rem"');
    expect(tailwindConfig).toContain('sm: "0rem"');
    expect(tailwindConfig).toContain('panel: "var(--radius-card)"');
    expect(tailwindConfig).toContain('control: "var(--radius-control)"');
    expect(tailwindConfig).toContain('compact: "var(--radius-control-sm)"');
  });

  it("maps distinct multiplier tiers through semantic aliases", () => {
    for (const tier of ["standard", "boosted", "elite", "legendary", "mythic"] as const) {
      expect(tailwindConfig).toContain(`${tier}: "hsl(var(--tier-${tier}) / <alpha-value>)"`);
    }
  });
});
