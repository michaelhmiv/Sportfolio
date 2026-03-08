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

function normalizeAnchorId(anchorId?: string): string {
  return anchorId?.replace(/^#/, "").trim() || "";
}

export function getLegacyWikiHref(section: string, slug?: string, hash?: string): string {
  if (!slug) {
    return `/wiki#${getDocsSectionAnchorId(section)}`;
  }

  const normalizedHash = normalizeAnchorId(hash);
  const anchorId = normalizedHash
    ? getDocsChapterHeadingAnchorId(section, slug, normalizedHash)
    : getDocsChapterAnchorId(section, slug);

  return `/wiki#${anchorId}`;
}

export function getHandbookSectionIdForAnchor(
  handbook: DocsHandbook,
  anchorId?: string | null,
): string | null {
  const normalizedAnchorId = normalizeAnchorId(anchorId || undefined);
  if (!normalizedAnchorId) {
    return null;
  }

  for (const section of handbook.sections) {
    if (section.anchorId === normalizedAnchorId) {
      return section.id;
    }

    for (const chapter of section.chapters) {
      if (chapter.chapterAnchorId === normalizedAnchorId) {
        return section.id;
      }

      if (chapter.headings.some((heading) => heading.id === normalizedAnchorId)) {
        return section.id;
      }
    }
  }

  return null;
}

export function getRequiredOpenHandbookSectionIds(
  handbook: DocsHandbook,
  activeAnchorId: string | null,
  matchedSectionAnchors: Set<string>,
): Set<string> {
  const openSectionIds = new Set<string>();
  const activeSectionId = getHandbookSectionIdForAnchor(handbook, activeAnchorId);

  if (activeSectionId) {
    openSectionIds.add(activeSectionId);
  }

  for (const section of handbook.sections) {
    if (matchedSectionAnchors.has(section.anchorId)) {
      openSectionIds.add(section.id);
    }
  }

  return openSectionIds;
}

export function getDefaultOpenHandbookSectionIds(
  handbook: DocsHandbook,
  activeAnchorId: string | null,
): Set<string> {
  const openSectionIds = getRequiredOpenHandbookSectionIds(handbook, activeAnchorId, new Set());

  if (openSectionIds.size === 0 && handbook.sections[0]) {
    openSectionIds.add(handbook.sections[0].id);
  }

  return openSectionIds;
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
