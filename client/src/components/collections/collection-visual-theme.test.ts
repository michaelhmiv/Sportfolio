import { describe, expect, it } from "vitest";
import { normalizeCollectionFamily, resolveCollectionVisualTheme } from "./collection-visual-theme";

describe("collection visual themes", () => {
  it.each([
    ["Season Leaders", "season-leaders", "scoreboard"],
    ["threshold_clubs", "threshold-clubs", "patch"],
    ["Official Awards", "official-awards", "medallion"],
    ["official-teams", "official-teams", "pennant"],
    ["Post Season", "postseason", "ticket"],
  ] as const)("normalizes %s and resolves its silhouette", (family, normalized, silhouette) => {
    expect(normalizeCollectionFamily(family)).toBe(normalized);
    expect(resolveCollectionVisualTheme({ family, kind: "player_slots" }).silhouette).toBe(
      silhouette,
    );
  });

  it("uses the master crest regardless of family", () => {
    expect(
      resolveCollectionVisualTheme({ family: "Season Leaders", kind: "master" }).silhouette,
    ).toBe("crest");
  });

  it("falls back to a stable collectible poster for unknown or empty families", () => {
    expect(
      resolveCollectionVisualTheme({ family: "Future Stars", kind: "player_slots" }),
    ).toMatchObject({ id: "fallback", silhouette: "poster" });
    expect(resolveCollectionVisualTheme({ family: "", kind: "player_slots" })).toMatchObject({
      id: "fallback",
      silhouette: "poster",
    });
  });

  it("keeps achievement styling separate from premium entitlement styling", () => {
    const theme = resolveCollectionVisualTheme({ family: "Official Awards", kind: "player_slots" });
    expect(`${theme.frameClass} ${theme.artClass}`).not.toContain("premium");
  });
});
