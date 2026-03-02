import fs from "node:fs";
import path from "node:path";

const docsRoot = path.resolve(process.cwd(), "docs", "wiki");
const arrayKeys = new Set(["changeTriggers", "surface", "searchKeywords"]);
const validAudiences = new Set(["public", "authenticated", "internal"]);
const validCategories = new Set([
  "getting-started",
  "gameplay",
  "features",
  "agent",
  "cli",
  "faq",
  "changelog",
  "troubleshooting",
  "internal",
]);
const validStatuses = new Set(["draft", "published", "deprecated"]);
const validSurfaces = new Set(["web", "cli", "agent", "internal"]);

function walkMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

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

function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Docs article is missing frontmatter");
  }

  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    throw new Error("Docs article has invalid frontmatter delimiter");
  }

  const frontmatterLines = normalized.slice(4, endIndex).split("\n");
  const bodyMarkdown = normalized.slice(endIndex + 5).trim();
  const frontmatter = {};

  for (const rawLine of frontmatterLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    frontmatter[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
  }

  return { frontmatter, bodyMarkdown };
}

function parseArrayField(frontmatter, key) {
  const rawValue = frontmatter[key];
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function loadDocsArticles() {
  const files = walkMarkdownFiles(docsRoot);
  const ids = new Set();
  const paths = new Set();

  return files.map((filePath) => {
    const { frontmatter, bodyMarkdown } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    const section = path.relative(docsRoot, filePath).split(path.sep)[0] || "general";
    const article = {
      id: frontmatter.id,
      title: frontmatter.title,
      summary: frontmatter.summary,
      audience: frontmatter.audience,
      category: frontmatter.category,
      status: frontmatter.status,
      owner: frontmatter.owner,
      lastReviewedAt: frontmatter.lastReviewedAt,
      changeTriggers: parseArrayField(frontmatter, "changeTriggers"),
      slug: frontmatter.slug,
      section,
      sourcePath: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
      surface: parseArrayField(frontmatter, "surface"),
      searchKeywords: parseArrayField(frontmatter, "searchKeywords"),
      bodyMarkdown,
      urlPath: `/wiki/${section}/${frontmatter.slug}`,
    };

    if (
      !article.id ||
      !article.title ||
      !article.summary ||
      !article.audience ||
      !article.category ||
      !article.status ||
      !article.owner ||
      !article.lastReviewedAt ||
      !article.slug
    ) {
      throw new Error(`Docs article ${filePath} is missing required metadata`);
    }

    if (!validAudiences.has(article.audience)) {
      throw new Error(`Docs article ${filePath} has invalid audience "${article.audience}"`);
    }

    if (!validCategories.has(article.category)) {
      throw new Error(`Docs article ${filePath} has invalid category "${article.category}"`);
    }

    if (!validStatuses.has(article.status)) {
      throw new Error(`Docs article ${filePath} has invalid status "${article.status}"`);
    }

    if (article.surface.some((surface) => !validSurfaces.has(surface))) {
      throw new Error(`Docs article ${filePath} has invalid surface metadata`);
    }

    if (ids.has(article.id)) {
      throw new Error(`Duplicate docs article id "${article.id}"`);
    }

    if (paths.has(article.urlPath)) {
      throw new Error(`Duplicate docs article path "${article.urlPath}"`);
    }

    ids.add(article.id);
    paths.add(article.urlPath);

    return article;
  });
}

export function buildDocsManifest() {
  return {
    generatedAt: new Date().toISOString(),
    articles: loadDocsArticles().map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      audience: article.audience,
      category: article.category,
      status: article.status,
      owner: article.owner,
      lastReviewedAt: article.lastReviewedAt,
      changeTriggers: article.changeTriggers,
      slug: article.slug,
      section: article.section,
      surface: article.surface,
      searchKeywords: article.searchKeywords,
      urlPath: article.urlPath,
    })),
  };
}
