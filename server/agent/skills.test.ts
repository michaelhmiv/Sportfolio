import { describe, expect, it } from "vitest";
import { matchAgentSkill } from "./skills";

describe("skills", () => {
  it("matches a relevant runtime skill from prior trigger examples", () => {
    const result = matchAgentSkill("run that same boost workflow again", [
      {
        id: "skill_1",
        scope: "user",
        status: "active",
        userId: "user_1",
        name: "repeat boost workflow",
        description: "reuses the multi-action boost planner",
        triggerExamples: ["run that same boost workflow again"],
        toolSequence: [
          {
            stepType: "tool_call",
            toolCategory: "plan",
            toolName: "preview_multi_action_bundle",
            argumentTemplate: {},
          },
        ],
        clarificationStrategy: {},
        constraints: { signature: "sig" },
        confidence: 0.9,
        sourceThreadId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      },
    ]);

    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
    expect(result?.skillId).toBe("skill_1");
  });

  it("does not match when the prompt does not overlap an available skill", () => {
    const result = matchAgentSkill("what happened in the news today?", [
      {
        id: "skill_1",
        scope: "user",
        status: "active",
        userId: "user_1",
        name: "repeat boost workflow",
        description: "reuses the multi-action boost planner",
        triggerExamples: ["run that same boost workflow again"],
        toolSequence: [
          {
            stepType: "tool_call",
            toolCategory: "plan",
            toolName: "preview_multi_action_bundle",
            argumentTemplate: {},
          },
        ],
        clarificationStrategy: {},
        constraints: { signature: "sig" },
        confidence: 0.9,
        sourceThreadId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      },
    ]);

    expect(result).toBeNull();
  });
});
