import { describe, expect, it } from "vitest";
import { findBestAgentKnowledgeArticle, listAgentKnowledgeArticles } from "./docs-service";

describe("docs-service", () => {
  it("exposes canonical wiki articles flagged for agent grounding", () => {
    const articles = listAgentKnowledgeArticles();

    expect(articles.length).toBeGreaterThan(0);
    expect(articles.some((article) => article.id === "feature-agent-operator")).toBe(true);

    const agentArticle = articles.find((article) => article.id === "feature-agent-operator");

    expect(agentArticle?.urlPath).toBe("/wiki/features/agent-operator");
    expect(agentArticle?.notes.length).toBeGreaterThan(0);
  });

  it("matches the best agent-grounding article for guest topic routing", () => {
    const article = findBestAgentKnowledgeArticle("how do boosts work");

    expect(article).not.toBeNull();
    expect(article?.id).toBe("gameplay-power-boosts");
  });
});
