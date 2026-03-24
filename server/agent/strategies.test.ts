import { describe, expect, it } from "vitest";
import {
  AGENT_STRATEGY_SLOT_LIMITS,
  assertCanActivateStrategy,
  assertCanSaveStrategy,
  buildNormalizedStrategyRuleSheet,
} from "./strategies";

describe("strategies", () => {
  it("builds a normalized Hermes-facing rule sheet from saved strategy context", () => {
    const ruleSheet = buildNormalizedStrategyRuleSheet({
      threadId: "thread_1",
      threadTitle: "Daily Movers",
      threadDomain: "sportfolio",
      name: "Daily Movers",
      summary: "Track and trade the strongest daily movers.",
      mandateText: "Focus on buying the top movers every day.",
      latestUserInstruction: "Keep buying the top movers every morning.",
      latestHermesUpdate: "The top movers remain concentrated in tonight's slate.",
      pendingBundleSummary: "Deploy idle balance into the top movers board",
      scheduleCron: "0 8 * * *",
      eventSubscriptions: ["schedule", "research_refresh"],
      allowedActionTypes: ["pool_buy", "pool_sell"],
      guardrails: {
        maxActionsPerRun: 1,
        maxActionsPerDay: 3,
      },
    });

    expect(ruleSheet).toMatchObject({
      strategyName: "Daily Movers",
      mandate: "Focus on buying the top movers every day.",
      reviewState: {
        status: "pending",
      },
      thread: {
        id: "thread_1",
        title: "Daily Movers",
        domain: "sportfolio",
      },
      triggerPolicy: {
        scheduleCron: "0 8 * * *",
        eventSubscriptions: ["schedule", "research_refresh"],
      },
      executionEnvelope: {
        allowedActionTypes: ["pool_buy", "pool_sell"],
      },
      timeline: {
        currentStageId: "stage_1",
        stages: [
          expect.objectContaining({
            id: "stage_1",
            title: "Scheduled review",
          }),
          expect.objectContaining({
            triggerPolicy: expect.objectContaining({
              anchor: "research_refresh",
            }),
          }),
        ],
      },
    });
  });

  it("enforces the saved strategy slot cap", () => {
    expect(() => assertCanSaveStrategy(AGENT_STRATEGY_SLOT_LIMITS.maxSaved - 1)).not.toThrow();
    expect(() => assertCanSaveStrategy(AGENT_STRATEGY_SLOT_LIMITS.maxSaved)).toThrow(
      /saved strategies/i,
    );
  });

  it("enforces the single live strategy slot cap", () => {
    expect(() => assertCanActivateStrategy(AGENT_STRATEGY_SLOT_LIMITS.maxLive - 1)).not.toThrow();
    expect(() => assertCanActivateStrategy(AGENT_STRATEGY_SLOT_LIMITS.maxLive)).toThrow(
      /live at a time/i,
    );
  });
});
