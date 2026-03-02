import { loadDocsArticles } from "./docs-lib.mjs";

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .trim();
}

function matchesTrigger(filePath, trigger) {
  return filePath === trigger || filePath.startsWith(`${trigger}/`);
}

const changedFiles = process.argv.slice(2).map(normalizePath).filter(Boolean);

if (changedFiles.length === 0) {
  console.log("[docs:governance] No changed files supplied. Pass changed paths as arguments.");
  process.exit(0);
}

const changedDocPaths = new Set(
  changedFiles.filter((filePath) => filePath.startsWith("docs/wiki/")),
);
const articles = loadDocsArticles();
const impactedArticles = articles.filter((article) =>
  article.changeTriggers.some((trigger) =>
    changedFiles.some((filePath) => matchesTrigger(filePath, trigger)),
  ),
);

if (impactedArticles.length === 0) {
  console.log("[docs:governance] No doc-triggered files changed.");
  process.exit(0);
}

const missingArticles = impactedArticles.filter(
  (article) => !changedDocPaths.has(article.sourcePath),
);

if (missingArticles.length > 0) {
  console.error("[docs:governance] Missing required docs updates for changed code paths:");
  for (const article of missingArticles) {
    console.error(`- ${article.sourcePath} (${article.title})`);
  }
  process.exit(1);
}

console.log(
  `[docs:governance] OK. ${impactedArticles.length} impacted article(s) were updated in this change set.`,
);
