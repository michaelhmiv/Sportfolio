import fs from "node:fs";
import path from "node:path";
import {
  docsAudiences,
  docsCategories,
  docsStatuses,
  docsSurfaces,
  type DocsArticle,
  type DocsArticleMeta,
  type DocsArticleSummary,
  type DocsHeading,
  type DocsSearchResult,
} from "@shared/docs";

type ParsedFrontmatter = Record<string, string>;

const DOCS_ROOT = path.resolve(process.cwd(), "docs", "wiki");
const CACHE_TTL_MS = 15_000;
const arrayKeys = new Set(["changeTriggers", "surface", "searchKeywords"]);
const categorySet = new Set<string>(docsCategories);
const audienceSet = new Set<string>(docsAudiences);
const statusSet = new Set<string>(docsStatuses);
const surfaceSet = new Set<string>(docsSurfaces);

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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function walkMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
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
      id: slugify(match[2]),
    }));
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

function extractAgentKnowledgeNotes(bodyMarkdown: string): string[] {
  const notes: string[] = [];

  for (const rawLine of bodyMarkdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) {
      continue;
    }

    if (
      !line.startsWith("#") &&
      !line.startsWith("-") &&
      !line.startsWith("*") &&
      !/^\d+\./.test(line)
    ) {
      const cleaned = cleanMarkdownLine(line);
      if (cleaned) {
        notes.push(cleaned);
      }
      if (notes.length >= 3) {
        break;
      }
      continue;
    }

    const cleaned = cleanMarkdownLine(line);
    if (cleaned) {
      notes.push(cleaned);
    }

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

export function searchDocsArticles(query: string, isAuthenticated = false): DocsSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return getAllArticles()
    .filter((article) => canReadArticle(article, isAuthenticated))
    .map((article) => {
      const haystack = [
        article.title,
        article.summary,
        article.bodyMarkdown,
        article.searchKeywords.join(" "),
        article.section,
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

      return {
        id: article.id,
        title: article.title,
        summary: article.summary,
        category: article.category,
        section: article.section,
        slug: article.slug,
        urlPath: article.urlPath,
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
  const sections = Array.from(new Set(articles.map((article) => article.section))).sort();

  return {
    articles,
    sections,
  };
}

export function listAgentKnowledgeArticles(): Array<{
  id: string;
  title: string;
  summary: string;
  urlPath: string;
  lastReviewedAt: string;
  notes: string[];
}> {
  return getAllArticles()
    .filter(
      (article) =>
        article.status === "published" &&
        article.audience !== "internal" &&
        article.surface.includes("agent"),
    )
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
      notes: extractAgentKnowledgeNotes(article.bodyMarkdown),
    }));
}

export function findBestAgentKnowledgeArticle(query: string): {
  id: string;
  title: string;
  summary: string;
  urlPath: string;
  lastReviewedAt: string;
  notes: string[];
} | null {
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
    | (ReturnType<typeof listAgentKnowledgeArticles>[number] & {
        score: number;
      })
    | null = null;

  for (const article of getAllArticles()) {
    if (
      article.status !== "published" ||
      article.audience === "internal" ||
      !article.surface.includes("agent")
    ) {
      continue;
    }

    const notes = extractAgentKnowledgeNotes(article.bodyMarkdown);
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
