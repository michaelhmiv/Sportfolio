import { describe, expect, it } from "vitest";

import {
  buildStackSharesResponsePayload,
  buildStackSharesSuccessMessage,
} from "./stack-shares-response";

describe("buildStackSharesSuccessMessage", () => {
  it("builds the preferred shares + stack power message", () => {
    const message = buildStackSharesSuccessMessage({
      singlesStacked: 4,
      newStackPower: 10,
    });

    expect(message).toBe("Stacked 4 shares. Stack is now 10p.");
    expect(message.toLowerCase()).not.toContain("undefined");
    expect(message.toLowerCase()).not.toContain("nan");
  });

  it("falls back safely when values are missing", () => {
    const message = buildStackSharesSuccessMessage({
      singlesStacked: 0,
      newStackPower: 0,
    });

    expect(message).toBe("Stack updated successfully.");
  });
});

describe("buildStackSharesResponsePayload", () => {
  it("returns additive stack-power contract fields while preserving legacy keys", () => {
    const response = buildStackSharesResponsePayload({
      sharesStacked: 8,
      multiplier: "7.00",
      newMultiplier: "7.00",
      effectiveSharesBurned: 4,
      holding: { multiplier: "7.00" },
      player: {
        id: "p1",
        firstName: "Amen",
        lastName: "Thompson",
        team: "DET",
      },
    });

    expect(response).toMatchObject({
      success: true,
      multiplier: "7.00",
      newMultiplier: "7.00",
      sharesStacked: 8,
      multiplierGained: "4.00",
      singlesStacked: 8,
      powerAdded: 4,
      newStackPower: 7,
      stackPower: 7,
      effectiveSharesBurned: 4,
    });
    expect(response.message).toBe("Stacked 8 shares. Stack is now 7p.");
  });
});
