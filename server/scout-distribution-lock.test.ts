import { describe, expect, it } from "vitest";
import { deriveScoutDistributionAdvisoryLockKeys } from "./scout-distribution-lock";

describe("deriveScoutDistributionAdvisoryLockKeys", () => {
  it("is deterministic and returns signed 32-bit integers", () => {
    const first = deriveScoutDistributionAdvisoryLockKeys(
      "2026-08-04T17:00:00.000Z|mlb_641329|user_1",
    );
    const second = deriveScoutDistributionAdvisoryLockKeys(
      "2026-08-04T17:00:00.000Z|mlb_641329|user_1",
    );
    expect(first).toEqual(second);
    for (const key of first) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-2147483648);
      expect(key).toBeLessThanOrEqual(2147483647);
    }
  });

  it("separates distinct claim events", () => {
    expect(deriveScoutDistributionAdvisoryLockKeys("event-a")).not.toEqual(
      deriveScoutDistributionAdvisoryLockKeys("event-b"),
    );
  });

  it("rejects an empty event key", () => {
    expect(() => deriveScoutDistributionAdvisoryLockKeys("   ")).toThrow("event key is required");
  });
});
