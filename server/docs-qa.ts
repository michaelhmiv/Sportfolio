import { completeSimple, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import type {
  DocsAnswerCitation,
  DocsAnswerResponse,
  DocsHandbook,
  DocsHandbookChapter,
} from "@shared/docs";
import { resolveManagedPiRuntime } from "./agent/pi-provider";
import { getDocsHandbook, searchDocsArticles } from "./docs-service";

function extractAssistantText(message: AssistantMessage): string | null {
  const text = message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => {
      return block.type === "text";
    })
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || null;
}

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

function buildDocsContextBlock(citations: DocsAnswerCitation[]): string {
  return citations
    .map((citation, index) =>
      [
        `[${index + 1}] ${citation.title}`,
        `Path: ${citation.urlPath}#${citation.anchorId}`,
        `Summary: ${citation.summary}`,
        `Excerpt: ${citation.excerpt}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function buildMcpFallbackAnswer(citations: DocsAnswerCitation[]): string {
  return [
    "Sportfolio exposes a public authenticated MCP endpoint at `/mcp`.",
    "Use a profile API token as `Authorization: Bearer <your-token>` against `https://www.sportfolio.market/mcp` or your local base URL plus `/mcp`.",
    "The current MCP v1 surface is gameplay-focused: reads, public docs resources/prompts, and confirmation-gated staging.",
    "Billing, funding, bootstrap/token-management, SMS linking/settings, profile identity edits, agent settings/BYOK, and admin/internal routes are excluded.",
    citations.length > 0
      ? `Read ${citations.map((citation) => citation.title).join(" and ")} for the handbook version of the current MCP contract.`
      : "If you do not need an MCP client, the CLI remains the simplest terminal path.",
  ].join(" ");
}

function buildCliAccessFallbackAnswer(): string {
  return [
    "Create a profile API token, then authenticate with `sportfolio auth login --token <your-token>`.",
    "If you are running from this repo directly, use `node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>`.",
    "The main documented CLI command families are `docs`, `agent`, `portfolio`, and `actions`.",
  ].join(" ");
}

function buildExtractiveFallbackAnswer(query: string, citations: DocsAnswerCitation[]): string {
  if (citations.length === 0) {
    return [
      "I could not find that in the public Sportfolio handbook.",
      "Try a more specific question or open the full Sportfolio Agent for account-specific help.",
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

  try {
    const runtime = await resolveManagedPiRuntime();
    const promptMessage: Message = {
      role: "user",
      content: [
        "<question>",
        trimmedQuery,
        "</question>",
        "<public_handbook_context>",
        buildDocsContextBlock(citations),
        "</public_handbook_context>",
        "Answer using only the supplied handbook context.",
      ].join("\n"),
      timestamp: Date.now(),
    };
    const response = await completeSimple(
      runtime.model,
      {
        systemPrompt: [
          "You are Sportfolio Agent in public handbook mode.",
          "Only answer from the supplied Sportfolio handbook context.",
          "Do not use account context, memory, tools, or outside knowledge.",
          "If the handbook does not establish something, say that clearly.",
          "If the user asks about MCP, answer strictly from the supplied handbook context.",
          "When the supplied context documents a repo-tracked MCP surface, state the endpoint, auth model, v1 scope, and major exclusions plainly.",
          "Only say MCP is undocumented if the supplied handbook context truly does not establish it.",
          "Keep the answer concise and practical.",
        ].join("\n"),
        messages: [promptMessage],
      },
      {
        apiKey: runtime.apiKey,
        temperature: 0.1,
        maxTokens: 500,
        ...(runtime.headers ? { headers: runtime.headers } : {}),
        ...(runtime.onPayload ? { onPayload: runtime.onPayload } : {}),
      },
    );

    const answer = extractAssistantText(response);
    if (!answer) {
      throw new Error("Docs QA model returned no answer text");
    }

    return {
      query: trimmedQuery,
      answer,
      citations,
      fallbackUsed: false,
    };
  } catch {
    return {
      query: trimmedQuery,
      answer: buildExtractiveFallbackAnswer(trimmedQuery, citations),
      citations,
      fallbackUsed: true,
    };
  }
}
