import { describe, expect, it } from "vitest";
import { normalizeHoldingLockQuantity } from "./holding-lock-quantity";

describe("normalizeHoldingLockQuantity", () => {
  it("accepts and formats exact decimal quantities", () => {
    expect(normalizeHoldingLockQuantity(0.0001)).toBe("0.0001");
    expect(normalizeHoldingLockQuantity(0.125)).toBe("0.1250");
    expect(normalizeHoldingLockQuantity(1.2345)).toBe("1.2345");
    expect(normalizeHoldingLockQuantity(0.1 + 0.2)).toBe("0.3000");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-positive or non-finite quantity %s",
    (quantity) => {
      expect(() => normalizeHoldingLockQuantity(quantity)).toThrow(
        "Lock quantity must be a positive finite number",
      );
    },
  );

  it("rejects quantities with precision beyond four decimal places or that normalize to zero", () => {
    expect(() => normalizeHoldingLockQuantity(0.12345)).toThrow(
      "Lock quantity supports at most four decimal places",
    );
    expect(() => normalizeHoldingLockQuantity(1e-10)).toThrow(
      "Lock quantity supports at most four decimal places",
    );
  });

  it("rejects quantities outside numeric(20,4)", () => {
    expect(() => normalizeHoldingLockQuantity(10 ** 16)).toThrow(
      "Lock quantity exceeds numeric(20,4)",
    );
  });
});
