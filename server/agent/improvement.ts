import type {
  AgentFailureClass,
  AgentImprovementChangeType,
  AgentToolTrace,
  HermesRespondResult,
} from "./types";

type ImprovementSignalInput = {
  requestMessage: string | null;
  outcome: HermesRespondResult["outcome"] | "error";
  assistantText: string;
  summary: string | null;
  warnings: string[];
  toolTrace: AgentToolTrace[];
  toolCallsUsed: string[];
  fallbackUsed?: boolean;
};

export interface AgentImprovementCandidateDraft {
  signature: string;
  failureClass: AgentFailureClass;
  recommendedChangeType: AgentImprovementChangeType;
  recommendedChange: string;
  affectedTools: string[];
  evidence: Record<string, unknown>;
  confidence: number;
}

const ACCOUNT_SPECIFIC_PROMPT_PATTERN =
  /\b(cash|balance|portfolio|holdings|boost|watchlist|shares|lp|liquidity|what should i spend|should i buy)\b/i;
const META_TOOL_NAMES = new Set([
  "model_tool_loop",
  "model_tool_repair_retry",
  "model_first_fallback",
  "match_runtime_skill",
  "create_runtime_skill",
  "infer_memory_writes",
  "explain_previous_guidance",
]);

function normalizeSignalText(input: ImprovementSignalInput) {
  return `${input.assistantText} ${input.summary || ""} ${input.warnings.join(" ")}`
    .toLowerCase()
    .trim();
}

function summarizeToolTrace(trace: AgentToolTrace[]) {
  return trace.slice(0, 6).map((entry) => `${entry.toolName}:${entry.status}:${entry.phase}`);
}

function collectAffectedTools(signal: ImprovementSignalInput) {
  const ordered = signal.toolTrace
    .map((entry) => entry.toolName)
    .filter((toolName) => !META_TOOL_NAMES.has(toolName))
    .filter((toolName, index, values) => values.indexOf(toolName) === index);

  if (ordered.length > 0) {
    return ordered.slice(0, 4);
  }

  return signal.toolCallsUsed
    .filter((toolName, index, values) => values.indexOf(toolName) === index)
    .slice(0, 4);
}

export function classifyAgentFailure(signal: ImprovementSignalInput): AgentFailureClass | null {
  const normalizedText = normalizeSignalText(signal);
  const toolNames = signal.toolTrace.map((entry) => entry.toolName);

  if (toolNames.some((toolName) => toolName.startsWith("local_compatibility_"))) {
    return "legacy_compatibility_used";
  }

  if (
    signal.fallbackUsed ||
    toolNames.includes("model_first_fallback") ||
    /direct tool loop|fallback/.test(normalizedText)
  ) {
    return "fallback_triggered";
  }

  if (/unavailable tool/.test(normalizedText)) {
    return "wrong_tool_selected";
  }

  if (
    /no usable tool|valid tool call|neither a final answer nor a valid tool call/.test(
      normalizedText,
    )
  ) {
    return "malformed_tool_call";
  }

  if (
    signal.toolTrace.some(
      (entry) =>
        entry.status === "failed" &&
        entry.toolName !== "model_tool_loop" &&
        !entry.toolName.startsWith("local_compatibility_"),
    )
  ) {
    return "tool_execution_error";
  }

  if (
    /maximum hermes tool call budget|maximum number of model passes|exhausted/.test(normalizedText)
  ) {
    return "insufficient_tool_chain";
  }

  if (
    signal.outcome === "unsupported" &&
    signal.toolCallsUsed.length === 0 &&
    ACCOUNT_SPECIFIC_PROMPT_PATTERN.test(signal.requestMessage || "")
  ) {
    return "tool_not_selected_when_needed";
  }

  if (
    signal.outcome === "advisory" &&
    signal.toolCallsUsed.length === 0 &&
    ACCOUNT_SPECIFIC_PROMPT_PATTERN.test(signal.requestMessage || "")
  ) {
    return "overeager_direct_answer";
  }

  return null;
}

function buildRecommendation(input: { failureClass: AgentFailureClass; affectedTools: string[] }): {
  recommendedChangeType: AgentImprovementChangeType;
  recommendedChange: string;
  confidence: number;
} {
  const leadTool = input.affectedTools[0];
  const toolPhrase = leadTool ? ` around ${leadTool}` : "";

  switch (input.failureClass) {
    case "malformed_tool_call":
      return {
        recommendedChangeType: "tool_schema",
        recommendedChange:
          "Tighten the model-visible tool schemas and repair instructions so Hermes returns a valid direct tool call or answer on the first retry.",
        confidence: 0.88,
      };
    case "tool_not_selected_when_needed":
      return {
        recommendedChangeType: "tool_coverage",
        recommendedChange:
          "Improve the advisory prompt policy so account-specific turns explicitly favor primitive read tools before answering directly.",
        confidence: 0.82,
      };
    case "wrong_tool_selected":
      return {
        recommendedChangeType: "tool_schema",
        recommendedChange: `Clarify overlapping tool descriptions${toolPhrase} so the model stops selecting unavailable or mismatched tools.`,
        confidence: 0.8,
      };
    case "insufficient_tool_chain":
      return {
        recommendedChangeType: "loop_budget",
        recommendedChange:
          "Increase the bounded Hermes tool loop budget or add a more direct primitive so multi-step advisory turns complete inside one pass window.",
        confidence: 0.76,
      };
    case "tool_execution_error":
      return {
        recommendedChangeType: "executor_reliability",
        recommendedChange: `Harden the failing tool executor${toolPhrase} and normalize its result payload so the model can continue the loop after the tool returns.`,
        confidence: 0.84,
      };
    case "overeager_direct_answer":
      return {
        recommendedChangeType: "prompt_policy",
        recommendedChange:
          "Strengthen the model-loop instructions so portfolio-specific questions use real account tools instead of unsupported generic direct answers.",
        confidence: 0.7,
      };
    case "fallback_triggered":
      return {
        recommendedChangeType: "fallback_policy",
        recommendedChange:
          "Reduce normal-path fallback usage by making repair retries stricter and logging the exact loop break condition before Hermes gives up.",
        confidence: 0.78,
      };
    case "legacy_compatibility_used":
      return {
        recommendedChangeType: "compatibility_isolation",
        recommendedChange:
          "Keep the legacy compatibility bridge hidden behind explicit degraded-mode controls so normal turns stay on the direct Hermes tool loop.",
        confidence: 0.92,
      };
    default:
      return {
        recommendedChangeType: "prompt_policy",
        recommendedChange: "Review the direct Hermes tool loop configuration.",
        confidence: 0.5,
      };
  }
}

export function buildAgentImprovementCandidate(
  signal: ImprovementSignalInput,
): AgentImprovementCandidateDraft | null {
  const failureClass = classifyAgentFailure(signal);
  if (!failureClass) {
    return null;
  }

  const affectedTools = collectAffectedTools(signal);
  const recommendation = buildRecommendation({
    failureClass,
    affectedTools,
  });
  const signatureParts = [
    failureClass,
    recommendation.recommendedChangeType,
    affectedTools.join(",") || "no_tools",
  ];

  return {
    signature: signatureParts.join("::"),
    failureClass,
    recommendedChangeType: recommendation.recommendedChangeType,
    recommendedChange: recommendation.recommendedChange,
    affectedTools,
    evidence: {
      requestMessage: signal.requestMessage,
      outcome: signal.outcome,
      warnings: signal.warnings,
      toolTrace: summarizeToolTrace(signal.toolTrace),
      assistantPreview: signal.assistantText.slice(0, 280),
      toolCallsUsed: signal.toolCallsUsed,
    },
    confidence: recommendation.confidence,
  };
}
