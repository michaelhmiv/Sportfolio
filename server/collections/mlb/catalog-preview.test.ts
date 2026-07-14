import { describe, expect, it, vi } from "vitest";
import type { MlbCollectionSource } from "./catalog-importer";
import { catalogConfirmationSha256, previewMlbCatalogDefinition } from "./catalog-preview";
import { INITIAL_MLB_CATALOG } from "./initial-catalog";

function sourceWithTenHitters(): MlbCollectionSource {
  return {
    fetchSeasonStats: vi.fn(async ({ season }) =>
      Array.from({ length: 10 }, (_, index) => ({
        season: String(season),
        player: { id: 1000 + index, fullName: `Player ${index + 1}` },
        stat: { homeRuns: 50 - index },
      })),
    ),
    fetchAwardRecipients: vi.fn(async () => []),
  };
}

describe("MLB catalog preview", () => {
  it("imports, resolves, validates, and snapshots a player definition", async () => {
    const definition = INITIAL_MLB_CATALOG.find(
      (candidate) => candidate.slug === "2025-mlb-home-run-leaders",
    )!;
    const resolver = vi.fn(async (members) => ({
      members: members.map((member: { mlbamId: number }) => ({
        ...member,
        playerId: `mlb_${member.mlbamId}`,
      })),
      errors: [],
    }));

    const result = await previewMlbCatalogDefinition(definition, {
      source: sourceWithTenHitters(),
      resolveMembers: resolver,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.members).toHaveLength(10);
    expect(result.errors).toEqual([]);
    expect(result.sourceSnapshot).toMatchObject({
      importedAt: "2026-07-14T00:00:00.000Z",
      memberCount: 10,
    });
    expect(result.sourceSnapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when imported players cannot resolve to tradeable pools", async () => {
    const definition = INITIAL_MLB_CATALOG.find(
      (candidate) => candidate.slug === "2025-mlb-home-run-leaders",
    )!;
    const result = await previewMlbCatalogDefinition(definition, {
      source: sourceWithTenHitters(),
      resolveMembers: vi.fn(async () => ({
        members: [],
        errors: [
          {
            code: "PLAYER_NOT_FOUND" as const,
            mlbamId: 1000,
            requestedPlayerId: "mlb_1000",
            message: "Player 1 is not seeded",
          },
        ],
      })),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: "PLAYER_NOT_FOUND" })]);
  });

  it("previews master definitions without importing player members", async () => {
    const definition = INITIAL_MLB_CATALOG.find(
      (candidate) => candidate.slug === "2025-mlb-season-leaders-master",
    )!;
    const source = sourceWithTenHitters();

    const result = await previewMlbCatalogDefinition(definition, {
      source,
      resolveMembers: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(result.members).toEqual([]);
    expect(source.fetchSeasonStats).not.toHaveBeenCalled();
  });

  it("fails closed when immutable source membership misses its vetted exact count", async () => {
    const definition = {
      ...INITIAL_MLB_CATALOG.find((candidate) => candidate.slug === "2025-mlb-home-run-leaders")!,
      expectedMemberCount: 11,
    };
    if (definition.kind !== "player_slots") throw new Error("expected player definition");
    const result = await previewMlbCatalogDefinition(definition, {
      source: sourceWithTenHitters(),
      resolveMembers: vi.fn(async (members) => ({
        members: members.map((member) => ({ ...member, playerId: `mlb_${member.mlbamId}` })),
        errors: [],
      })),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "SOURCE_COUNT_MISMATCH" }),
    );
  });

  it("changes confirmation hashes for slot quantity and master prerequisite changes", async () => {
    const source = sourceWithTenHitters();
    const resolveMembers = vi.fn(async (members) => ({
      members: members.map((member) => ({ ...member, playerId: `mlb_${member.mlbamId}` })),
      errors: [],
    }));
    const player = INITIAL_MLB_CATALOG.find(
      (candidate) => candidate.slug === "2025-mlb-home-run-leaders",
    )!;
    if (player.kind !== "player_slots") throw new Error("expected player definition");
    const master = INITIAL_MLB_CATALOG.find(
      (candidate) => candidate.slug === "2025-mlb-season-leaders-master",
    )!;
    if (master.kind !== "master") throw new Error("expected master definition");

    const [basePlayer, changedQuantity, baseMaster, changedPrerequisite] = await Promise.all([
      previewMlbCatalogDefinition(player, { source, resolveMembers }),
      previewMlbCatalogDefinition(
        { ...player, slotQuantity: player.slotQuantity + 1 },
        { source, resolveMembers },
      ),
      previewMlbCatalogDefinition(master, { source, resolveMembers }),
      previewMlbCatalogDefinition(
        { ...master, prerequisiteSlugs: [...master.prerequisiteSlugs, "another-master"] },
        { source, resolveMembers },
      ),
    ]);

    expect(basePlayer.sourceSnapshot.sha256).not.toBe(changedQuantity.sourceSnapshot.sha256);
    expect(baseMaster.sourceSnapshot.sha256).not.toBe(changedPrerequisite.sourceSnapshot.sha256);
    expect(catalogConfirmationSha256([basePlayer, baseMaster])).not.toBe(
      catalogConfirmationSha256([changedQuantity, changedPrerequisite]),
    );
  });
});
