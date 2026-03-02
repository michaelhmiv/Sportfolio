import type { AgentPendingClarification } from "./types";

const PLAYER_PLACEHOLDER = "{player}";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildPlayerNameClarification(input: {
  prompt: string;
  originalRequest: string;
  resumeMessageTemplate: string;
  workflowTitle?: string | null;
  workflowPreviewSteps?: string[];
}): AgentPendingClarification {
  const resumeMessageTemplate = normalizeWhitespace(input.resumeMessageTemplate);
  const workflowPreviewSteps = Array.isArray(input.workflowPreviewSteps)
    ? input.workflowPreviewSteps
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean)
    : [];

  return {
    kind: "player_name",
    prompt: normalizeWhitespace(input.prompt),
    missingFields: ["player_name"],
    originalRequest: input.originalRequest,
    resumeMessageTemplate: resumeMessageTemplate.includes(PLAYER_PLACEHOLDER)
      ? resumeMessageTemplate
      : `${resumeMessageTemplate} ${PLAYER_PLACEHOLDER}`.trim(),
    workflowTitle:
      typeof input.workflowTitle === "string" && input.workflowTitle.trim()
        ? normalizeWhitespace(input.workflowTitle)
        : null,
    workflowPreviewSteps,
  };
}

export function parsePendingClarification(value: unknown): AgentPendingClarification | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const candidate =
    entry.pendingClarification && typeof entry.pendingClarification === "object"
      ? (entry.pendingClarification as Record<string, unknown>)
      : entry;

  if (candidate.kind !== "player_name") {
    return null;
  }

  const prompt = typeof candidate.prompt === "string" ? normalizeWhitespace(candidate.prompt) : "";
  const originalRequest =
    typeof candidate.originalRequest === "string" ? candidate.originalRequest.trim() : "";
  const resumeMessageTemplate =
    typeof candidate.resumeMessageTemplate === "string"
      ? normalizeWhitespace(candidate.resumeMessageTemplate)
      : "";
  const missingFields = Array.isArray(candidate.missingFields)
    ? candidate.missingFields.filter((field): field is "player_name" => field === "player_name")
    : [];
  const workflowTitle =
    typeof candidate.workflowTitle === "string"
      ? normalizeWhitespace(candidate.workflowTitle)
      : null;
  const workflowPreviewSteps = Array.isArray(candidate.workflowPreviewSteps)
    ? candidate.workflowPreviewSteps
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean)
    : [];

  if (!prompt || !originalRequest || !resumeMessageTemplate || missingFields.length === 0) {
    return null;
  }

  if (!resumeMessageTemplate.includes(PLAYER_PLACEHOLDER)) {
    return null;
  }

  return {
    kind: "player_name",
    prompt,
    missingFields,
    originalRequest,
    resumeMessageTemplate,
    workflowTitle,
    workflowPreviewSteps,
  };
}

export function shouldTreatAsClarificationReply(
  clarification: AgentPendingClarification | null,
  reply: string,
) {
  if (!clarification) {
    return false;
  }

  const normalized = normalizeWhitespace(reply);
  if (!normalized || normalized.length > 80) {
    return false;
  }

  if (
    /\b(?:buy|sell|zap|boost|slot|lp|liquidity|scout|condense|power|watchlist|vesting)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  const tokenCount = normalized.split(" ").length;
  return tokenCount <= 6;
}

export function hydrateClarificationMessage(
  clarification: AgentPendingClarification | null,
  reply: string,
) {
  if (!clarification) {
    return null;
  }

  const normalizedReply = normalizeWhitespace(reply);
  if (!normalizedReply) {
    return null;
  }

  return clarification.resumeMessageTemplate.replaceAll(PLAYER_PLACEHOLDER, normalizedReply);
}
