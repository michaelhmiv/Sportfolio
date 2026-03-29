import { describe, expect, it } from "vitest";
import { buildDefaultHermesToolAllowlist, normalizeHermesTurnResponse } from "./hermes-client";

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
    expect(result.uiBlocks).toEqual([]);
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

  it("only includes explicitly visible tools in the default allowlist", () => {
    expect(
      buildDefaultHermesToolAllowlist([
        {
          toolName: "get_balance_state",
          category: "read",
          description: "Read balance.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: false,
          riskLevel: "low",
        },
        {
          toolName: "preview_direct_operation",
          category: "plan",
          description: "Stage a move.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: true,
          riskLevel: "medium",
          exposure: "advanced",
        },
        {
          toolName: "internal_only_diagnostic",
          category: "read",
          description: "Internal only.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: false,
          riskLevel: "low",
          exposure: "internal_only",
        },
        {
          toolName: "hidden_fallback_repair",
          category: "memory",
          description: "Fallback repair.",
          whenToUse: [],
          whenNotToUse: [],
          examplePrompts: [],
          requiresConfirmation: false,
          riskLevel: "low",
          exposure: "hidden_fallback",
        },
      ] as any),
    ).toEqual(["get_balance_state", "preview_direct_operation"]);
  });

  it("keeps approved uiBlocks from Hermes responses and drops unknown block types", () => {
    const result = normalizeHermesTurnResponse({
      outcome: "advisory",
      assistantText: "Here is the current plan.",
      uiBlocks: [
        {
          type: "leaderboard_table",
          slot: "chat_inline",
          priority: 10,
          props: {
            statLabel: "Batting average",
            leaders: [
              {
                id: "leader_1",
                rank: 1,
                playerName: "Aaron Judge",
                playerId: "player_1",
                team: "NYY",
                primaryValue: ".341",
              },
            ],
          },
        },
        {
          type: "definitely_not_allowed",
          slot: "chat_header",
          props: {},
        },
      ],
    });

    expect(result.uiBlocks).toEqual([
      {
        type: "leaderboard_table",
        slot: "chat_inline",
        priority: 10,
        props: {
          statLabel: "Batting average",
          leaders: [
            {
              id: "leader_1",
              rank: 1,
              playerName: "Aaron Judge",
              playerId: "player_1",
              team: "NYY",
              primaryValue: ".341",
            },
          ],
        },
      },
    ]);
  });
});
