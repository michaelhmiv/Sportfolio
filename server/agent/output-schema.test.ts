import { describe, expect, it } from "vitest";
import { parseScoutPlanPayload } from "./output-schema";

describe("output-schema", () => {
  it("accepts a valid structured scout plan payload", () => {
    const parsed = parseScoutPlanPayload({
      replyText: "I found a stronger scout setup.",
      summary: "Shift scouts to the better slate",
      observations: ["Today has a stronger game window"],
      actions: [],
      warnings: [],
    });

    expect(parsed.replyText).toBe("I found a stronger scout setup.");
    expect(parsed.summary).toBe("Shift scouts to the better slate");
  });

  it("rejects malformed structured scout payloads", () => {
    expect(() =>
      parseScoutPlanPayload({
        replyText: "Missing summary",
        observations: [],
        actions: [],
        warnings: [],
      }),
    ).toThrow(/Structured scout plan did not match the required schema/);
  });
});
