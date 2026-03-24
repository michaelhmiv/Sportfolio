import { describe, expect, it } from "vitest";
import { materializeAgentUiBlocks } from "./ui-blocks";
import type { HermesRespondResult, HermesStrategyContext } from "./types";

function buildResult(overrides: Partial<HermesRespondResult> = {}): HermesRespondResult {
  return {
    outcome: "advisory",
    assistantText: "Hermes reviewed the strategy and is ready for the next step.",
    summary: "Review the saved strategy",
    warnings: [],
    proposedActions: [],
    pendingClarification: null,
    citations: [],
    proposedMemoryWrites: [],
    toolTrace: [],
    toolCallsUsed: [],
    skillsUsed: [],
    createdSkillCandidates: [],
    requiresConfirmation: false,
    confirmationPreview: null,
    ...overrides,
  };
}

function buildStrategyContext(
  overrides: Partial<HermesStrategyContext> = {},
): HermesStrategyContext {
  return {
    strategyId: "strategy-1",
    sourceThreadId: "thread-1",
    status: "draft",
    mandate: "Buy the strongest movers each morning",
    normalizedRuleSheet: {
      timeline: {
        objective: "Buy the strongest movers each morning",
        currentStageId: "stage_1",
        stages: [
          {
            id: "stage_1",
            title: "Morning review",
            status: "active",
            actionScope: ["pool_buy", "pool_sell"],
            triggerPolicy: {
              kind: "recurring_cron",
              anchor: "daily_at_time",
              scheduleCron: "0 8 * * *",
              timezone: "America/New_York",
            },
          },
        ],
      },
      executionEnvelope: {
        allowedActionTypes: ["pool_buy", "pool_sell"],
        guardrails: {
          maxActionsPerRun: 1,
          maxActionsPerDay: 3,
        },
      },
      missingDetails: ["sport filter"],
    },
    guardrails: {
      maxActionsPerRun: 1,
      maxActionsPerDay: 3,
    },
    reviewState: {
      status: "pending",
      reviewedAt: null,
      lastMaterialUpdateAt: "2026-03-21T10:00:00.000Z",
      summary: "Review the saved playbook before activation.",
    },
    ...overrides,
  };
}

describe("materializeAgentUiBlocks", () => {
  it("builds rich strategy builder blocks when Hermes did not emit any", () => {
    const blocks = materializeAgentUiBlocks({
      result: buildResult(),
      conversationMode: "strategy_builder",
      strategyContext: buildStrategyContext(),
    });

    expect(blocks.map((block) => block.type)).toEqual([
      "goal_strip",
      "pending_decision",
      "strategy_draft",
      "schedule_summary",
      "rules_summary",
      "run_summary",
    ]);
  });

  it("keeps normalized Hermes-emitted blocks when present", () => {
    const blocks = materializeAgentUiBlocks({
      result: buildResult({
        uiBlocks: [
          {
            type: "goal_strip",
            slot: "chat_header",
            priority: 1,
            props: {
              title: "Use the current slate",
            },
          },
          {
            type: "not_real",
            slot: "chat_header",
            props: {},
          } as unknown as HermesRespondResult["uiBlocks"][number],
        ],
      }),
      conversationMode: "general_chat",
      strategyContext: null,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("goal_strip");
    expect(blocks[0]?.slot).toBe("chat_header");
  });
});
