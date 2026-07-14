import { describe, expect, it, vi } from "vitest";
import type { MlbCollectionSource } from "./catalog-importer";
import { createMlbCatalogAdminService } from "./catalog-admin-service";

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
});
