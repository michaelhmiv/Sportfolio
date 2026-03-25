import { completeSimple, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import type { PiRuntime } from "./pi-provider";
import type { AgentSemanticRoute } from "./types";

export type AgentRequestMode = "discussion" | "commit";

const INTENT_CLASSIFIER_TIMEOUT_MS = 1500;
const INTENT_CLASSIFIER_MAX_TOKENS = 12;

type HeuristicConfidence = "high" | "low";

export interface AgentModeResolution {
  mode: AgentRequestMode;
  source: "heuristic" | "model" | "fallback";
  heuristicMode: AgentRequestMode;
  heuristicConfidence: HeuristicConfidence;
  classifierLabel: AgentRequestMode | null;
}

function normalizeMessage(message: string) {
  return message.trim().toLowerCase();
}

export function isLikelyAdvisoryMessage(message: string) {
  const text = normalizeMessage(message);
  return (
    (text.endsWith("?") &&
      !/^(can you|could you|will you)\s+\b(scout|move|reallocate|shift|set|put|use|add|remove|make|build|find|buy|sell|stack|boost|trade|swap)\b/.test(
        text,
      )) ||
    (/^(what|why|how|who|when|where|which)\b/.test(text) &&
      !/^(who|what|which)\b.*\bshould i\s+(buy|sell|stack|boost|trade|scout)\b/.test(text)) ||
    /^(do you think|what do you think|would you)\b/.test(text) ||
    /^(can you|could you)\s+(explain|break down|walk me through|talk me through|help me understand|compare)\b/.test(
      text,
    ) ||
    /^(i'm thinking about|im thinking about|thinking about|i am considering|considering|leaning toward)\b/.test(
      text,
    ) ||
    /\b(help me understand|thoughts on|is it worth|would it make sense|what's better|whats better)\b/.test(
      text,
    )
  );
}

function isLikelyDirectiveMessage(message: string) {
  const text = normalizeMessage(message);
  return (
    /^(scout|move|reallocate|shift|set|put|use|add|remove|make|build|find|give me|show me|buy|sell|stack|boost|trade|swap)\b/.test(
      text,
    ) ||
    /^(?:can you|could you|will you)\s+(?:scout|move|reallocate|shift|set|put|use|add|remove|make|build|find|give me|show me|buy|sell|stack|boost|trade|swap)\b/.test(
      text,
    ) ||
    (/^(please)\b/.test(text) &&
      /\b(scout|move|reallocate|shift|set|put|use|add|remove|make|build|buy|sell|stack|boost|trade|swap)\b/.test(
        text,
      ))
  );
}

function isLikelyAmbiguousDirectiveMessage(message: string) {
  const text = normalizeMessage(message);
  return (
    /^(i want|i'd like|id like|i need|i need you to|let's|lets|we should|can we)\b/.test(text) &&
    /\b(scout|move|reallocate|shift|set|put|use|add|remove|make|build|buy|sell|stack|boost|trade|swap)\b/.test(
      text,
    )
  );
}

function resolveHeuristicAgentRequestMode(
  message: string,
  semanticRoute: AgentSemanticRoute | null,
): {
  mode: AgentRequestMode;
  confidence: HeuristicConfidence;
} {
  const text = normalizeMessage(message);

  if (/^(who|what|which)\b.*\bshould i\s+(buy|sell|stack|boost|trade|scout)\b/.test(text)) {
    return {
      mode: "commit",
      confidence: "low",
    };
  }

  if (isLikelyAdvisoryMessage(text)) {
    return {
      mode: "discussion",
      confidence: "high",
    };
  }

  if (semanticRoute === "review_setup" || semanticRoute === "general_scouting") {
    return {
      mode: "discussion",
      confidence: "high",
    };
  }

  if (
    (semanticRoute === "top_targets_today" || semanticRoute === "single_adjustment") &&
    (isLikelyDirectiveMessage(text) || /\b(do|make|set|apply|use)\b/.test(text))
  ) {
    return {
      mode: "commit",
      confidence: "high",
    };
  }

  if (isLikelyDirectiveMessage(text)) {
    return {
      mode: "commit",
      confidence: "high",
    };
  }

  if (isLikelyAmbiguousDirectiveMessage(text)) {
    return {
      mode: "commit",
      confidence: "low",
    };
  }

  return {
    mode: "discussion",
    confidence: "low",
  };
}

function buildClassifierPrompt(input: {
  message: string;
  semanticRoute: AgentSemanticRoute | null;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
}) {
  const historyLines =
    input.conversationHistory && input.conversationHistory.length > 0
      ? input.conversationHistory
          .slice(-4)
          .map(
            (entry) => `- ${entry.role === "user" ? "User" : "Scout Chat"}: ${entry.contentText}`,
          )
      : ["- No recent conversation available."];

  return [
    "<task>",
    "Classify the user's latest Scout Chat message as either commit or discussion.",
    "</task>",
    "<labels>",
    "- commit: the user is directing Scout Chat to stage a concrete scout reallocation plan now.",
    "- discussion: the user is asking for analysis, opinion, comparison, brainstorming, or exploration. Questions about whether a move makes sense are discussion.",
    "</labels>",
    "<rules>",
    "- Do not classify based on whether the move is good or bad.",
    "- Questions, hypotheticals, and exploratory phrasing are discussion.",
    "- Direct instructions, requests to make a move, or statements of intent to act are commit.",
    "- If the wording is ambiguous, prefer the label that best matches the latest user message, not older context.",
    "</rules>",
    "<examples>",
    '- "Move all my scouts to Bob" => commit',
    '- "What do you think about moving all my scouts to Bob?" => discussion',
    '- "I want to move all my scouts to Bob" => commit',
    '- "I am thinking about moving all my scouts to Bob" => discussion',
    "</examples>",
    "<semantic_route_hint>",
    input.semanticRoute || "none",
    "</semantic_route_hint>",
    "<recent_conversation>",
    ...historyLines,
    "</recent_conversation>",
    "<latest_user_message>",
    input.message.trim(),
    "</latest_user_message>",
    "Return exactly one word: commit or discussion.",
  ].join("\n");
}

function extractAssistantText(message: AssistantMessage): string | null {
  const text = message.content
    .filter(
      (block): block is Extract<(typeof message.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || null;
}

function parseClassifierLabel(text: string | null): AgentRequestMode | null {
  if (!text) {
    return null;
  }

  const normalized = text.trim().toLowerCase();
  if (/\bcommit\b/.test(normalized)) {
    return "commit";
  }
  if (/\bdiscussion\b/.test(normalized)) {
    return "discussion";
  }

  return null;
}

async function classifyAgentRequestModeWithModel(input: {
  runtime: PiRuntime;
  message: string;
  semanticRoute: AgentSemanticRoute | null;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
}): Promise<AgentRequestMode | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTENT_CLASSIFIER_TIMEOUT_MS);

  try {
    const response = await completeSimple(
      input.runtime.model,
      {
        systemPrompt:
          "You classify user intent for Scout Chat. Respond with exactly one word: commit or discussion.",
        messages: [
          {
            role: "user",
            content: buildClassifierPrompt({
              message: input.message,
              semanticRoute: input.semanticRoute,
              conversationHistory: input.conversationHistory,
            }),
            timestamp: Date.now(),
          } satisfies Message,
        ],
      },
      {
        apiKey: input.runtime.apiKey,
        temperature: 0,
        maxTokens: INTENT_CLASSIFIER_MAX_TOKENS,
        signal: controller.signal,
        ...(input.runtime.headers ? { headers: input.runtime.headers } : {}),
        ...(input.runtime.onPayload ? { onPayload: input.runtime.onPayload } : {}),
      },
    );

    return parseClassifierLabel(extractAssistantText(response));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveAgentRequestMode(
  message: string,
  semanticRoute: AgentSemanticRoute | null,
): AgentRequestMode {
  return resolveHeuristicAgentRequestMode(message, semanticRoute).mode;
}

export async function resolveAgentRequestModeWithFallback(input: {
  runtime: PiRuntime;
  message: string | null;
  semanticRoute: AgentSemanticRoute | null;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
}): Promise<AgentModeResolution> {
  const normalizedMessage = input.message?.trim() || "";
  const heuristic = resolveHeuristicAgentRequestMode(normalizedMessage, input.semanticRoute);

  if (!normalizedMessage || heuristic.confidence === "high") {
    return {
      mode: heuristic.mode,
      source: "heuristic",
      heuristicMode: heuristic.mode,
      heuristicConfidence: heuristic.confidence,
      classifierLabel: null,
    };
  }

  const classifierLabel = await classifyAgentRequestModeWithModel({
    runtime: input.runtime,
    message: normalizedMessage,
    semanticRoute: input.semanticRoute,
    conversationHistory: input.conversationHistory,
  });

  if (classifierLabel) {
    return {
      mode: classifierLabel,
      source: "model",
      heuristicMode: heuristic.mode,
      heuristicConfidence: heuristic.confidence,
      classifierLabel,
    };
  }

  return {
    mode: heuristic.mode,
    source: "fallback",
    heuristicMode: heuristic.mode,
    heuristicConfidence: heuristic.confidence,
    classifierLabel: null,
  };
}
