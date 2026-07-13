import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

type Theme = ":root" | ".dark";
type Hsl = readonly [number, number, number];

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
  const match = extractBlock(theme).match(
    new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  if (!match) throw new Error(`${theme} is missing a literal HSL value for --${name}`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
}

function hslToRgb([h, s, l]: Hsl) {
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

function luminance(hsl: Hsl) {
  return hslToRgb(hsl)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first: Hsl, second: Hsl) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
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
  ["category-payout", "canvas"],
  ["category-scout", "canvas"],
  ["category-whale", "canvas"],
  ["category-thin-pool", "canvas"],
] as const;

describe("Sportfolio semantic color contrast", () => {
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
});
