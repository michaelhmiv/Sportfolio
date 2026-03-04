import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import {
  completeSimple,
  type AssistantMessage,
  type Message,
  type Usage,
} from "@mariozechner/pi-ai";
import { resolveLocalCompatibilityRuntime } from "./hermes-local";
import { resolveHermesToolCatalog } from "./hermes-tool-registry";
import {
  runHermesActionTool,
  runHermesMemoryTool,
  runHermesReadTool,
  runHermesScanTool,
} from "./hermes-tools";
import type {
  AgentCitation,
  AgentModelUsage,
  AgentSkillDefinition,
  AgentToolDefinition,
  AgentToolTrace,
  HermesRespondRequest,
} from "./types";

type ModelFirstToolCategory = "read" | "scan" | "plan" | "action" | "memory";

export type ModelFirstRouteResult =
  | {
      outcome: "answer";
      replyText: string;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    }
  | {
      outcome: "tool";
      toolName: string;
      toolCategory: ModelFirstToolCategory;
      toolArgs: Record<string, unknown>;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    }
  | {
      outcome: "unsupported";
      replyText: string | null;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    }
  | {
      outcome: "error";
      errorMessage: string;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    };

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};
const noArgsSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const MAX_MODEL_PASSES = 4;
const MAX_TOOL_CALLS = 3;

function buildToolTraceEntry(input: {
  toolName: string;
  phase: AgentToolTrace["phase"];
  status: AgentToolTrace["status"];
  startedAt: number;
  summary: string;
}): AgentToolTrace {
  return {
    toolName: input.toolName,
    phase: input.phase,
    status: input.status,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    summary: input.summary,
  };
}

function clampMaxTokens(profile: UserAgentProfile) {
  if (!Number.isFinite(profile.maxTokens)) {
    return 900;
  }

  return Math.max(250, Math.min(profile.maxTokens, 1400));
}

function clampTemperature(profile: UserAgentProfile) {
  const parsed = Number(profile.temperature);
  if (!Number.isFinite(parsed)) {
    return 0.2;
  }

  return Math.max(0, Math.min(parsed, 0.35));
}

function summarizeUsage(message: AssistantMessage | null): AgentModelUsage | undefined {
  if (!message) {
    return undefined;
  }

  return {
    promptTokens: message.usage.input,
    completionTokens: message.usage.output,
    totalTokens: message.usage.totalTokens,
  };
}

function extractAssistantText(message: AssistantMessage): string | null {
  const text = message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => {
      return block.type === "text";
    })
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function extractToolCalls(message: AssistantMessage) {
  return message.content.filter(
    (
      block,
    ): block is Extract<
      (typeof message.content)[number],
      { type: "toolCall"; arguments: unknown }
    > => block.type === "toolCall",
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function safeJson(value: unknown, maxLength: number) {
  try {
    return truncate(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return truncate(String(value), maxLength);
  }
}

function summarizeHistory(entries: HermesRespondRequest["conversationHistory"]) {
  const tail = (entries || []).slice(-4);
  if (tail.length === 0) {
    return "None.";
  }

  return tail
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.role.toUpperCase()}: ${truncate(entry.contentText.trim(), 220)}`,
    )
    .join("\n");
}

function summarizeKnowledge(
  entries: HermesRespondRequest["externalContext"]["canonicalKnowledge"],
) {
  const visible = (entries || []).slice(0, 6);
  if (visible.length === 0) {
    return "None.";
  }

  return visible
    .map((entry, index) => {
      const title =
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : typeof entry?.id === "string" && entry.id.trim()
            ? entry.id.trim()
            : `Article ${index + 1}`;

      return `${index + 1}. ${title}`;
    })
    .join("\n");
}

function summarizeMatchedSkill(skill: AgentSkillDefinition | null) {
  if (!skill) {
    return "None.";
  }

  return `${skill.name}: ${truncate(skill.description, 220)}`;
}

function normalizeArgs(
  tool: AgentToolDefinition,
  request: HermesRespondRequest,
  rawArgs: unknown,
): Record<string, unknown> {
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? { ...(rawArgs as Record<string, unknown>) }
      : {};

  const autoArgs = new Set(tool.autoContextArgs || []);
  if (autoArgs.has("message") && (typeof args.message !== "string" || !args.message.trim())) {
    args.message = request.message;
  }
  if (autoArgs.has("threadId") && request.threadId && !args.threadId) {
    args.threadId = request.threadId;
  }
  if (autoArgs.has("query") && (typeof args.query !== "string" || !args.query.trim())) {
    args.query = request.message;
  }
  if (autoArgs.has("sport") && (typeof args.sport !== "string" || !args.sport.trim())) {
    const explicitSport = request.message.match(/\b(nba|nfl|mlb|nascar)\b/i)?.[1];
    if (explicitSport) {
      args.sport = explicitSport.toUpperCase();
    }
  }

  return args;
}

function buildToolDescription(tool: AgentToolDefinition) {
  const lines = [tool.description];
  if (tool.whenToUse[0]) {
    lines.push(`Use when: ${tool.whenToUse[0]}`);
  }
  if (tool.examplePrompts.length > 0) {
    lines.push(`Examples: ${tool.examplePrompts.slice(0, 2).join(" | ")}`);
  }

  return lines.join("\n");
}

function collectCitations(result: unknown): AgentCitation[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const direct = (result as { citations?: unknown }).citations;
  if (Array.isArray(direct)) {
    return direct as AgentCitation[];
  }

  const nested = (result as { context?: { citations?: unknown } }).context?.citations;
  if (Array.isArray(nested)) {
    return nested as AgentCitation[];
  }

  return [];
}

function buildToolResultText(tool: AgentToolDefinition, result: unknown): string {
  if (tool.category === "scan" && result && typeof result === "object") {
    const scan = result as { replyText?: unknown; summary?: unknown };
    if (typeof scan.replyText === "string" && scan.replyText.trim()) {
      return scan.replyText.trim();
    }
    if (typeof scan.summary === "string" && scan.summary.trim()) {
      return scan.summary.trim();
    }
  }

  if (isStructuredReadResult(result)) {
    if (result.replyText) {
      return result.replyText;
    }
    if (result.summary) {
      return result.summary;
    }
  }

  return `Result from ${tool.toolName}:\n${safeJson(result, 2800)}`;
}

function buildLoopPrompt(input: {
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
  tools: AgentToolDefinition[];
}) {
  const availableTools =
    input.tools.length === 0
      ? "No tools available."
      : input.tools
          .map((tool, index) => `${index + 1}. ${tool.toolName} [${tool.category}]`)
          .join("\n");

  return [
    "<request_mode>",
    input.request.requestMode,
    "</request_mode>",
    "<available_tools>",
    availableTools,
    "</available_tools>",
    "<routing_rules>",
    "Use the real Hermes tools directly when the user needs account-specific, market-specific, or time-sensitive data.",
    "You may call up to one tool per pass. After a tool result, continue reasoning and either call another tool or answer directly.",
    "Use plan tools for confirmation-ready previews or staged bundle planning.",
    "Use action tools only when the user explicitly wants a pending bundle staged, confirmed, canceled, or another real mutation executed.",
    "Use memory mutation tools only when the user explicitly manages memory or skills, or when a workflow is clearly worth saving.",
    "When you have enough context, answer directly in plain text and do not call another tool.",
    "</routing_rules>",
    "<matched_skill_hint>",
    summarizeMatchedSkill(input.matchedSkill),
    "</matched_skill_hint>",
    "<operator_overview>",
    safeJson(input.request.canonicalState.operatorOverview || {}, 1400),
    "</operator_overview>",
    "<memory_context>",
    safeJson(input.request.memoryContext || {}, 1200),
    "</memory_context>",
    "<conversation_history>",
    summarizeHistory(input.request.conversationHistory),
    "</conversation_history>",
    "<canonical_knowledge>",
    summarizeKnowledge(input.request.externalContext.canonicalKnowledge),
    "</canonical_knowledge>",
    "<current_user_message>",
    input.request.message,
    "</current_user_message>",
  ].join("\n");
}

async function executeNonPlanningTool(input: {
  tool: AgentToolDefinition;
  userId: string;
  threadId: string | null;
  args: Record<string, unknown>;
}) {
  switch (input.tool.category) {
    case "read":
      return runHermesReadTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    case "scan":
      return runHermesScanTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        args: input.args,
      });
    case "action":
      return runHermesActionTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    case "memory":
      return runHermesMemoryTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    default:
      return null;
  }
}

export function isStructuredReadResult(value: unknown): value is {
  replyText?: string;
  summary?: string | null;
  warnings?: string[];
  citations?: AgentCitation[];
} {
  return Boolean(
    value &&
    typeof value === "object" &&
    ("replyText" in (value as Record<string, unknown>) ||
      "summary" in (value as Record<string, unknown>)),
  );
}

export async function runHermesModelToolLoop(input: {
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
}): Promise<ModelFirstRouteResult> {
  const toolTrace: AgentToolTrace[] = [];
  const warnings: string[] = [];
  const citations: AgentCitation[] = [];
  const tools = resolveHermesToolCatalog({
    toolAllowlist: input.request.toolAllowlist,
    toolCatalog: input.request.toolCatalog,
  }).filter((entry) => entry.exposure !== "hidden_fallback" && entry.exposure !== "internal_only");

  try {
    const runtime = await resolveLocalCompatibilityRuntime(input.profile, input.secret);
    const promptMessage: Message = {
      role: "user",
      content: buildLoopPrompt({
        request: input.request,
        matchedSkill: input.matchedSkill,
        tools,
      }),
      timestamp: Date.now(),
    };

    const messages: Message[] = [promptMessage];
    let repairReason: string | null = null;
    let toolCallsUsed = 0;
    let finalUsage: AgentModelUsage | undefined;

    for (let pass = 0; pass < MAX_MODEL_PASSES; pass += 1) {
      const startedAt = Date.now();
      const assistantMessage = await completeSimple(
        runtime.model,
        {
          systemPrompt: [
            "You are Sportfolio Operator.",
            "Use the available Hermes tools directly when you need account, market, or news context.",
            "Call at most one tool at a time. If you already have enough information, answer directly in plain text.",
            repairReason ? `Repair instruction: ${repairReason}` : null,
          ]
            .filter(Boolean)
            .join(" "),
          messages,
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  name: tool.toolName,
                  description: buildToolDescription(tool),
                  parameters: (tool.inputSchema || noArgsSchema) as any,
                })),
              }
            : {}),
        },
        {
          apiKey: runtime.apiKey,
          temperature: clampTemperature(input.profile),
          maxTokens: clampMaxTokens(input.profile),
          ...(runtime.headers ? { headers: runtime.headers } : {}),
          ...(runtime.onPayload ? { onPayload: runtime.onPayload } : {}),
        },
      ).catch((error: any) => ({
        role: "assistant" as const,
        content: [],
        api: runtime.model.api,
        provider: runtime.model.provider,
        model: runtime.model.id,
        usage: ZERO_USAGE,
        stopReason: "error" as const,
        errorMessage: error?.message || "The model tool loop failed.",
        timestamp: Date.now(),
      }));

      finalUsage = summarizeUsage(assistantMessage);

      if (assistantMessage.stopReason === "error" || assistantMessage.errorMessage) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_loop",
            phase: "plan",
            status: "failed",
            startedAt,
            summary: assistantMessage.errorMessage || "The model tool loop failed.",
          }),
        );

        if (!repairReason) {
          repairReason =
            "Return either a direct answer or one valid tool call from the allowed Hermes tool list.";
          continue;
        }

        return {
          outcome: "error",
          errorMessage: assistantMessage.errorMessage || "The model tool loop failed.",
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }

      const toolCalls = extractToolCalls(assistantMessage);
      const assistantText = extractAssistantText(assistantMessage);

      if (toolCalls.length === 0) {
        if (assistantText) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_loop",
              phase: "plan",
              status: "ok",
              startedAt,
              summary:
                toolCallsUsed > 0
                  ? `The model answered after ${toolCallsUsed} direct Hermes tool call(s).`
                  : "The model answered directly without needing a tool.",
            }),
          );

          return {
            outcome: "answer",
            replyText: assistantText,
            summary:
              toolCallsUsed > 0
                ? `Model answered after ${toolCallsUsed} Hermes tool call(s).`
                : "Model answered directly.",
            warnings,
            citations,
            toolTrace,
            ...(finalUsage ? { usage: finalUsage } : {}),
          };
        }

        if (!repairReason) {
          repairReason =
            "You must either answer directly in plain text or call exactly one available Hermes tool.";
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_repair_retry",
              phase: "plan",
              status: "skipped",
              startedAt,
              summary: "The model returned no answer and no usable tool call. Retrying once.",
            }),
          );
          continue;
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model tool loop returned no usable answer.",
          warnings: [
            ...warnings,
            "The model returned neither a final answer nor a valid tool call.",
          ],
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }

      const toolCall = toolCalls[0];
      if (toolCalls.length > 1) {
        warnings.push(
          `The model returned ${toolCalls.length} tool calls in one pass. Only the first tool call was executed.`,
        );
      }

      const selectedTool = tools.find((entry) => entry.toolName === toolCall.name) || null;
      messages.push(assistantMessage);

      if (!selectedTool) {
        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [
            {
              type: "text",
              text: `The tool ${toolCall.name} is not available on this turn. Choose another available tool or answer directly.`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);
        warnings.push(`The model selected unavailable tool ${toolCall.name}.`);

        if (!repairReason) {
          repairReason =
            "Do not call unavailable tools. Choose one listed tool or answer directly.";
          continue;
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model selected an unavailable tool.",
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }

      const normalizedArgs = normalizeArgs(selectedTool, input.request, toolCall.arguments);

      if (selectedTool.category === "plan") {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_loop",
            phase: "plan",
            status: "ok",
            startedAt,
            summary: `The model selected ${selectedTool.toolName} for confirmation-gated planning.`,
          }),
        );

        return {
          outcome: "tool",
          toolName: selectedTool.toolName,
          toolCategory: "plan",
          toolArgs: normalizedArgs,
          summary: `The model selected ${selectedTool.toolName}.`,
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }

      if (toolCallsUsed >= MAX_TOOL_CALLS) {
        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model exhausted the Hermes tool budget before answering.",
          warnings: [...warnings, "The model hit the maximum Hermes tool call budget."],
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }

      toolCallsUsed += 1;
      const toolStartedAt = Date.now();

      try {
        const toolResult = await executeNonPlanningTool({
          tool: selectedTool,
          userId: input.request.userId,
          threadId: input.request.threadId,
          args: normalizedArgs,
        });

        citations.push(...collectCitations(toolResult));
        toolTrace.push(
          buildToolTraceEntry({
            toolName: selectedTool.toolName,
            phase:
              selectedTool.category === "read" && selectedTool.toolName === "get_hosted_research"
                ? "research"
                : selectedTool.category,
            status: "ok",
            startedAt: toolStartedAt,
            summary: `Executed ${selectedTool.toolName} in the model tool loop.`,
          }),
        );

        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: selectedTool.toolName,
          content: [
            {
              type: "text",
              text: buildToolResultText(selectedTool, toolResult),
            },
          ],
          details:
            toolResult && typeof toolResult === "object"
              ? { result: JSON.parse(JSON.stringify(toolResult)) }
              : { result: toolResult },
          isError: false,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);
        repairReason = null;
      } catch (error: any) {
        const errorMessage = error?.message || `${selectedTool.toolName} failed.`;
        warnings.push(errorMessage);
        toolTrace.push(
          buildToolTraceEntry({
            toolName: selectedTool.toolName,
            phase:
              selectedTool.category === "read" && selectedTool.toolName === "get_hosted_research"
                ? "research"
                : selectedTool.category,
            status: "failed",
            startedAt: toolStartedAt,
            summary: errorMessage,
          }),
        );

        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: selectedTool.toolName,
          content: [
            {
              type: "text",
              text: `${selectedTool.toolName} failed: ${errorMessage}`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);

        if (!repairReason) {
          repairReason =
            "Recover by using another valid tool if needed, or answer directly from the available context.";
        }
      }
    }

    return {
      outcome: "unsupported",
      replyText: null,
      summary: "The model tool loop reached its pass limit before finishing.",
      warnings: [...warnings, "The model exhausted the maximum number of model passes."],
      citations,
      toolTrace,
      ...(finalUsage ? { usage: finalUsage } : {}),
    };
  } catch (error: any) {
    return {
      outcome: "error",
      errorMessage: error?.message || "The model tool loop failed.",
      warnings,
      citations,
      toolTrace,
    };
  }
}

export const runModelFirstToolRouter = runHermesModelToolLoop;
