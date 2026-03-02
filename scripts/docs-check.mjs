import { loadDocsArticles } from "./docs-lib.mjs";

try {
  const articles = loadDocsArticles();
  const sections = new Set(articles.map((article) => article.section));
  console.log(
    `[docs:check] Validated ${articles.length} articles across ${sections.size} sections.`,
  );
} catch (error) {
  console.error("[docs:check] Validation failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
