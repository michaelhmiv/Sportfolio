import type { UserAgentProfile } from "@shared/schema";
import type { AgentAnalysisResult, AgentCitation } from "./types";

const DEFAULT_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_SEARCH_TIMEOUT_MS = 8000;
const MAX_RESEARCH_RESULTS = 4;

type HostedResearchPlan = Omit<AgentAnalysisResult, "runId" | "status"> & {
  contextSnapshot: Record<string, unknown>;
  trace: Record<string, unknown>;
};

export interface HostedWebResearchResult {
  query: string;
  citations: AgentCitation[];
  errorMessage: string | null;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripResearchPreamble(message: string) {
  return normalizeWhitespace(
    message
      .replace(
        /\b(?:research|search(?:\s+the\s+web)?|look(?:\s+up)?|browse|find|pull|check)\b/gi,
        " ",
      )
      .replace(
        /\b(?:latest|recent|current|today'?s|news|updates?|headlines?|reports?|rumors?)\b/gi,
        " ",
      )
      .replace(
        /\b(?:for me|for us|please|can you|could you|would you|tell me|show me|what'?s|what is)\b/gi,
        " ",
      )
      .replace(/[?!.]+$/g, " "),
  );
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNestedString(value: unknown, key: string): string | null {
  const record = toObject(value);
  if (!record) {
    return null;
  }

  return readString(record[key]);
}

function getBraveSearchUrl() {
  return process.env.BRAVE_SEARCH_BASE_URL?.trim() || DEFAULT_BRAVE_SEARCH_URL;
}

function getBraveSearchApiKey() {
  return process.env.BRAVE_SEARCH_API_KEY?.trim() || "";
}

export function isHostedWebResearchAvailable() {
  return Boolean(getBraveSearchApiKey());
}

export function shouldUseHostedWebResearch(message: string) {
  const normalized = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:research|search(?: the web)?|look up|browse|find news|pull news|check news)\b/.test(
      normalized,
    ) ||
    /\b(?:latest|recent|current|today'?s)\b.*\b(?:news|updates?|headlines?|reports?|injury|injuries|status|rumors?)\b/.test(
      normalized,
    ) ||
    /\b(?:news|updates?|headlines?|injury|injuries|status|rumors?)\b.*\b(?:on|for|about)\b/.test(
      normalized,
    )
  );
}

export function buildHostedWebResearchQueries(
  message: string,
  profile: UserAgentProfile,
): string[] {
  const raw = normalizeWhitespace(message);
  const stripped = stripResearchPreamble(raw);
  const queries: string[] = [];
  const candidateBaseQuery =
    stripped.length >= 3 ? stripped : raw.replace(/[?!.]+$/g, "").trim() || raw.trim();
  const baseQuery = normalizeWhitespace(candidateBaseQuery.replace(/^(?:on|for|about)\s+/i, ""));

  if (baseQuery) {
    queries.push(baseQuery);
  }

  const lowerBase = baseQuery.toLowerCase();
  if (
    baseQuery &&
    !/\b(?:news|updates?|headlines?|injury|injuries|reports?|rumors?|status)\b/.test(lowerBase)
  ) {
    queries.push(`${baseQuery} latest sports news`);
  }

  if (
    profile.defaultSport &&
    baseQuery &&
    !new RegExp(`\\b${profile.defaultSport}\\b`, "i").test(baseQuery)
  ) {
    queries.push(`${baseQuery} ${profile.defaultSport} news`);
  }

  return Array.from(new Set(queries.map((query) => normalizeWhitespace(query))))
    .filter(Boolean)
    .slice(0, 3);
}

async function fetchBraveSearchResults(query: string): Promise<AgentCitation[]> {
  const apiKey = getBraveSearchApiKey();
  if (!apiKey) {
    return [];
  }

  const url = new URL(getBraveSearchUrl());
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESEARCH_RESULTS));
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("country", "us");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("spellcheck", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAVE_SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Brave search failed with ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const web = toObject(payload.web);
    const results = Array.isArray(web?.results) ? web.results : [];
    const retrievedAt = new Date().toISOString();

    return results
      .map((entry, index) => {
        const row = toObject(entry);
        if (!row) {
          return null;
        }

        const title = readString(row.title);
        const urlValue = readString(row.url);
        const snippet =
          readString(row.description) ||
          readNestedString(row, "snippet") ||
          readNestedString(row, "extra_snippets");

        if (!title || !urlValue || !snippet) {
          return null;
        }

        let sourceName =
          readNestedString(row.profile, "name") ||
          readNestedString(row.meta_url, "hostname") ||
          readNestedString(row.meta_url, "netloc");

        if (!sourceName) {
          try {
            sourceName = new URL(urlValue).hostname.replace(/^www\./, "");
          } catch {
            sourceName = "External Source";
          }
        }

        const publishedAt =
          readString(row.page_age) ||
          readString(row.age) ||
          readNestedString(row, "pageAge") ||
          null;

        return {
          id: `brave-${index + 1}`,
          title: truncateText(title, 160),
          sourceName,
          url: urlValue,
          publishedAt,
          retrievedAt,
          factSummary: truncateText(snippet, 240),
          relevanceScore: Number((1 - index * 0.12).toFixed(2)),
        } satisfies AgentCitation;
      })
      .filter((entry): entry is AgentCitation => Boolean(entry));
  } finally {
    clearTimeout(timeout);
  }
}

export async function runHostedWebResearchQuery(query: string): Promise<HostedWebResearchResult> {
  const normalizedQuery = normalizeWhitespace(query);

  if (!normalizedQuery) {
    return {
      query: normalizedQuery,
      citations: [],
      errorMessage: "A search query is required.",
    };
  }

  if (!isHostedWebResearchAvailable()) {
    return {
      query: normalizedQuery,
      citations: [],
      errorMessage: "Hosted Brave search is not configured.",
    };
  }

  try {
    const citations = await fetchBraveSearchResults(normalizedQuery);
    return {
      query: normalizedQuery,
      citations: citations.slice(0, MAX_RESEARCH_RESULTS),
      errorMessage: null,
    };
  } catch (error: any) {
    return {
      query: normalizedQuery,
      citations: [],
      errorMessage: error?.message || "The Brave search request failed.",
    };
  }
}

export async function planHostedWebResearch(input: {
  message: string;
  profile: UserAgentProfile;
}): Promise<HostedResearchPlan | null> {
  if (!shouldUseHostedWebResearch(input.message)) {
    return null;
  }

  const queries = buildHostedWebResearchQueries(input.message, input.profile);

  if (queries.length === 0) {
    return null;
  }

  if (!isHostedWebResearchAvailable()) {
    return {
      domain: "sportfolio",
      requestMessage: input.message,
      replyText:
        "Hosted web research is not configured right now, so I could not run the Brave search check. Add a Brave Search API key on the server and I can pull live external coverage for requests like this.",
      summary: "Hosted web research is not configured.",
      observations: [],
      warnings: ["External research requires a server-side Brave Search API key."],
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        intent: "hosted_web_research",
        queries,
        provider: "brave",
        configured: false,
      },
      trace: {
        framework: "hosted-brave-search",
        status: "not_configured",
      },
    };
  }

  const attemptedQueries: string[] = [];
  const gatheredCitations: AgentCitation[] = [];

  try {
    for (const query of queries) {
      attemptedQueries.push(query);
      const result = await runHostedWebResearchQuery(query);
      if (result.errorMessage) {
        throw new Error(result.errorMessage);
      }
      const results = result.citations;

      if (results.length > 0) {
        gatheredCitations.push(...results);
        break;
      }
    }
  } catch (error: any) {
    return {
      domain: "sportfolio",
      requestMessage: input.message,
      replyText:
        "I tried to run the hosted Brave search pass, but the external research provider did not respond cleanly. I can still give you an internal-only Sportfolio read if you want to keep moving.",
      summary: "Hosted web research is temporarily unavailable.",
      observations: [],
      warnings: [
        error?.message || "The Brave search request failed.",
        "External research is optional and did not change any portfolio state.",
      ],
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        intent: "hosted_web_research",
        queries: attemptedQueries,
        provider: "brave",
        failure: error?.message || "request_failed",
      },
      trace: {
        framework: "hosted-brave-search",
        status: "request_failed",
      },
    };
  }

  const citations = gatheredCitations.slice(0, MAX_RESEARCH_RESULTS);

  if (citations.length === 0) {
    return {
      domain: "sportfolio",
      requestMessage: input.message,
      replyText:
        "I ran the hosted Brave search pass but did not find any strong external results for that query. I can still reason from the Sportfolio data we have if you want an internal-only read.",
      summary: "No strong external results found.",
      observations: [],
      warnings: [
        "The hosted web search did not return usable coverage for this request.",
        "External research is informational only and does not change portfolio state on its own.",
      ],
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        intent: "hosted_web_research",
        queries: attemptedQueries,
        provider: "brave",
        resultCount: 0,
      },
      trace: {
        framework: "hosted-brave-search",
        status: "no_results",
      },
    };
  }

  const lead = citations[0];
  const observations = citations.map(
    (citation) => `${citation.sourceName}: ${citation.factSummary}`,
  );
  const sourceLabel = citations
    .slice(0, 3)
    .map((citation) => citation.sourceName)
    .join(", ");

  return {
    domain: "sportfolio",
    requestMessage: input.message,
    replyText: `I ran a hosted Brave search and pulled current external coverage on "${attemptedQueries[0]}". The strongest signal right now is from ${lead.sourceName}: ${lead.factSummary} I also pulled ${Math.max(
      citations.length - 1,
      0,
    )} more source${citations.length === 2 ? "" : "s"} to cross-check. Open the linked sources below if you want to verify the details, or send me a follow-up and I can translate that coverage into a Sportfolio move.`,
    summary: `Hosted web research pulled ${citations.length} external source${citations.length === 1 ? "" : "s"}.`,
    observations,
    warnings: [
      "External research is informational only and must still be reconciled against live Sportfolio state before any action is staged.",
    ],
    actions: [],
    citations,
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "hosted_web_research",
      queries: attemptedQueries,
      provider: "brave",
      resultCount: citations.length,
    },
    trace: {
      framework: "hosted-brave-search",
      status: "completed",
      queryCount: attemptedQueries.length,
    },
  };
}
