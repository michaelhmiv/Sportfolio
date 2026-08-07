import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  docsAudiences,
  docsCategories,
  docsSectionLabels,
  docsSectionOrder,
  docsStatuses,
  docsSurfaces,
  getDocsChapterAnchorId,
  getDocsChapterHeadingAnchorId,
  getDocsSectionAnchorId,
  slugifyDocsFragment,
  type DocsArticle,
  type DocsArticleMeta,
  type DocsArticleSummary,
  type DocsHandbook,
  type DocsHandbookChapter,
  type DocsHandbookSection,
  type DocsHeading,
  type DocsSearchResult,
} from "@shared/docs";

type ParsedFrontmatter = Record<string, string>;

type KnowledgeArticleSummary = {
  id: string;
  title: string;
  summary: string;
  urlPath: string;
  lastReviewedAt: string;
  notes: string[];
};

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "wiki");
const CACHE_TTL_MS = 15_000;
const categorySet = new Set<string>(docsCategories);
const audienceSet = new Set<string>(docsAudiences);
const statusSet = new Set<string>(docsStatuses);
const surfaceSet = new Set<string>(docsSurfaces);
const handbookSectionOrder = docsSectionOrder.filter(
  (section) => section !== "troubleshooting" && section !== "internal",
);
const handbookSectionSet = new Set<string>(handbookSectionOrder);

let cachedArticles: DocsArticle[] | null = null;
let cachedAt = 0;

const lowSignalSearchTerms = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "how",
  "i",
  "is",
  "my",
  "of",
  "or",
  "the",
  "to",
  "what",
]);

function cleanMarkdownLine(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/`/g, "")
    .trim();
}

function walkMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    let resolvedStats: fs.Stats | null = null;
    const getStats = () => {
      if (!resolvedStats) {
        resolvedStats = fs.statSync(fullPath);
      }
      return resolvedStats;
    };

    const isDirectory = entry.isDirectory() || (!entry.isFile() && getStats().isDirectory());
    if (isDirectory) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }

    const isFile = entry.isFile() || (!entry.isDirectory() && getStats().isFile());
    if (isFile && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function parseFrontmatter(rawSource: string): {
  frontmatter: ParsedFrontmatter;
  bodyMarkdown: string;
} {
  const normalized = rawSource.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Docs article is missing frontmatter");
  }

  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    throw new Error("Docs article has invalid frontmatter delimiter");
  }

  const frontmatterBlock = normalized.slice(4, endIndex);
  const bodyMarkdown = normalized.slice(endIndex + 5).trim();
  const frontmatter: ParsedFrontmatter = {};

  for (const rawLine of frontmatterBlock.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, bodyMarkdown };
}

function parseArrayField(frontmatter: ParsedFrontmatter, key: string): string[] {
  const rawValue = frontmatter[key];
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractHeadings(bodyMarkdown: string): DocsHeading[] {
  return bodyMarkdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      depth: match[1].length,
      text: match[2].trim(),
      id: slugifyDocsFragment(match[2]),
    }));
}

function extractHandbookHeadings(
  section: string,
  slug: string,
  bodyMarkdown: string,
): DocsHeading[] {
  return bodyMarkdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      depth: match[1].length,
      text: match[2].trim(),
      id: getDocsChapterHeadingAnchorId(section, slug, match[2].trim()),
    }));
}

function normalizeHandbookBodyMarkdown(bodyMarkdown: string): string {
  const lines = bodyMarkdown.replace(/\r\n/g, "\n").split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex !== -1 && /^#\s+/.test(lines[firstContentIndex].trim())) {
    lines.splice(firstContentIndex, 1);
    if (firstContentIndex < lines.length && lines[firstContentIndex].trim() === "") {
      lines.splice(firstContentIndex, 1);
    }
  }

  return lines.join("\n").trim();
}

function buildHandbookExcerpt(bodyMarkdown: string, summary: string): string {
  const notes: string[] = [];
  const normalizedBody = normalizeHandbookBodyMarkdown(bodyMarkdown);

  for (const rawLine of normalizedBody.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) {
      continue;
    }

    const cleaned = cleanMarkdownLine(line);
    if (!cleaned) {
      continue;
    }

    notes.push(cleaned);
    if (notes.length >= 2) {
      break;
    }
  }

  if (notes.length === 0) {
    return summary;
  }

  return notes.join(" ");
}

function toMeta(
  filePath: string,
  frontmatter: ParsedFrontmatter,
  headings: DocsHeading[],
): DocsArticleSummary {
  const section = path.relative(DOCS_ROOT, filePath).split(path.sep)[0] || "general";
  const id = frontmatter.id?.trim();
  const title = frontmatter.title?.trim();
  const summary = frontmatter.summary?.trim();
  const audience = frontmatter.audience?.trim();
  const category = frontmatter.category?.trim();
  const status = frontmatter.status?.trim();
  const owner = frontmatter.owner?.trim();
  const lastReviewedAt = frontmatter.lastReviewedAt?.trim();
  const slug = frontmatter.slug?.trim();

  if (!id || !title || !summary || !audience || !category || !status || !owner || !lastReviewedAt) {
    throw new Error(`Docs article ${filePath} is missing required metadata`);
  }

  if (!slug) {
    throw new Error(`Docs article ${filePath} is missing slug metadata`);
  }

  if (!audienceSet.has(audience)) {
    throw new Error(`Docs article ${filePath} has invalid audience "${audience}"`);
  }

  if (!categorySet.has(category)) {
    throw new Error(`Docs article ${filePath} has invalid category "${category}"`);
  }

  if (!statusSet.has(status)) {
    throw new Error(`Docs article ${filePath} has invalid status "${status}"`);
  }

  const surface = parseArrayField(frontmatter, "surface");
  if (surface.some((item) => !surfaceSet.has(item))) {
    throw new Error(`Docs article ${filePath} has an invalid surface value`);
  }

  return {
    id,
    title,
    summary,
    audience: audience as DocsArticleMeta["audience"],
    category: category as DocsArticleMeta["category"],
    status: status as DocsArticleMeta["status"],
    owner,
    lastReviewedAt,
    changeTriggers: parseArrayField(frontmatter, "changeTriggers"),
    slug,
    section,
    surface: surface as DocsArticleMeta["surface"],
    searchKeywords: parseArrayField(frontmatter, "searchKeywords"),
    headings,
    urlPath: `/wiki/${section}/${slug}`,
  };
}

function loadArticlesFromDisk(): DocsArticle[] {
  const files = walkMarkdownFiles(DOCS_ROOT);
  const articles = files.map((filePath) => {
    const rawSource = fs.readFileSync(filePath, "utf8");
    const { frontmatter, bodyMarkdown } = parseFrontmatter(rawSource);
    const headings = extractHeadings(bodyMarkdown);
    const summary = toMeta(filePath, frontmatter, headings);
    return {
      ...summary,
      bodyMarkdown,
      relatedArticleIds: [],
    } satisfies DocsArticle;
  });

  const ids = new Set<string>();
  const urlPaths = new Set<string>();

  for (const article of articles) {
    if (ids.has(article.id)) {
      throw new Error(`Duplicate docs article id "${article.id}"`);
    }
    if (urlPaths.has(article.urlPath)) {
      throw new Error(`Duplicate docs article path "${article.urlPath}"`);
    }
    ids.add(article.id);
    urlPaths.add(article.urlPath);
  }

  const relatedByCategory = new Map<string, string[]>();
  for (const article of articles) {
    const key = `${article.category}:${article.section}`;
    const related = relatedByCategory.get(key) || [];
    related.push(article.id);
    relatedByCategory.set(key, related);
  }

  return articles.map((article) => {
    const relatedKey = `${article.category}:${article.section}`;
    const relatedIds = (relatedByCategory.get(relatedKey) || []).filter((id) => id !== article.id);
    return {
      ...article,
      relatedArticleIds: relatedIds.slice(0, 3),
    };
  });
}

function getAllArticles(): DocsArticle[] {
  const now = Date.now();
  if (cachedArticles && now - cachedAt < CACHE_TTL_MS) {
    return cachedArticles;
  }

  cachedArticles = loadArticlesFromDisk();
  cachedAt = now;
  return cachedArticles;
}

function extractKnowledgeNotes(bodyMarkdown: string): string[] {
  const notes: string[] = [];

  for (const rawLine of bodyMarkdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) {
      continue;
    }

    const cleaned = cleanMarkdownLine(line);
    if (!cleaned) {
      continue;
    }

    notes.push(cleaned);
    if (notes.length >= 3) {
      break;
    }
  }

  return notes.slice(0, 3);
}

function canReadArticle(article: DocsArticle, isAuthenticated: boolean): boolean {
  if (article.status !== "published") {
    return false;
  }
  if (article.audience === "internal") {
    return false;
  }
  if (article.audience === "authenticated" && !isAuthenticated) {
    return false;
  }
  return true;
}

function canUseKnowledgeArticle(article: DocsArticle, isAuthenticated: boolean): boolean {
  return canReadArticle(article, isAuthenticated);
}

function toHandbookChapter(article: DocsArticle): DocsHandbookChapter {
  const bodyMarkdown = normalizeHandbookBodyMarkdown(article.bodyMarkdown);

  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    excerpt: buildHandbookExcerpt(article.bodyMarkdown, article.summary),
    category: article.category,
    section: article.section,
    slug: article.slug,
    urlPath: article.urlPath,
    chapterAnchorId: getDocsChapterAnchorId(article.section, article.slug),
    lastReviewedAt: article.lastReviewedAt,
    headings: extractHandbookHeadings(article.section, article.slug, bodyMarkdown),
    bodyMarkdown,
    searchKeywords: article.searchKeywords,
  };
}

function buildHandbookSections(articles: DocsArticle[]): DocsHandbookSection[] {
  const sections = new Map<string, DocsHandbookChapter[]>();

  for (const article of articles) {
    const chapters = sections.get(article.section) || [];
    chapters.push(toHandbookChapter(article));
    sections.set(article.section, chapters);
  }

  const orderedSections = [
    ...handbookSectionOrder,
    ...Array.from(sections.keys()).filter((section) => !handbookSectionSet.has(section)),
  ];

  return orderedSections
    .filter((section) => sections.has(section))
    .map((section) => ({
      id: section,
      label: docsSectionLabels[section] || section,
      anchorId: getDocsSectionAnchorId(section),
      chapters: sections.get(section) || [],
    }));
}

export function listDocsArticles(isAuthenticated = false): DocsArticleSummary[] {
  return getAllArticles()
    .filter((article) => canReadArticle(article, isAuthenticated))
    .map(
      ({ bodyMarkdown: _bodyMarkdown, relatedArticleIds: _relatedArticleIds, ...summary }) =>
        summary,
    );
}

export function getDocsArticle(
  section: string,
  slug: string,
  isAuthenticated = false,
): DocsArticle | null {
  const article =
    getAllArticles().find((entry) => entry.section === section && entry.slug === slug) || null;

  if (!article || !canReadArticle(article, isAuthenticated)) {
    return null;
  }

  return article;
}

export function getDocsHandbook(isAuthenticated = false): DocsHandbook {
  const readableArticles = getAllArticles().filter((article) =>
    canReadArticle(article, isAuthenticated),
  );
  const sections = buildHandbookSections(readableArticles);
  const chapterCount = sections.reduce((total, section) => total + section.chapters.length, 0);

  return {
    title: "Sportfolio Handbook",
    summary: "One handbook for Sportfolio access, gameplay, CLI usage, FAQs, and release notes.",
    chapterCount,
    sections,
  };
}

export function searchDocsArticles(query: string, isAuthenticated = false): DocsSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return getAllArticles()
    .filter((article) => canReadArticle(article, isAuthenticated))
    .map((article) => {
      const handbookChapter = toHandbookChapter(article);
      const haystack = [
        article.title,
        article.summary,
        article.bodyMarkdown,
        handbookChapter.excerpt,
        article.searchKeywords.join(" "),
        article.section,
        handbookChapter.headings.map((heading) => heading.text).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      const score = terms.reduce((total, term) => {
        if (article.title.toLowerCase().includes(term)) {
          return total + 5;
        }
        if (article.searchKeywords.some((keyword) => keyword.toLowerCase().includes(term))) {
          return total + 3;
        }
        if (handbookChapter.headings.some((heading) => heading.text.toLowerCase().includes(term))) {
          return total + 2;
        }
        return haystack.includes(term) ? total + 1 : total;
      }, 0);

      return {
        id: article.id,
        title: article.title,
        summary: article.summary,
        category: article.category,
        section: article.section,
        slug: article.slug,
        urlPath: article.urlPath,
        anchorId: handbookChapter.chapterAnchorId,
        score,
      } satisfies DocsSearchResult;
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

export function validateDocsContent(): {
  articles: DocsArticleSummary[];
  sections: string[];
} {
  const articles = listDocsArticles(true);
  const handbook = getDocsHandbook(true);

  return {
    articles,
    sections: handbook.sections.map((section) => section.id),
  };
}

export function listKnowledgeArticles(isAuthenticated = false): KnowledgeArticleSummary[] {
  return getAllArticles()
    .filter((article) => canUseKnowledgeArticle(article, isAuthenticated))
    .sort((left, right) => {
      const leftCategoryIndex = docsCategories.indexOf(left.category);
      const rightCategoryIndex = docsCategories.indexOf(right.category);

      if (leftCategoryIndex !== rightCategoryIndex) {
        return leftCategoryIndex - rightCategoryIndex;
      }

      return left.title.localeCompare(right.title);
    })
    .map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      urlPath: article.urlPath,
      lastReviewedAt: article.lastReviewedAt,
      notes: extractKnowledgeNotes(article.bodyMarkdown),
    }));
}

export function findBestKnowledgeArticle(
  query: string,
  isAuthenticated = false,
): KnowledgeArticleSummary | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  const terms = normalizedQuery
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !lowSignalSearchTerms.has(term));

  if (terms.length === 0) {
    return null;
  }

  let bestMatch:
    | (KnowledgeArticleSummary & {
        score: number;
      })
    | null = null;

  for (const article of getAllArticles()) {
    if (!canUseKnowledgeArticle(article, isAuthenticated)) {
      continue;
    }

    const notes = extractKnowledgeNotes(article.bodyMarkdown);
    const haystack = [
      article.title,
      article.summary,
      article.searchKeywords.join(" "),
      notes.join(" "),
      article.bodyMarkdown,
    ]
      .join(" ")
      .toLowerCase();

    const score = terms.reduce((total, term) => {
      if (article.title.toLowerCase().includes(term)) {
        return total + 5;
      }
      if (article.searchKeywords.some((keyword) => keyword.toLowerCase().includes(term))) {
        return total + 3;
      }
      return haystack.includes(term) ? total + 1 : total;
    }, 0);

    if (score <= 0) {
      continue;
    }

    const candidate = {
      id: article.id,
      title: article.title,
      summary: article.summary,
      urlPath: article.urlPath,
      lastReviewedAt: article.lastReviewedAt,
      notes,
      score,
    };

    if (
      !bestMatch ||
      candidate.score > bestMatch.score ||
      (candidate.score === bestMatch.score && candidate.title.localeCompare(bestMatch.title) < 0)
    ) {
      bestMatch = candidate;
    }
  }

  if (!bestMatch) {
    return null;
  }

  const { score: _score, ...match } = bestMatch;
  return match;
}
