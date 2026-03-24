import { describe, expect, it } from "vitest";
import { analyzeScoutAgentInputSchema } from "./service";

describe("service input contract", () => {
  it("accepts null runtime context blocks for ordinary chat-thread turns", () => {
    const parsed = analyzeScoutAgentInputSchema.parse({
      message: "review my setup",
      threadId: "thread_1",
      strategyContext: null,
      triggerContext: null,
      executionContext: null,
    });

    expect(parsed.strategyContext).toBeNull();
    expect(parsed.triggerContext).toBeNull();
    expect(parsed.executionContext).toBeNull();
  });
});
