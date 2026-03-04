import { writeFileSync } from "node:fs";
import { loadScoutAgentContext } from "../server/agent/context-loader";
import { buildHermesMemoryContext } from "../server/agent/memory";
import { runHermesOrchestrationTurn } from "../server/agent/hermes-orchestrator";
import { buildAgentImprovementCandidate } from "../server/agent/improvement";
import { getDefaultHermesToolAllowlist } from "../server/agent/hermes-tool-registry";
import {
  getAgentCapabilities,
  getScoutAgentProfile,
  listAgentImprovementCandidates,
} from "../server/agent/service";
import { listAvailableAgentSkills } from "../server/agent/skills";
import { getAgentToolCatalog } from "../server/agent/hermes-tools";

type AuditCase = {
  prompt: string;
  requestMode: "discussion" | "plan";
};

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }

  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function pickRandom<T>(values: T[]): T | null {
  if (values.length === 0) {
    return null;
  }

  return values[Math.floor(Math.random() * values.length)] || null;
}

function buildPromptCorpus(input: {
  batch: number;
  includeRandom: boolean;
  includePlanTools: boolean;
}): AuditCase[] {
  const toolCatalog = getAgentToolCatalog().filter(
    (entry) =>
      entry.category === "read" ||
      entry.category === "scan" ||
      (input.includePlanTools && entry.category === "plan"),
  );
  const directExamples = toolCatalog.flatMap((entry) =>
    entry.examplePrompts.slice(0, 2).map((prompt) => ({
      prompt,
      requestMode: entry.category === "plan" ? ("plan" as const) : ("discussion" as const),
    })),
  );
  const defaults: AuditCase[] = [
    {
      prompt: "what nascar drivers should i spend my cash on?",
      requestMode: "discussion",
    },
    {
      prompt: "what should i spend my cash on?",
      requestMode: "discussion",
    },
    {
      prompt: "should i buy more nascar or save cash for boosts?",
      requestMode: "discussion",
    },
  ];

  const selected: AuditCase[] = [];
  for (const candidate of [...defaults, ...directExamples]) {
    if (!candidate.prompt.trim()) {
      continue;
    }
    if (selected.some((entry) => entry.prompt.toLowerCase() === candidate.prompt.toLowerCase())) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= input.batch) {
      break;
    }
  }

  if (input.includeRandom) {
    const sports = ["NBA", "NFL", "MLB", "NASCAR"];
    const randomTemplates = [
      "what should i do with my cash in {sport} right now?",
      "who looks strongest for a fresh {sport} position?",
      "do i have a better {sport} buy than just sitting in cash?",
      "what should i clean up before lock in {sport}?",
    ];

    while (selected.length < input.batch) {
      const template = pickRandom(randomTemplates);
      const sport = pickRandom(sports);
      if (!template || !sport) {
        break;
      }

      const prompt = template.replace("{sport}", sport);
      if (selected.some((entry) => entry.prompt.toLowerCase() === prompt.toLowerCase())) {
        continue;
      }

      selected.push({
        prompt,
        requestMode: "discussion",
      });
    }
  }

  return selected.slice(0, input.batch);
}

function buildStaticCoverage(toolCatalog: ReturnType<typeof getAgentToolCatalog>) {
  const catalogNames = new Set(toolCatalog.map((entry) => entry.toolName));
  const defaultAllowlist = [...new Set(getDefaultHermesToolAllowlist())];

  return {
    catalogOnlyTools: toolCatalog
      .filter((entry) => !defaultAllowlist.includes(entry.toolName))
      .map((entry) => entry.toolName)
      .slice(0, 30),
    allowlistWithoutCatalogMetadata: defaultAllowlist
      .filter((toolName) => !catalogNames.has(toolName))
      .slice(0, 30),
    hiddenFallbackTools: toolCatalog
      .filter((entry) => entry.exposure === "hidden_fallback")
      .map((entry) => entry.toolName),
    toolsMissingExamplePrompts: toolCatalog
      .filter(
        (entry) =>
          entry.exposure !== "hidden_fallback" &&
          entry.exposure !== "internal_only" &&
          entry.examplePrompts.length === 0,
      )
      .map((entry) => entry.toolName)
      .slice(0, 40),
    nonSequentialTools: toolCatalog
      .filter((entry) => entry.supportsSequentialUse === false)
      .map((entry) => entry.toolName),
    criticalTools: toolCatalog
      .filter((entry) => entry.auditPriority === "critical")
      .map((entry) => entry.toolName),
  };
}

function summarizeToolTrace(
  trace: Array<{
    toolName: string;
    status: string;
    phase: string;
  }>,
) {
  return trace.slice(0, 6).map((entry) => `${entry.toolName}:${entry.status}:${entry.phase}`);
}

function scoreAuditCase(input: {
  prompt: string;
  outcome: string;
  assistantText: string;
  toolCallsUsed: string[];
  warnings: string[];
  improvementFlag: ReturnType<typeof buildAgentImprovementCandidate>;
}) {
  const accountSpecific = /\b(cash|balance|portfolio|holdings|boost|watchlist|shares|lp)\b/i.test(
    input.prompt,
  );
  const hasToolUse = input.toolCallsUsed.length > 0;
  const hasError = input.outcome === "error";
  const hasWeakness = Boolean(input.improvementFlag);

  return {
    toolSelectionQuality: hasWeakness
      ? hasToolUse
        ? 2
        : 1
      : hasToolUse || !accountSpecific
        ? 4
        : 3,
    groundingQuality: hasToolUse ? 4 : accountSpecific ? 2 : 3,
    responseUsefulness: hasError ? 1 : input.assistantText.trim().length > 40 ? 4 : 2,
    recoveryQuality:
      input.warnings.length === 0 ? 4 : hasWeakness && hasError ? 1 : hasWeakness ? 2 : 3,
  };
}

async function main() {
  const batch = Math.max(1, Math.min(25, Number(getArg("--batch") || "8")));
  const userId = getArg("--user") || process.env.AGENT_AUDIT_USER_ID || null;
  const includeRandom = hasFlag("--include-random");
  const staticOnly = hasFlag("--static-only");
  const includePlanTools = hasFlag("--include-plan-tools");
  const reportJsonPath = getArg("--report-json");
  const toolCatalog = getAgentToolCatalog();
  const staticCoverage = buildStaticCoverage(toolCatalog);
  const safeAllowlist = [
    ...getDefaultHermesToolAllowlist(),
    ...toolCatalog
      .filter((entry) =>
        includePlanTools
          ? entry.category !== "action"
          : entry.category !== "action" && entry.category !== "plan",
      )
      .map((entry) => entry.toolName),
  ];
  const toolSurface = [...new Set(safeAllowlist)];
  const corpus = buildPromptCorpus({
    batch,
    includeRandom,
    includePlanTools,
  });
  const requiresLiveUser = !staticOnly;

  if (requiresLiveUser && !userId) {
    throw new Error(
      "Missing user id. Run with --user <userId> or set AGENT_AUDIT_USER_ID in the environment.",
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    userId,
    staticOnly,
    includeRandom,
    includePlanTools,
    toolSurface: {
      totalCatalogTools: toolCatalog.length,
      defaultVisibleTools: toolSurface.length,
      byCategory: toolCatalog.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + 1;
        return acc;
      }, {}),
    },
    staticCoverage,
    generatedPrompts: corpus.map((entry) => entry.prompt),
    profile: null as null | Record<string, unknown>,
    latestImprovementCandidates: [] as Array<Record<string, unknown>>,
    cases: [] as Array<Record<string, unknown>>,
  };

  if (!staticOnly && userId) {
    const profileView = await getScoutAgentProfile(userId);
    const capabilities = await getAgentCapabilities(userId);
    const availableSkills = await listAvailableAgentSkills(userId);

    report.profile = {
      providerMode: profileView.profile.providerMode,
      model: profileView.profile.model,
      defaultSport: profileView.profile.defaultSport,
      canUseWebResearch: capabilities.canUseWebResearch,
    };
    report.latestImprovementCandidates = (
      await listAgentImprovementCandidates({
        userId,
        limit: 8,
      })
    ).map((entry) => ({
      id: entry.id,
      failureClass: entry.failureClass,
      recommendedChangeType: entry.recommendedChangeType,
      occurrenceCount: entry.occurrenceCount,
      affectedTools: entry.affectedTools,
      status: entry.status,
      updatedAt: entry.updatedAt.toISOString(),
    }));

    for (const entry of corpus) {
      const memoryContext = await buildHermesMemoryContext({
        userId,
        query: entry.prompt,
      });
      const context = await loadScoutAgentContext(userId, profileView.profile, {
        chatRequest: entry.prompt,
      });
      const result = await runHermesOrchestrationTurn({
        userId,
        profile: profileView.profile,
        secret: undefined,
        context,
        request: {
          userId,
          threadId: null,
          channel: "cli",
          message: entry.prompt,
          requestMode: entry.requestMode,
          orchestrationMode: "hermes_first",
          toolAllowlist: toolSurface,
          toolCatalog,
          availableSkills,
          skillPolicy: {
            allowRuntimeSkillCreation: true,
            requireAdminApprovalForGlobalSkills: true,
          },
          memoryMode: "read_write",
          autoExecutionPolicy: {
            allowAdvisoryJobs: true,
            allowRiskyActions: false,
          },
          confirmationPolicy: {
            requireExplicitConfirmation: true,
            preferredChannel: "cli",
          },
          profile: {
            displayName: profileView.profile.displayName,
            providerMode: profileView.profile.providerMode as any,
            model: profileView.profile.model,
            baseUrl: profileView.profile.baseUrl,
            systemPrompt: profileView.profile.systemPrompt,
            userPromptTemplate: profileView.profile.userPromptTemplate,
            temperature: Number(profileView.profile.temperature || 0.2),
            maxTokens: profileView.profile.maxTokens,
          },
          modelRuntime: {
            providerMode: profileView.profile.providerMode as any,
            model: profileView.profile.model,
            baseUrl: profileView.profile.baseUrl,
          },
          canonicalState: {
            threadId: null,
            pendingBundleId: null,
            operatorOverview: context.operatorOverview,
            capabilities: {
              domains: capabilities.domains,
              actionTypes: capabilities.actionTypes,
              canAnalyze: capabilities.canAnalyze,
              canAutoExecute: capabilities.canAutoExecute,
              canUseWebResearch: capabilities.canUseWebResearch,
              runtime: capabilities.runtime,
              hasDurableMemory: capabilities.hasDurableMemory,
              canScheduleAdvisories: capabilities.canScheduleAdvisories,
            },
          },
          memoryContext,
          externalContext: {
            canonicalKnowledge: context.knowledgeBrief,
            research: [],
          },
          conversationHistory: [],
          semanticRouteHint: null,
        },
      });
      const improvementFlag = buildAgentImprovementCandidate({
        requestMessage: entry.prompt,
        outcome: result.outcome,
        assistantText: result.assistantText,
        summary: result.summary,
        warnings: result.warnings,
        toolTrace: result.toolTrace,
        toolCallsUsed: result.toolCallsUsed,
        fallbackUsed: result.fallbackUsed,
      });

      report.cases.push({
        prompt: entry.prompt,
        requestMode: entry.requestMode,
        outcome: result.outcome,
        summary: result.summary,
        toolCallsUsed: result.toolCallsUsed,
        toolTrace: summarizeToolTrace(result.toolTrace),
        warnings: result.warnings,
        citationCount: result.citations.length,
        requiresConfirmation: result.requiresConfirmation,
        assistantPreview: result.assistantText.slice(0, 240),
        flags: improvementFlag
          ? {
              failureClass: improvementFlag.failureClass,
              recommendedChangeType: improvementFlag.recommendedChangeType,
              affectedTools: improvementFlag.affectedTools,
            }
          : null,
        score: scoreAuditCase({
          prompt: entry.prompt,
          outcome: result.outcome,
          assistantText: result.assistantText,
          toolCallsUsed: result.toolCallsUsed,
          warnings: result.warnings,
          improvementFlag,
        }),
      });
    }
  }

  const serialized = JSON.stringify(report, null, 2);
  if (reportJsonPath) {
    writeFileSync(reportJsonPath, serialized, "utf8");
  }

  console.log(serialized);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-audit] ${message}`);
  process.exitCode = 1;
});
