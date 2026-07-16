import { describe, expect, it } from "vitest";
import { INITIAL_MLB_CATALOG } from "./initial-catalog";

describe("initial MLB collection catalog", () => {
  it("contains the approved 15 final, 7 tracking, and 3 master definitions", () => {
    const playerDefinitions = INITIAL_MLB_CATALOG.filter(
      (definition) => definition.kind === "player_slots",
    );
    const masters = INITIAL_MLB_CATALOG.filter((definition) => definition.kind === "master");

    expect(playerDefinitions.filter((definition) => definition.lifecycle === "final")).toHaveLength(
      15,
    );
    expect(
      playerDefinitions.filter((definition) => definition.lifecycle === "tracking"),
    ).toHaveLength(7);
    expect(masters).toHaveLength(3);
  });

  it("uses unique stable slugs and positive version configuration", () => {
    const slugs = INITIAL_MLB_CATALOG.map((definition) => definition.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const definition of INITIAL_MLB_CATALOG) {
      expect(definition.sport).toBe("MLB");
      expect(definition.season).toMatch(/^202[56]$/);
      if (definition.kind === "player_slots") {
        expect(definition.slotQuantity).toBeGreaterThan(0);
      } else {
        expect(definition.prerequisiteSlugs.length).toBeGreaterThan(0);
      }
    }
  });

  it("matches the approved quantities and source families", () => {
    const bySlug = new Map(INITIAL_MLB_CATALOG.map((definition) => [definition.slug, definition]));

    expect(bySlug.get("2025-mlb-home-run-leaders")).toMatchObject({
      slotQuantity: 50,
      lifecycle: "final",
      rule: { type: "season_rank", statKey: "homeRuns", top: 10 },
    });
    expect(bySlug.get("2025-mlb-30-home-run-club")).toMatchObject({
      slotQuantity: 20,
      expectedMemberCount: 33,
      rule: { type: "threshold", statKey: "homeRuns", minimum: 30 },
    });
    expect(bySlug.get("2025-mlb-silver-slugger-winners")).toMatchObject({
      slotQuantity: 30,
      rule: { type: "awards", awardIds: ["ALSS", "NLSS"] },
    });
    expect(bySlug.get("2025-mlb-postseason-home-run-leaders")).toMatchObject({
      slotQuantity: 35,
      rule: { gameType: "P" },
    });
  });

  it("models the masters as the approved prerequisite graph", () => {
    const bySlug = new Map(INITIAL_MLB_CATALOG.map((definition) => [definition.slug, definition]));

    expect(bySlug.get("2025-mlb-batting-leaders-master")).toMatchObject({
      kind: "master",
      prerequisiteSlugs: [
        "2025-mlb-home-run-leaders",
        "2025-mlb-rbi-leaders",
        "2025-mlb-ops-leaders",
        "2025-mlb-stolen-base-leaders",
      ],
    });
    expect(bySlug.get("2025-mlb-pitching-leaders-master")).toMatchObject({
      kind: "master",
      prerequisiteSlugs: [
        "2025-mlb-strikeout-leaders",
        "2025-mlb-era-leaders",
        "2025-mlb-saves-leaders",
      ],
    });
    expect(bySlug.get("2025-mlb-season-leaders-master")).toMatchObject({
      kind: "master",
      prerequisiteSlugs: ["2025-mlb-batting-leaders-master", "2025-mlb-pitching-leaders-master"],
    });
  });
});
