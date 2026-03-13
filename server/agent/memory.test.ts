import { describe, expect, it } from "vitest";
import { inferMemoryWritesFromMessage } from "./memory";

describe("memory", () => {
  it("captures explicit durable preference statements as memory writes", () => {
    const writes = inferMemoryWritesFromMessage(
      "I prefer focusing on same-day upside and usually want a concise pre-lock rundown.",
    );

    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]?.kind).toBe("habit");
    expect(writes[0]?.scope).toBe("episodic");
    expect(writes[0]?.summary.toLowerCase()).toContain("i prefer");
  });

  it("ignores general chatter that does not express a durable preference", () => {
    const writes = inferMemoryWritesFromMessage("How did Brunson do last night?");

    expect(writes).toHaveLength(0);
  });

  it("captures multiple durable clauses from one message", () => {
    const writes = inferMemoryWritesFromMessage(
      "I usually like concise replies. I'm a fan of the Knicks. I want to focus on lower-risk growth over time.",
    );

    expect(writes.map((entry) => entry.kind)).toEqual([
      "habit",
      "favorite_entities",
      "risk_tolerance",
    ]);
  });

  it("ignores transient execution chatter that should not become profile memory", () => {
    const writes = inferMemoryWritesFromMessage(
      "I want to buy $20 of Brunson tonight and boost him before lock.",
    );

    expect(writes).toHaveLength(0);
  });
});
