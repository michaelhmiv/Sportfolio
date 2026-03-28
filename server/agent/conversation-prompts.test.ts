import { describe, expect, it } from "vitest";
import { buildHermesConversationPrompts } from "./conversation-prompts";

describe("conversation-prompts", () => {
  it("keeps general chat prompting focused on one-off help", () => {
    const prompts = buildHermesConversationPrompts({
      baseSystemPrompt: "You are Hermes.",
      baseUserPromptTemplate: "Operate on my portfolio.",
      conversationMode: "general_chat",
    });

    expect(prompts.systemPrompt).toContain("general Hermes chat");
    expect(prompts.systemPrompt).toContain("goal_strip");
    expect(prompts.userPromptTemplate).toBe("Operate on my portfolio.");
  });

  it("builds refinement prompts that carry existing strategy context forward", () => {
    const prompts = buildHermesConversationPrompts({
      baseSystemPrompt: "You are Hermes.",
      baseUserPromptTemplate: "Operate on my portfolio.",
      conversationMode: "strategy_refinement",
      strategyContext: {
        strategyId: "strategy_1",
        sourceThreadId: "thread_1",
        status: "live",
        mandate: "Buy the strongest movers every morning.",
        normalizedRuleSheet: {
          timeline: {
            objective: "Buy the strongest movers every morning.",
            currentStageId: "stage_1",
            stages: [
              {
                id: "stage_1",
                title: "Morning review",
                status: "active",
                actionScope: ["pool_buy"],
                triggerPolicy: {
                  kind: "recurring_cron",
                  anchor: "daily_at_time",
                  scheduleCron: "0 8 * * *",
                  timezone: "America/New_York",
                },
              },
            ],
          },
        },
        guardrails: {
          maxActionsPerRun: 1,
        },
        reviewState: {
          status: "pending",
          reviewedAt: null,
          lastMaterialUpdateAt: "2026-03-21T10:00:00.000Z",
          summary: "Review the saved playbook before it goes live again.",
        },
      },
    });

    expect(prompts.systemPrompt).toContain("editing an existing Sportfolio strategy");
    expect(prompts.systemPrompt).toContain("Buy the strongest movers every morning.");
    expect(prompts.systemPrompt).toContain("Current strategy status: live.");
    expect(prompts.systemPrompt).toContain("waiting for user review");
    expect(prompts.systemPrompt).toContain("Current active stage: Morning review");
    expect(prompts.systemPrompt).toContain("free available cash");
    expect(prompts.systemPrompt).toContain("Never initiate payments");
    expect(prompts.systemPrompt).toContain("Never use community boosts");
    expect(prompts.systemPrompt).toContain("portfolio-management tasks");
    expect(prompts.systemPrompt).toContain("dense mobile layouts");
    expect(prompts.userPromptTemplate).toContain("update the existing saved strategy");
  });

  it("adds the MLB fallback note when advanced MLB MCP tools are unavailable", () => {
    const prompts = buildHermesConversationPrompts({
      baseSystemPrompt: "You are Hermes.",
      baseUserPromptTemplate: "Operate on my portfolio.",
      conversationMode: "general_chat",
      mlbMcpAvailable: false,
    });

    expect(prompts.systemPrompt).toContain("MLB MCP advanced tools are currently offline");
    expect(prompts.systemPrompt).toContain("scan_team_roster");
    expect(prompts.systemPrompt).toContain("scan_sport_slate");
  });

  it("nudges Hermes toward built-in MLB MCP tools when they are available", () => {
    const prompts = buildHermesConversationPrompts({
      baseSystemPrompt: "You are Hermes.",
      baseUserPromptTemplate: "Operate on my portfolio.",
      conversationMode: "general_chat",
      mlbMcpAvailable: true,
    });

    expect(prompts.systemPrompt).toContain("built-in mlb_mcp__ tools");
    expect(prompts.systemPrompt).toContain("get_schedule");
    expect(prompts.systemPrompt).toContain("Statcast pitcher expected-stats");
  });
});
