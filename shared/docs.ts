export const docsAudiences = ["public", "authenticated", "internal"] as const;
export const docsCategories = [
  "getting-started",
  "gameplay",
  "features",
  "agent",
  "cli",
  "faq",
  "changelog",
  "troubleshooting",
  "internal",
] as const;
export const docsStatuses = ["draft", "published", "deprecated"] as const;
export const docsSurfaces = ["web", "cli", "agent", "internal"] as const;

export type DocsAudience = (typeof docsAudiences)[number];
export type DocsCategory = (typeof docsCategories)[number];
export type DocsStatus = (typeof docsStatuses)[number];
export type DocsSurface = (typeof docsSurfaces)[number];

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
  score: number;
};
