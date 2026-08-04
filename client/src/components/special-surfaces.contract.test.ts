import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const specialSurfaces = [
  "pages/premium.tsx",
  "components/scout-widget.tsx",
  "components/scout-selector.tsx",
  "components/scout-live-ticker.tsx",
  "components/scout-live-share-popup-host.tsx",
  "components/scout-dashboard-modal.tsx",
  "components/collections/collection-progress.tsx",
  "components/collections/collection-list.tsx",
  "components/collections/collection-ceremony.tsx",
  "components/collections/collection-badge.tsx",
  "components/milestones/milestone-badge.tsx",
  "components/milestones/milestone-ceremony.tsx",
  "components/ceremonies/scout-ready-banner.tsx",
  "components/ceremonies/scout-ceremony-overlay.tsx",
  "components/ceremonies/boost-ceremony-overlay.tsx",
  "components/ceremonies/boost-results-podium.tsx",
  "components/market/whale-alert-banner.tsx",
] as const;

const ceremonySurfaces = [
  "components/collections/collection-ceremony.tsx",
  "components/milestones/milestone-ceremony.tsx",
  "components/ceremonies/scout-ceremony-overlay.tsx",
  "components/ceremonies/boost-ceremony-overlay.tsx",
] as const;

const source = (file: string) => readFileSync(resolve(process.cwd(), "client/src", file), "utf8");

const hardcodedPalette =
  /(?:bg|text|border|ring|fill|stroke|shadow|from|via|to)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)(?:-[0-9]+)?(?:\/[\d.\[\]]+)?/g;
const hardcodedHex = /#[\da-f]{3,8}\b/gi;
const hardcodedRadius =
  /(?:\brounded(?!-)\b|\brounded-\[[^\]]+\]|\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b)/g;
const emoji = /\p{Extended_Pictographic}/u;

const findings = (pattern: RegExp, value: string) => value.match(pattern) ?? [];

describe("special-feature visual-system contract", () => {
  it.each(specialSurfaces)("keeps %s on semantic colors and shapes", (file) => {
    const contents = source(file);
    expect(findings(hardcodedPalette, contents)).toEqual([]);
    expect(findings(hardcodedHex, contents)).toEqual([]);
    expect(findings(hardcodedRadius, contents)).toEqual([]);
    expect(contents).not.toMatch(emoji);
  });

  it.each(ceremonySurfaces)("keeps %s finite and reduced-motion safe", (file) => {
    const contents = source(file);
    expect(contents).toContain("useReducedMotion");
    expect(contents).not.toContain("repeat: Infinity");
    expect(contents).not.toContain("Math.random");
    expect(contents).toContain('aria-label="Close');
  });

  it("keeps edge-to-edge keyboard resize and no-history Android back navigation safe", () => {
    const app = source("App.tsx");
    const config = readFileSync(resolve(process.cwd(), "capacitor.config.ts"), "utf8");
    expect(config).toContain("resizeOnFullScreen: true");
    expect(config).toContain('style: "DEFAULT"');
    expect(app).toContain('navigate("/");');
  });

  it("does not expose scout database diagnostics in production UI", () => {
    const contents = source("components/scout-dashboard-modal.tsx");
    expect(contents).not.toContain("/api/debug/db-check");
    expect(contents).not.toContain("DB Count (Cade)");
  });
});
