import { describe, expect, it } from "vitest";
import type { MlbCatalogPreview } from "./catalog-preview";
import { planMembershipRefresh } from "./membership-plan";

function preview(
  members: Array<{ mlbamId: number; playerId: string; playerName?: string }>,
): MlbCatalogPreview {
  return {
    ok: true,
    definition: {
      slug: "2026-mlb-home-run-leaders",
      title: "2026 MLB Home Run Leaders",
      description: "Tracking",
      sport: "MLB",
      league: "MLB",
      season: "2026",
      family: "season_leaders",
      lifecycle: "tracking",
      kind: "player_slots",
      slotQuantity: 50,
      rule: {
        type: "season_rank",
        season: 2026,
        group: "hitting",
        statKey: "homeRuns",
        sortStat: "homeRuns",
        top: 10,
        direction: "desc",
      },
    },
    members: members.map((member, index) => ({
      mlbamId: member.mlbamId,
      playerId: member.playerId,
      playerName: member.playerName || member.playerId,
      position: "OF",
      rank: index + 1,
      statKey: "homeRuns",
      qualificationValue: String(30 - index),
      sourceMetadata: { verified: true },
    })),
    errors: [],
    sourceSnapshot: {
      importedAt: "2026-07-14T00:00:00.000Z",
      memberCount: members.length,
      sha256: "a".repeat(64),
    },
  };
}

describe("planMembershipRefresh", () => {
  it("preserves unchanged slot identities while refreshing source metadata", () => {
    const plan = planMembershipRefresh(preview([{ mlbamId: 1, playerId: "mlb_1" }]), [
      {
        id: "slot-1",
        slotKey: "mlbam:1",
        playerId: "mlb_1",
        requiredQuantity: "50.0000",
        status: "active",
      },
    ]);

    expect(plan).toMatchObject({
      added: 0,
      removed: 0,
      replaced: 0,
      invalidatedSlotIds: [],
      changed: false,
    });
    expect(plan.slots[0]).toMatchObject({
      existingSlotId: "slot-1",
      qualificationMetadata: { mlbamId: 1, position: "OF", verified: true },
    });
  });

  it("releases removed and replaced memberships but never redirects allocations", () => {
    const plan = planMembershipRefresh(
      preview([
        { mlbamId: 1, playerId: "canonical-new" },
        { mlbamId: 3, playerId: "mlb_3" },
      ]),
      [
        {
          id: "slot-1",
          slotKey: "mlbam:1",
          playerId: "canonical-old",
          requiredQuantity: "50.0000",
          status: "active",
        },
        {
          id: "slot-2",
          slotKey: "mlbam:2",
          playerId: "mlb_2",
          requiredQuantity: "50.0000",
          status: "active",
        },
      ],
    );

    expect(plan).toMatchObject({ added: 1, removed: 1, replaced: 1, changed: true });
    expect(plan.invalidatedSlotIds).toEqual(["slot-1", "slot-2"]);
    expect(plan.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ existingSlotId: "slot-1", playerId: "canonical-new" }),
        expect.objectContaining({ existingSlotId: null, playerId: "mlb_3" }),
      ]),
    );
  });

  it("refuses failed previews", () => {
    const failed = preview([]);
    failed.ok = false;
    failed.errors = [{ code: "SOURCE_COUNT_MISMATCH", message: "missing" }];
    expect(() => planMembershipRefresh(failed, [])).toThrow("Cannot plan failed preview");
  });
});
