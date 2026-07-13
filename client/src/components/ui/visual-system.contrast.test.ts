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
  const match = extractBlock(theme).match(
    new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  if (!match) throw new Error(`${theme} is missing a literal HSL value for --${name}`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
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
  ["category-payout", "canvas"],
  ["category-scout", "canvas"],
  ["category-whale", "canvas"],
  ["category-thin-pool", "canvas"],
  ["category-boost", "canvas"],
  ["category-community", "canvas"],
  ["category-momentum", "canvas"],
  ["category-value", "canvas"],
  ["category-pool", "canvas"],
] as const;

const tintedSurfacePairs = [
  ["boost", "boost", "surface"],
  ["premium", "premium", "surface"],
  ["category-boost", "category-boost", "surface"],
  ["category-community", "category-community", "surface"],
  ["category-payout", "category-payout", "surface"],
  ["category-momentum", "category-momentum", "surface"],
  ["category-value", "category-value", "surface"],
  ["category-pool", "category-pool", "surface"],
  ["category-thin-pool", "category-thin-pool", "surface"],
  ["status-live", "status-live", "surface"],
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

  it.each([":root", ".dark"] as const)(
    "meets WCAG AA after translucent semantic tints are rendered in %s",
    (theme) => {
      for (const [foreground, tint, backdrop] of tintedSurfacePairs) {
        expect(
          renderedTintContrast(theme, foreground, tint, backdrop),
          `${theme} --${foreground} on --${tint}/10 over --${backdrop}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
