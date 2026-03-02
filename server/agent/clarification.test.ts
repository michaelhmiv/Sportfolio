import { describe, expect, it } from "vitest";
import {
  buildPlayerNameClarification,
  hydrateClarificationMessage,
  parsePendingClarification,
  shouldTreatAsClarificationReply,
} from "./clarification";

describe("agent clarification helpers", () => {
  it("builds and hydrates a player-name clarification", () => {
    const clarification = buildPlayerNameClarification({
      prompt: "Send the full player name.",
      originalRequest: "buy 16 jokic shares",
      resumeMessageTemplate: "buy 16 {player} shares",
      workflowTitle: "Build a buy plan",
      workflowPreviewSteps: ["Buy the shares", "Review the position"],
    });

    expect(clarification).toMatchObject({
      kind: "player_name",
      missingFields: ["player_name"],
      workflowTitle: "Build a buy plan",
      workflowPreviewSteps: ["Buy the shares", "Review the position"],
    });
    expect(hydrateClarificationMessage(clarification, "Nikola Jokic")).toBe(
      "buy 16 Nikola Jokic shares",
    );
  });

  it("parses a clarification payload stored under pendingClarification", () => {
    const parsed = parsePendingClarification({
      pendingClarification: {
        kind: "player_name",
        prompt: "Send the full player name.",
        missingFields: ["player_name"],
        originalRequest: "buy 16 jokic shares",
        resumeMessageTemplate: "buy 16 {player} shares",
        workflowTitle: "Build a buy plan",
        workflowPreviewSteps: ["Buy the shares", "Review the position"],
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.resumeMessageTemplate).toContain("{player}");
    expect(parsed?.workflowPreviewSteps).toHaveLength(2);
  });

  it("only treats short non-operational replies as clarification answers", () => {
    const clarification = buildPlayerNameClarification({
      prompt: "Send the full player name.",
      originalRequest: "buy 16 jokic shares",
      resumeMessageTemplate: "buy 16 {player} shares",
    });

    expect(shouldTreatAsClarificationReply(clarification, "Nikola Jokic")).toBe(true);
    expect(shouldTreatAsClarificationReply(clarification, "buy 10 more shares")).toBe(false);
  });
});
