import {
  getDocsChapterAnchorId,
  getDocsChapterHeadingAnchorId,
  getDocsSectionAnchorId,
  type DocsHandbook,
  type DocsHandbookChapter,
  type DocsSearchResult,
} from "@shared/docs";

function normalizeQueryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function flattenHandbookChapters(handbook: DocsHandbook): DocsHandbookChapter[] {
  return handbook.sections.flatMap((section) => section.chapters);
}

function normalizeLegacyHash(hash?: string): string {
  return hash?.replace(/^#/, "").trim() || "";
}

export function getLegacyWikiHref(section: string, slug?: string, hash?: string): string {
  if (!slug) {
    return `/wiki#${getDocsSectionAnchorId(section)}`;
  }

  const normalizedHash = normalizeLegacyHash(hash);
  const anchorId = normalizedHash
    ? getDocsChapterHeadingAnchorId(section, slug, normalizedHash)
    : getDocsChapterAnchorId(section, slug);

  return `/wiki#${anchorId}`;
}

export function getHandbookMatchState(
  handbook: DocsHandbook,
  query: string,
  searchResults: DocsSearchResult[],
): {
  matchedSectionAnchors: Set<string>;
  matchedChapterAnchors: Set<string>;
  matchedHeadingIds: Set<string>;
} {
  const terms = normalizeQueryTerms(query);
  const matchedResultIds = new Set(searchResults.map((result) => result.id));
  const matchedSectionAnchors = new Set<string>();
  const matchedChapterAnchors = new Set<string>();
  const matchedHeadingIds = new Set<string>();

  if (terms.length === 0) {
    return {
      matchedSectionAnchors,
      matchedChapterAnchors,
      matchedHeadingIds,
    };
  }

  for (const section of handbook.sections) {
    let sectionMatched = false;

    for (const chapter of section.chapters) {
      const chapterHaystack = [chapter.title, chapter.summary, chapter.excerpt]
        .join(" ")
        .toLowerCase();
      const chapterMatched =
        matchedResultIds.has(chapter.id) || terms.some((term) => chapterHaystack.includes(term));

      if (chapterMatched) {
        matchedChapterAnchors.add(chapter.chapterAnchorId);
        sectionMatched = true;
      }

      for (const heading of chapter.headings) {
        if (terms.some((term) => heading.text.toLowerCase().includes(term))) {
          matchedHeadingIds.add(heading.id);
          matchedChapterAnchors.add(chapter.chapterAnchorId);
          sectionMatched = true;
        }
      }
    }

    if (sectionMatched) {
      matchedSectionAnchors.add(section.anchorId);
    }
  }

  return {
    matchedSectionAnchors,
    matchedChapterAnchors,
    matchedHeadingIds,
  };
}
