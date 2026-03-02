import { describe, expect, it } from "vitest";
import { findBestAgentKnowledgeArticle, listAgentKnowledgeArticles } from "./docs-service";

describe("docs-service", () => {
  it("exposes canonical wiki articles flagged for agent grounding", () => {
    const articles = listAgentKnowledgeArticles();

    expect(articles.length).toBeGreaterThan(0);
    expect(articles.some((article) => article.id === "feature-sms-agent")).toBe(true);

    const agentArticle = articles.find((article) => article.id === "feature-sms-agent");

    expect(agentArticle?.urlPath).toBe("/wiki/features/sms-agent");
    expect(agentArticle?.notes.length).toBeGreaterThan(0);
  });

  it("matches the best agent-grounding article for guest topic routing", () => {
    const article = findBestAgentKnowledgeArticle("how do i link my phone number by text");

    expect(article).not.toBeNull();
    expect(article?.id).toBe("feature-sms-agent");
  });

  it("keeps guest agent grounding scoped to the public article set", () => {
    const guestArticles = listAgentKnowledgeArticles(false);
    const authenticatedArticles = listAgentKnowledgeArticles(true);

    expect(guestArticles.length).toBeGreaterThan(0);
    expect(authenticatedArticles.length).toBeGreaterThanOrEqual(guestArticles.length);
    expect(
      guestArticles.every((article) =>
        authenticatedArticles.some((entry) => entry.id === article.id),
      ),
    ).toBe(true);
  });
});
