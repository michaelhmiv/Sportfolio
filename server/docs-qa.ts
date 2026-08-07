import type {
  DocsAnswerCitation,
  DocsAnswerResponse,
  DocsHandbook,
  DocsHandbookChapter,
} from "@shared/docs";
import { getDocsHandbook, searchDocsArticles } from "./docs-service";

function flattenHandbookChapters(handbook: DocsHandbook): DocsHandbookChapter[] {
  return handbook.sections.flatMap((section) => section.chapters);
}

function buildDocsCitations(
  query: string,
  handbook: DocsHandbook,
  limit = 3,
): DocsAnswerCitation[] {
  const chaptersById = new Map(
    flattenHandbookChapters(handbook).map((chapter) => [chapter.id, chapter]),
  );

  return searchDocsArticles(query, false)
    .slice(0, limit)
    .map((result) => {
      const chapter = chaptersById.get(result.id);
      if (!chapter) {
        return null;
      }

      return {
        id: chapter.id,
        title: chapter.title,
        summary: chapter.summary,
        urlPath: chapter.urlPath,
        anchorId: chapter.chapterAnchorId,
        excerpt: chapter.excerpt,
      } satisfies DocsAnswerCitation;
    })
    .filter((citation): citation is DocsAnswerCitation => Boolean(citation));
}

function buildMcpFallbackAnswer(citations: DocsAnswerCitation[]): string {
  return [
    "Sportfolio exposes a public authenticated MCP endpoint at `/mcp`.",
    "Use a profile API token as `Authorization: Bearer <your-token>` against `https://www.sportfolio.market/mcp` or your local base URL plus `/mcp`.",
    "The current MCP v1 surface is gameplay-focused: reads, public docs resources/prompts, and confirmation-gated staging.",
    "Billing, funding, bootstrap/token-management, profile identity edits, and admin/internal routes are excluded.",
    citations.length > 0
      ? `Read ${citations.map((citation) => citation.title).join(" and ")} for the handbook version of the current MCP contract.`
      : "If you do not need an MCP client, the CLI remains the simplest terminal path.",
  ].join(" ");
}

function buildCliAccessFallbackAnswer(): string {
  return [
    "Create a profile API token, then authenticate with `sportfolio auth login --token <your-token>`.",
    "If you are running from this repo directly, use `node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>`.",
    "The main documented CLI command families are `docs`, `portfolio`, and `actions`.",
  ].join(" ");
}

function buildExtractiveFallbackAnswer(query: string, citations: DocsAnswerCitation[]): string {
  if (citations.length === 0) {
    return [
      "I could not find that in the public Sportfolio handbook.",
      "Try a more specific question or use the authenticated Sportfolio tools for account-specific help.",
    ].join(" ");
  }

  const normalizedQuery = query.toLowerCase();

  if (/\bmcp\b|model context protocol/.test(normalizedQuery)) {
    return buildMcpFallbackAnswer(citations);
  }

  if (/\bcli\b|\bterminal\b|\bapi token\b|\bauth login\b/.test(normalizedQuery)) {
    return buildCliAccessFallbackAnswer();
  }

  const [primary, secondary] = citations;
  const supportingLine = secondary
    ? `Related coverage: ${secondary.title}.`
    : "Open the cited chapter for the full handbook explanation.";

  return [primary.summary, primary.excerpt, supportingLine].join(" ").trim();
}

export async function answerDocsQuestion(query: string): Promise<DocsAnswerResponse> {
  const trimmedQuery = query.trim();
  const handbook = getDocsHandbook(false);
  const citations = buildDocsCitations(trimmedQuery, handbook);

  if (!trimmedQuery) {
    return {
      query: trimmedQuery,
      answer: "Ask a handbook question or search for a Sportfolio topic.",
      citations: [],
      fallbackUsed: true,
    };
  }

  if (citations.length === 0) {
    return {
      query: trimmedQuery,
      answer: buildExtractiveFallbackAnswer(trimmedQuery, citations),
      citations,
      fallbackUsed: true,
    };
  }

  return {
    query: trimmedQuery,
    answer: buildExtractiveFallbackAnswer(trimmedQuery, citations),
    citations,
    fallbackUsed: true,
  };
}
