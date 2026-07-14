import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "./catalog-preview";
import {
  existingSlotMatchesExpected,
  persistedInitialManifestMatchesExpected,
} from "./catalog-repository";

describe("initial MLB catalog retry validation", () => {
  it("rejects an optional persisted slot as an incomplete requirement", () => {
    expect(
      existingSlotMatchesExpected(
        {
          playerId: "mlb_1",
          slotKey: "mlbam:1",
          requiredQuantity: "50.0000",
          isRequired: false,
          status: "active",
        },
        {
          playerId: "mlb_1",
          slotKey: "mlbam:1",
          requiredQuantity: "50.0000",
        },
      ),
    ).toBe(false);
  });

  it("accepts only the exact persisted manifest with the confirmed catalog hash", () => {
    const manifest = {
      definition: { slug: "mlb-2026-home-runs" },
      version: { state: "tracking" },
      slots: [{ slotKey: "mlbam:1", displayOrder: 0 }],
      prerequisites: [],
    };
    const manifestSha256 = canonicalSha256(manifest);

    expect(
      persistedInitialManifestMatchesExpected(
        manifest,
        "catalog-sha",
        manifestSha256,
        "catalog-sha",
      ),
    ).toBe(true);
    expect(
      persistedInitialManifestMatchesExpected(manifest, undefined, manifestSha256, "catalog-sha"),
    ).toBe(false);
    expect(
      persistedInitialManifestMatchesExpected(
        { ...manifest, slots: [] },
        "catalog-sha",
        manifestSha256,
        "catalog-sha",
      ),
    ).toBe(false);
  });
});
