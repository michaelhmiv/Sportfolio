import { describe, expect, it } from "vitest";
import { advisoryLockKeyPair } from "./advisory-lock-key";

describe("advisoryLockKeyPair", () => {
  it("is deterministic and returns exactly two signed 32-bit integers", () => {
    const identity = "holding-reservation:user-1:mlb:player-641329";
    const first = advisoryLockKeyPair(identity);
    expect(first).toEqual(advisoryLockKeyPair(identity));
    expect(first).toHaveLength(2);
    for (const key of first) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(key).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("does not trivially collapse representative reservation identities", () => {
    const identities = [
      "holding-reservation:user-1:mlb:player-1",
      "holding-reservation:user-1:mlb:player-2",
      "holding-reservation:user-2:mlb:player-1",
      "holding-reservation:user-1:nhl:player-1",
      "holding-reservation:user-1:nascar:driver-1",
    ];
    const pairs = identities.map((identity) => advisoryLockKeyPair(identity).join(":"));
    expect(new Set(pairs).size).toBe(identities.length);
  });

  it("rejects an empty identity", () => {
    expect(() => advisoryLockKeyPair("   ")).toThrow("Advisory lock identity is required");
  });
});
