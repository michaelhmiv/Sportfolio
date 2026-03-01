import { describe, expect, it } from "vitest";
import {
  buildWorkflowPayload,
  getBundlePendingClarification,
  getBundleWorkflowView,
} from "./workflow-bundle";

describe("agent workflow bundle helpers", () => {
  it("builds a clarification workflow with preview steps", () => {
    const payload = buildWorkflowPayload({
      summary: "Need one detail",
      actions: [],
      pendingClarification: {
        kind: "player_name",
        prompt: "Send the full player name.",
        missingFields: ["player_name"],
        originalRequest: "buy 16 jokic shares",
        resumeMessageTemplate: "buy 16 {player} shares",
        workflowTitle: "Build the buy plan",
        workflowPreviewSteps: ["Buy the shares", "Review the position"],
      },
    });

    const view = getBundleWorkflowView({
      rawPayload: payload,
      bundleStatus: "pending_clarification",
    });

    expect(view.workflowType).toBe("clarification");
    expect(view.steps).toHaveLength(2);
    expect(view.steps[0]).toMatchObject({
      status: "needs_clarification",
      title: "Buy the shares",
    });
    expect(view.steps[1]).toMatchObject({
      status: "blocked",
      title: "Review the position",
    });
    expect(getBundlePendingClarification(payload)?.prompt).toBe("Send the full player name.");
  });

  it("maps ready action steps to completed after apply", () => {
    const payload = buildWorkflowPayload({
      summary: "Buy a player",
      actions: [
        {
          actionType: "pool_buy",
          playerId: "nba_star",
          playerName: "Nikola Jokic",
          sbAmount: 100,
          maxSlippage: 0.05,
          reasoning: "Test",
          confidence: 1,
        },
      ],
    });

    const view = getBundleWorkflowView({
      rawPayload: payload,
      bundleStatus: "applied",
    });

    expect(view.workflowType).toBe("single_action");
    expect(view.steps[0]?.status).toBe("completed");
    expect(view.actions[0]).toMatchObject({
      actionType: "pool_buy",
      playerId: "nba_star",
    });
  });
});
