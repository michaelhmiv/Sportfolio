import { describe, expect, it } from "vitest";
import { buildToolResultUiBlocks, materializeAgentUiBlocks } from "./ui-blocks";
import type { AgentToolDefinition, HermesRespondResult, HermesStrategyContext } from "./types";

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
      "execution_checklist",
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
            type: "leaderboard_table",
            slot: "chat_inline",
            priority: 1,
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
    expect(blocks[0]?.type).toBe("leaderboard_table");
    expect(blocks[0]?.slot).toBe("chat_inline");
  });
});

describe("buildToolResultUiBlocks", () => {
  it("builds a clickable entity table for ranked native player scans", () => {
    const tool: AgentToolDefinition = {
      toolName: "scan_top_market_opportunities",
      category: "scan",
      description: "Surface ranked market opportunities.",
      whenToUse: ["Use when the user asks who to buy."],
      whenNotToUse: [],
      examplePrompts: ["who should i buy?"],
      requiresConfirmation: false,
      riskLevel: "low",
      presentationProfile: "leaderboard",
      primaryEntityType: "player",
      preferredColumns: ["player", "team", "price", "signal"],
    };

    const blocks = buildToolResultUiBlocks({
      tool,
      conversationMode: "general_chat",
      result: {
        summary: "Surfaced 2 market-facing opportunity candidate(s).",
        context: {
          recommendedTargets: [
            {
              playerId: "player_1",
              name: "Aaron Judge",
              team: "NYY",
              price: 71.25,
              reason: "Power bat with strong matchup context.",
            },
            {
              playerId: "player_2",
              name: "Bobby Witt Jr.",
              team: "KC",
              price: 58.1,
              reason: "Momentum and lineup support.",
            },
          ],
        },
      },
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("entity_table");
    expect(blocks[0]?.props.rows[0]?.cells.player?.entityId).toBe("player_1");
    expect(blocks[0]?.props.rows[0]?.cells.price?.text).toContain("$");
  });

  it("builds a leaderboard table from internal MLB MCP leader rows", () => {
    const tool: AgentToolDefinition = {
      toolName: "mlb_mcp__get_league_leader_data",
      category: "read",
      description: "Read leaderboard data from the internal MLB provider.",
      whenToUse: ["Use when the user asks for MLB leaders."],
      whenNotToUse: [],
      examplePrompts: ["show me MLB OBP leaders"],
      requiresConfirmation: false,
      riskLevel: "low",
      presentationProfile: "leaderboard",
      primaryEntityType: "player",
      preferredColumns: ["rank", "player", "team", "value"],
    };

    const blocks = buildToolResultUiBlocks({
      tool,
      conversationMode: "general_chat",
      result: {
        summary: "Loaded MLB data via get_league_leader_data.",
        context: {
          structuredContent: {
            result: {
              leaders: [
                [1, "Aaron Judge", "NYY", ".441"],
                [2, "Juan Soto", "NYM", ".421"],
              ],
            },
          },
        },
      },
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("leaderboard_table");
    expect(blocks[0]?.props.leaders[0]?.playerName).toBe("Aaron Judge");
    expect(blocks[0]?.props.leaders[0]?.primaryValue).toBe(".441");
  });
});
