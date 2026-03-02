import { describe, expect, it } from "vitest";
import { normalizeHermesTurnResponse } from "./hermes-client";

describe("hermes-client", () => {
  it("normalizes sparse Hermes responses into stable arrays", () => {
    const result = normalizeHermesTurnResponse({
      outcome: "advisory",
      assistantText: "Here is your setup review.",
    });

    expect(result.outcome).toBe("advisory");
    expect(result.summary).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.proposedActions).toEqual([]);
    expect(result.proposedMemoryWrites).toEqual([]);
    expect(result.toolTrace).toEqual([]);
  });
});
