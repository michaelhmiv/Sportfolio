import { describe, expect, it } from "vitest";
import { existingSlotMatchesExpected } from "./catalog-repository";

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
});
