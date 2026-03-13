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
    expect(result.toolCallsUsed).toEqual([]);
    expect(result.skillsUsed).toEqual([]);
    expect(result.createdSkillCandidates).toEqual([]);
    expect(result.skillMatchRationale).toBeNull();
    expect(result.fallbackUsed).toBe(false);
    expect(result.terminationReason).toBeNull();
    expect(result.compressionApplied).toBe(false);
    expect(result.repairAttempts).toBe(0);
    expect(result.providerFailureClass).toBeNull();
    expect(result.memoryInfluences).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.confirmationPreview).toBeNull();
  });

  it("rejects malformed proposed memory writes from the sidecar payload", () => {
    expect(() =>
      normalizeHermesTurnResponse({
        outcome: "advisory",
        assistantText: "Here is your setup review.",
        proposedMemoryWrites: [
          {
            scope: "unknown",
            kind: "preference",
            summary: "I prefer same-day moves.",
            content: { statement: "I prefer same-day moves." },
            confidence: 0.8,
            reason: "Captured a durable preference.",
          },
        ],
      }),
    ).toThrow();
  });
});
