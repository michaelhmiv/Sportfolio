import { describe, expect, it, vi } from "vitest";
import type { MlbCollectionSource } from "./catalog-importer";
import { createMlbCatalogAdminService, existingInitialPublication } from "./catalog-admin-service";
import { initialDefinitionManifestSha256 } from "./catalog-preview";
import { INITIAL_MLB_CATALOG } from "./initial-catalog";

function sourceWithTenHitters(): MlbCollectionSource {
  return {
    fetchSeasonStats: vi.fn(async ({ season }) =>
      Array.from({ length: 10 }, (_, index) => ({
        season: String(season),
        player: { id: 8000 + index, fullName: `Player ${index + 1}` },
        stat: { homeRuns: 50 - index },
      })),
    ),
    fetchAwardRecipients: vi.fn(async () => []),
  };
}

describe("MLB catalog admin service", () => {
  it("rejects a tracking refresh when the confirmed source snapshot is stale", async () => {
    const collections = {
      reconcile: vi.fn(),
      reconcileCandidates: vi.fn(),
      reconcileCandidatesInTransaction: vi.fn(),
    };
    const publisher = { publish: vi.fn() };
    const service = createMlbCatalogAdminService({
      source: sourceWithTenHitters(),
      resolveMembers: vi.fn(async (members) => ({
        members: members.map((member) => ({ ...member, playerId: `mlb_${member.mlbamId}` })),
        errors: [],
      })),
      collections,
      publisher,
    });

    await expect(service.refresh("2026-mlb-home-run-leaders", "0".repeat(64))).rejects.toThrow(
      "source snapshot no longer matches the confirmed preview",
    );
    expect(collections.reconcileCandidates).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("recognizes an exact persisted initial catalog before re-fetching live tracking data", () => {
    const rows = INITIAL_MLB_CATALOG.map((definition) => {
      const sourceSnapshot = {
        importedAt: "2026-07-14T00:00:00.000Z",
        memberCount: 0,
        sha256: "confirmed-source",
        ...(definition.kind === "master"
          ? {
              prerequisiteVersions: definition.prerequisiteSlugs.map((slug) => ({
                slug,
                version: 1,
              })),
            }
          : {}),
      };
      const manifestPrerequisites =
        definition.kind === "master"
          ? definition.prerequisiteSlugs.map((slug, displayOrder) => ({
              slug,
              version: 1,
              isRequired: true,
              displayOrder,
            }))
          : [];
      return {
        slug: definition.slug,
        season: definition.season,
        family: definition.family,
        kind: definition.kind,
        sport: definition.sport,
        league: definition.league,
        current_version: 1,
        lifecycle_status: definition.lifecycle,
        version_state: definition.lifecycle === "tracking" ? "tracking" : "final",
        title: definition.title,
        description: definition.description,
        qualification_description: definition.description,
        qualification_rules:
          definition.kind === "player_slots"
            ? definition.rule
            : { prerequisiteSlugs: definition.prerequisiteSlugs },
        source_type:
          definition.kind === "player_slots" ? "mlb_statsapi" : "collection_prerequisites",
        source_uri: definition.kind === "player_slots" ? "https://statsapi.mlb.com/api/v1" : null,
        art_key: definition.slug,
        source_metadata: {
          ...sourceSnapshot,
          initialCatalogSha256: "confirmed",
          initialDefinitionManifestSha256: initialDefinitionManifestSha256({
            ok: true,
            definition,
            members: [],
            errors: [],
            sourceSnapshot,
          }),
        },
        manifest_slots: [],
        manifest_prerequisites: manifestPrerequisites,
        active_slot_count: 0,
        prerequisite_count: manifestPrerequisites.length,
      };
    });

    expect(existingInitialPublication(rows, "confirmed")).toMatchObject({
      status: "already_published",
      definitionCount: INITIAL_MLB_CATALOG.length,
    });
    expect(() => existingInitialPublication(rows, "different")).toThrow(
      "does not match the confirmed persisted manifest",
    );

    const master = rows.find((row) => row.kind === "master")!;
    master.manifest_prerequisites = master.manifest_prerequisites.map((prerequisite, index) =>
      index === 0 ? { ...prerequisite, version: 2 } : prerequisite,
    );
    expect(() => existingInitialPublication(rows, "confirmed")).toThrow(
      "does not match the confirmed persisted manifest",
    );
  });
});
