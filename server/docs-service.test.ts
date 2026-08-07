import { describe, expect, it } from "vitest";
import {
  findBestKnowledgeArticle,
  getDocsHandbook,
  listKnowledgeArticles,
  searchDocsArticles,
} from "./docs-service";

describe("docs-service", () => {
  it("builds the public handbook in the fixed section order with access first", () => {
    const handbook = getDocsHandbook(false);

    expect(handbook.sections.length).toBeGreaterThan(0);
    expect(handbook.sections[0]?.id).toBe("getting-started");
    expect(handbook.sections[0]?.chapters[0]?.slug).toBe("access");
    expect(handbook.sections[0]?.chapters.some((chapter) => chapter.slug === "mcp-access")).toBe(
      true,
    );
    expect(handbook.sections[0]?.chapters[0]?.title).toBe("How to Access Sportfolio");
  });

  it("assigns unique handbook anchors for chapters and headings", () => {
    const handbook = getDocsHandbook(false);
    const anchorIds = new Set<string>();

    for (const section of handbook.sections) {
      expect(anchorIds.has(section.anchorId)).toBe(false);
      anchorIds.add(section.anchorId);

      for (const chapter of section.chapters) {
        expect(anchorIds.has(chapter.chapterAnchorId)).toBe(false);
        anchorIds.add(chapter.chapterAnchorId);

        for (const heading of chapter.headings) {
          expect(anchorIds.has(heading.id)).toBe(false);
          anchorIds.add(heading.id);
        }
      }
    }
  });

  it("keeps authenticated handbook visibility at least as broad as the guest handbook", () => {
    const guestChapterIds = new Set(
      getDocsHandbook(false).sections.flatMap((section) =>
        section.chapters.map((chapter) => chapter.id),
      ),
    );
    const authenticatedChapterIds = new Set(
      getDocsHandbook(true).sections.flatMap((section) =>
        section.chapters.map((chapter) => chapter.id),
      ),
    );

    expect(authenticatedChapterIds.size).toBeGreaterThanOrEqual(guestChapterIds.size);
    expect([...guestChapterIds].every((chapterId) => authenticatedChapterIds.has(chapterId))).toBe(
      true,
    );
  });

  it("returns chapter anchors in docs search results", () => {
    const results = searchDocsArticles("mcp cli access", false);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.anchorId).toMatch(/^chapter-/);
    expect(results.some((result) => result.slug === "access")).toBe(true);
    expect(results.some((result) => result.slug === "mcp-access")).toBe(true);
  });

  it("exposes canonical wiki articles for knowledge grounding", () => {
    const articles = listKnowledgeArticles();

    expect(articles.length).toBeGreaterThan(0);
    expect(articles.every((article) => article.urlPath.startsWith("/wiki/"))).toBe(true);
  });

  it("matches the best knowledge article for MCP access", () => {
    const article = findBestKnowledgeArticle("how do i connect through mcp");

    expect(article).not.toBeNull();
    expect(article?.urlPath).toMatch(/^\/wiki\//);
  });

  it("keeps guest knowledge grounding scoped to the public article set", () => {
    const guestArticles = listKnowledgeArticles(false);
    const authenticatedArticles = listKnowledgeArticles(true);

    expect(guestArticles.length).toBeGreaterThan(0);
    expect(authenticatedArticles.length).toBeGreaterThanOrEqual(guestArticles.length);
    expect(
      guestArticles.every((article) =>
        authenticatedArticles.some((entry) => entry.id === article.id),
      ),
    ).toBe(true);
  });
});
