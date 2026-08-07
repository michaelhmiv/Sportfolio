export const docsAudiences = ["public", "authenticated", "internal"] as const;
export const docsCategories = [
  "getting-started",
  "gameplay",
  "features",
  "cli",
  "faq",
  "changelog",
  "troubleshooting",
  "internal",
] as const;
export const docsStatuses = ["draft", "published", "deprecated"] as const;
export const docsSurfaces = ["web", "cli", "internal"] as const;
export const docsSectionOrder = [
  "getting-started",
  "gameplay",
  "features",
  "cli",
  "faq",
  "changelog",
  "troubleshooting",
  "internal",
] as const;

export const docsSectionLabels: Record<string, string> = {
  "getting-started": "Getting Started",
  gameplay: "Gameplay",
  features: "Features",
  cli: "CLI",
  faq: "FAQ",
  changelog: "Changelog",
  troubleshooting: "Troubleshooting",
  internal: "Internal",
};

export type DocsAudience = (typeof docsAudiences)[number];
export type DocsCategory = (typeof docsCategories)[number];
export type DocsStatus = (typeof docsStatuses)[number];
export type DocsSurface = (typeof docsSurfaces)[number];

export function slugifyDocsFragment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function getDocsSectionAnchorId(section: string): string {
  return `section-${slugifyDocsFragment(section)}`;
}

export function getDocsChapterAnchorId(section: string, slug: string): string {
  return `chapter-${slugifyDocsFragment(section)}-${slugifyDocsFragment(slug)}`;
}

export function getDocsChapterHeadingAnchorId(
  section: string,
  slug: string,
  headingText: string,
): string {
  return `${getDocsChapterAnchorId(section, slug)}-${slugifyDocsFragment(headingText)}`;
}

export type DocsHeading = {
  depth: number;
  text: string;
  id: string;
};

export type DocsArticleMeta = {
  id: string;
  title: string;
  summary: string;
  audience: DocsAudience;
  category: DocsCategory;
  status: DocsStatus;
  owner: string;
  lastReviewedAt: string;
  changeTriggers: string[];
  slug: string;
  section: string;
  surface: DocsSurface[];
  searchKeywords: string[];
};

export type DocsArticleSummary = DocsArticleMeta & {
  headings: DocsHeading[];
  urlPath: string;
};

export type DocsArticle = DocsArticleSummary & {
  bodyMarkdown: string;
  relatedArticleIds: string[];
};

export type DocsSearchResult = {
  id: string;
  title: string;
  summary: string;
  category: DocsCategory;
  section: string;
  slug: string;
  urlPath: string;
  anchorId: string;
  score: number;
};

export type DocsHandbookChapter = {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  category: DocsCategory;
  section: string;
  slug: string;
  urlPath: string;
  chapterAnchorId: string;
  lastReviewedAt: string;
  headings: DocsHeading[];
  bodyMarkdown: string;
  searchKeywords: string[];
};

export type DocsHandbookSection = {
  id: string;
  label: string;
  anchorId: string;
  chapters: DocsHandbookChapter[];
};

export type DocsHandbook = {
  title: string;
  summary: string;
  chapterCount: number;
  sections: DocsHandbookSection[];
};

export type DocsAnswerCitation = {
  id: string;
  title: string;
  summary: string;
  urlPath: string;
  anchorId: string;
  excerpt: string;
};

export type DocsAnswerResponse = {
  query: string;
  answer: string;
  citations: DocsAnswerCitation[];
  fallbackUsed: boolean;
};
