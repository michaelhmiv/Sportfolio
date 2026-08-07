import { describe, expect, it } from "vitest";
import {
  getDocsChapterAnchorId,
  getDocsChapterHeadingAnchorId,
  getDocsSectionAnchorId,
  type DocsHandbook,
  type DocsSearchResult,
} from "@shared/docs";
import {
  flattenHandbookChapters,
  getDefaultOpenHandbookSectionIds,
  getHandbookMatchState,
  getHandbookSectionIdForAnchor,
  getLegacyWikiHref,
  getRequiredOpenHandbookSectionIds,
} from "@/features/wiki/handbook";

const handbook: DocsHandbook = {
  title: "Sportfolio Handbook",
  summary: "Canonical docs",
  chapterCount: 2,
  sections: [
    {
      id: "getting-started",
      label: "Getting Started",
      anchorId: getDocsSectionAnchorId("getting-started"),
      chapters: [
        {
          id: "getting-started-access",
          title: "How to Access Sportfolio",
          summary: "Access paths",
          excerpt: "Web, wiki, CLI, and MCP status.",
          category: "getting-started",
          section: "getting-started",
          slug: "access",
          urlPath: "/wiki/getting-started/access",
          chapterAnchorId: getDocsChapterAnchorId("getting-started", "access"),
          lastReviewedAt: "2026-03-07",
          headings: [
            {
              depth: 2,
              text: "MCP status",
              id: getDocsChapterHeadingAnchorId("getting-started", "access", "MCP status"),
            },
          ],
          bodyMarkdown: "## MCP status",
          searchKeywords: ["mcp", "access", "cli"],
        },
      ],
    },
    {
      id: "cli",
      label: "CLI",
      anchorId: getDocsSectionAnchorId("cli"),
      chapters: [
        {
          id: "cli-overview",
          title: "CLI and External Access",
          summary: "CLI usage",
          excerpt: "Use docs, portfolio, actions, and tools commands.",
          category: "cli",
          section: "cli",
          slug: "overview",
          urlPath: "/wiki/cli/overview",
          chapterAnchorId: getDocsChapterAnchorId("cli", "overview"),
          lastReviewedAt: "2026-03-07",
          headings: [],
          bodyMarkdown: "",
          searchKeywords: ["cli", "portfolio", "actions"],
        },
      ],
    },
  ],
};

describe("wiki handbook helpers", () => {
  it("builds legacy wiki deep links into handbook anchors", () => {
    expect(getLegacyWikiHref("getting-started")).toBe("/wiki#section-getting-started");
    expect(getLegacyWikiHref("getting-started", "access")).toBe(
      "/wiki#chapter-getting-started-access",
    );
    expect(getLegacyWikiHref("getting-started", "access", "#mcp-status")).toBe(
      "/wiki#chapter-getting-started-access-mcp-status",
    );
  });

  it("flattens handbook chapters in section order", () => {
    expect(flattenHandbookChapters(handbook).map((chapter) => chapter.id)).toEqual([
      "getting-started-access",
      "cli-overview",
    ]);
  });

  it("opens the first section by default when there is no active anchor", () => {
    const openSectionIds = getDefaultOpenHandbookSectionIds(handbook, null);

    expect(Array.from(openSectionIds)).toEqual(["getting-started"]);
  });

  it("maps section, chapter, and heading anchors back to the owning section", () => {
    expect(getHandbookSectionIdForAnchor(handbook, getDocsSectionAnchorId("getting-started"))).toBe(
      "getting-started",
    );
    expect(getHandbookSectionIdForAnchor(handbook, getDocsChapterAnchorId("cli", "overview"))).toBe(
      "cli",
    );
    expect(
      getHandbookSectionIdForAnchor(
        handbook,
        getDocsChapterHeadingAnchorId("getting-started", "access", "MCP status"),
      ),
    ).toBe("getting-started");
  });

  it("marks matched sections, chapters, and headings from search state", () => {
    const searchResults: DocsSearchResult[] = [
      {
        id: "getting-started-access",
        title: "How to Access Sportfolio",
        summary: "Access paths",
        category: "getting-started",
        section: "getting-started",
        slug: "access",
        urlPath: "/wiki/getting-started/access",
        anchorId: getDocsChapterAnchorId("getting-started", "access"),
        score: 8,
      },
    ];

    const state = getHandbookMatchState(handbook, "mcp access", searchResults);

    expect(state.matchedSectionAnchors.has(getDocsSectionAnchorId("getting-started"))).toBe(true);
    expect(
      state.matchedChapterAnchors.has(getDocsChapterAnchorId("getting-started", "access")),
    ).toBe(true);
    expect(
      state.matchedHeadingIds.has(
        getDocsChapterHeadingAnchorId("getting-started", "access", "MCP status"),
      ),
    ).toBe(true);
  });

  it("keeps active and matched sections open", () => {
    const openSectionIds = getRequiredOpenHandbookSectionIds(
      handbook,
      getDocsChapterHeadingAnchorId("getting-started", "access", "MCP status"),
      new Set([getDocsSectionAnchorId("cli")]),
    );

    expect(openSectionIds).toEqual(new Set(["getting-started", "cli"]));
  });
});
