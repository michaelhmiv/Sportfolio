import { describe, expect, it } from "vitest";
import {
  buildAgentQuestionRouteCounts,
  buildAgentQuestionSemanticClusters,
  createLocalQuestionEmbedding,
  inferSemanticRouteMatch,
  normalizeAgentQuestionText,
} from "./semantic-router";

describe("semantic-router", () => {
  it("normalizes user questions for repeatable indexing", () => {
    expect(normalizeAgentQuestionText("  Scout the TOP five players today?! ")).toBe(
      "scout the top five players today",
    );
  });

  it("matches semantically similar current-slate questions to the top-target route", () => {
    const match = inferSemanticRouteMatch({
      messageText: "Who are the strongest players on today's slate for scouting?",
    });

    expect(match.route).toBe("top_targets_today");
    expect(match.confidence).toBeGreaterThan(0.66);
  });

  it("matches open-ended scout review questions to the review route", () => {
    const match = inferSemanticRouteMatch({
      messageText: "Walk me through the tradeoffs in my current scouting setup.",
    });

    expect(match.route).toBe("review_setup");
    expect(match.confidence).toBeGreaterThan(0.66);
  });

  it("builds route counts and semantic clusters for nearby prompts", () => {
    const now = new Date();
    const rows = [
      {
        message: "Scout the top five players today",
        createdAt: now,
        semanticRouteHint: "top_targets_today" as const,
      },
      {
        message: "Who are the best players on today's slate?",
        createdAt: new Date(now.getTime() - 1000),
        semanticRouteHint: "top_targets_today" as const,
      },
      {
        message: "Explain the tradeoffs in my current scout setup",
        createdAt: new Date(now.getTime() - 2000),
        semanticRouteHint: "review_setup" as const,
      },
    ];

    const routeCounts = buildAgentQuestionRouteCounts(rows);
    expect(routeCounts[0]).toMatchObject({
      route: "top_targets_today",
      count: 2,
    });

    const clusters = buildAgentQuestionSemanticClusters(
      rows.map((row) => ({
        normalizedText: normalizeAgentQuestionText(row.message),
        message: row.message,
        createdAt: row.createdAt,
        route: row.semanticRouteHint,
        embedding: createLocalQuestionEmbedding(row.message),
      })),
    );

    expect(clusters[0]).toMatchObject({
      route: "top_targets_today",
      count: 2,
    });
  });
});
